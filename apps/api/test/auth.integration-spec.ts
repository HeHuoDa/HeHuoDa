import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import type { HttpException } from "@nestjs/common";
import { AuthClock } from "../src/auth/auth-clock.js";
import { cleanupAuthArtifacts } from "../src/auth/auth-cleanup.js";
import { AuthRateLimiter } from "../src/auth/auth-rate-limiter.js";
import { AuthRepository } from "../src/auth/auth.repository.js";
import { AuthService } from "../src/auth/auth.service.js";
import { hashToken } from "../src/auth/auth-token.js";
import { StubWechatProvider } from "../src/auth/wechat/stub-wechat-provider.js";
import { DatabaseService } from "../src/database/database.service.js";
import { testDatabase } from "./competition-fixture.js";
import { AccountLifecycle } from "../src/business-access/lifecycle.service.js";
import { CapabilityRegistry } from "../src/business-access/capabilities.js";

const CONTEXT = { requestId: "req-auth-test", ip: "127.0.0.1" };

async function failure(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error("预期请求被拒绝");
}

describe("认证数据与真实 PG 事务", () => {
  let isolated: Awaited<ReturnType<typeof testDatabase>>;
  let database: DatabaseService;
  let repository: AuthRepository;
  let service: AuthService;
  let current: Date;

  beforeAll(async () => {
    isolated = await testDatabase();
    const config = new ConfigService({
      DATABASE_URL: isolated.url,
      WECHAT_LOGIN_ENABLED: true,
      WECHAT_APP_ID: "wxtestappid1234567",
      WECHAT_APP_SECRET: "test-secret-32-chars-aaaaaaaaaa",
      AUTH_RATE_LOGIN_PER_SOURCE: 100000,
      AUTH_RATE_LOGIN_PER_IDENTITY: 100000,
      AUTH_RATE_LOGIN_GLOBAL: 100000,
      AUTH_RATE_REFRESH_PER_SUBJECT: 100000,
      AUTH_RATE_REFRESH_GLOBAL: 100000,
    });
    database = new DatabaseService(config);
    repository = new AuthRepository(database);
    const clock = new AuthClock();
    current = new Date("2026-10-24T12:00:00+08:00");
    jest.spyOn(clock, "now").mockImplementation(() => current);
    service = new AuthService(
      config,
      repository,
      new AuthRateLimiter(database),
      new StubWechatProvider(),
      clock,
      new AccountLifecycle(new CapabilityRegistry()),
    );
  });

  afterAll(async () => {
    await database?.onApplicationShutdown();
    await isolated?.close();
  });

  beforeEach(async () => {
    current = new Date("2026-10-24T12:00:00+08:00");
    await isolated.pool.query(
      "TRUNCATE users,wechat_identities,auth_sessions,auth_tokens,auth_audit_logs,auth_rate_limits CASCADE",
    );
  });

  const login = (openId = "o-1", consentVersion = 1) =>
    service.wechatLogin(
      { code: "stub-identity:" + openId, consentVersion },
      CONTEXT,
    );
  const addMs = (base: Date, ms: number) => new Date(base.getTime() + ms);
  const usersCount = async () =>
    (await isolated.pool.query("select count(*)::int c from users")).rows[0].c;

  it("首次登录自动创建账号并落审计", async () => {
    const result = await login("o-1");
    expect(result.kind).toBe("active");
    expect(result.user).toMatchObject({
      nickname: "微信用户",
      status: "active",
    });
    expect(result.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.sessionExpiresAt).toBe(
      addMs(current, 30 * 24 * 3600 * 1000).toISOString(),
    );
    const audit = await isolated.pool.query(
      "select kind, metadata from auth_audit_logs",
    );
    expect(audit.rows).toMatchObject([
      { kind: "login_succeeded", metadata: { created: true } },
    ]);
  });

  it("数据库只保存凭据摘要，不落明文", async () => {
    const result = await login("o-1");
    const tokens = await isolated.pool.query(
      "select access_hash, refresh_hash from auth_tokens",
    );
    expect(tokens.rows[0].access_hash).toBe(hashToken(result.accessToken));
    expect(tokens.rows[0].refresh_hash).toBe(hashToken(result.refreshToken));
    expect(JSON.stringify(tokens.rows)).not.toContain(result.accessToken);
    expect(JSON.stringify(tokens.rows)).not.toContain(result.refreshToken);
  });

  it("重复与并发登录同一身份只保留一个账号", async () => {
    const again = await login("o-1");
    expect(await usersCount()).toBe(1);
    const concurrent = await Promise.all(
      Array.from({ length: 5 }, () => login("o-1")),
    );
    expect(new Set(concurrent.map((r) => r.user.id)).size).toBe(1);
    expect(concurrent[0].user.id).toBe(again.user.id);
    expect(await usersCount()).toBe(1);
    expect(
      (
        await isolated.pool.query(
          "select count(*)::int c from wechat_identities",
        )
      ).rows[0].c,
    ).toBe(1);
  });

  it("UnionID 可空且不作为身份键", async () => {
    await service.wechatLogin(
      { code: "stub-identity:o-union:union:u-1", consentVersion: 1 },
      CONTEXT,
    );
    const identity = await isolated.pool.query(
      "select open_id, union_id from wechat_identities",
    );
    expect(identity.rows[0]).toEqual({ open_id: "o-union", union_id: "u-1" });
    await login("o-union", 1);
    const identities = await isolated.pool.query(
      "select count(*)::int c from wechat_identities",
    );
    expect(identities.rows[0].c).toBe(1);
  });

  it("code 无效或上游不可用不创建账号与会话", async () => {
    for (const code of ["stub-invalid", "stub-upstream"]) {
      const error = await failure(
        service.wechatLogin({ code, consentVersion: 1 }, CONTEXT),
      );
      expect([401, 503]).toContain(error.getStatus());
      expect(await usersCount()).toBe(0);
      expect(
        (await isolated.pool.query("select count(*)::int c from auth_sessions"))
          .rows[0].c,
      ).toBe(0);
    }
  });

  it("协议版本不匹配不能登录", async () => {
    const error = await failure(login("o-consent", 2));
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toMatchObject({
      code: "CONSENT_VERSION_MISMATCH",
      details: { currentVersion: 1 },
    });
    expect(await usersCount()).toBe(0);
  });

  it("访问凭据 15 分钟过期且由服务端时钟判断", async () => {
    const result = await login("o-1");
    current = addMs(current, 15 * 60_000 - 1_000);
    expect(
      await repository.findActiveAccess(result.accessToken, current),
    ).toBeDefined();
    current = addMs(current, 2_000);
    expect(
      await repository.findActiveAccess(result.accessToken, current),
    ).toBeUndefined();
  });

  it("刷新轮换凭据且不延长会话绝对期限", async () => {
    const first = await login("o-1");
    current = addMs(current, 29 * 24 * 3600 * 1000);
    const refreshed = await service.refresh(
      { refreshToken: first.refreshToken },
      CONTEXT,
    );
    expect(refreshed.sessionExpiresAt).toBe(first.sessionExpiresAt);
    current = addMs(current, 2 * 24 * 3600 * 1000);
    const error = await failure(
      service.refresh({ refreshToken: refreshed.refreshToken }, CONTEXT),
    );
    expect(error.getStatus()).toBe(401);
  });

  it("轮换后旧访问凭据立即失效", async () => {
    const first = await login("o-1");
    const refreshed = await service.refresh(
      { refreshToken: first.refreshToken },
      CONTEXT,
    );
    expect(
      await repository.findActiveAccess(first.accessToken, current),
    ).toBeUndefined();
    expect(
      await repository.findActiveAccess(refreshed.accessToken, current),
    ).toBeDefined();
  });

  it("重放已消费刷新凭据撤销整个会话族", async () => {
    const first = await login("o-1");
    const refreshed = await service.refresh(
      { refreshToken: first.refreshToken },
      CONTEXT,
    );
    const replay = await failure(
      service.refresh({ refreshToken: first.refreshToken }, CONTEXT),
    );
    expect(replay.getStatus()).toBe(401);
    expect(replay.getResponse()).toMatchObject({
      code: "REFRESH_TOKEN_REPLAY",
    });
    const afterReplay = await failure(
      service.refresh({ refreshToken: refreshed.refreshToken }, CONTEXT),
    );
    expect(afterReplay.getStatus()).toBe(401);
    expect(
      await repository.findActiveAccess(refreshed.accessToken, current),
    ).toBeUndefined();
    const session = await isolated.pool.query(
      "select revoked_at, revoked_reason from auth_sessions",
    );
    expect(session.rows[0].revoked_reason).toBe("refresh_replay");
  });

  it("并发刷新同一凭据只有一个成功", async () => {
    const first = await login("o-1");
    const attempts = await Promise.allSettled([
      service.refresh({ refreshToken: first.refreshToken }, CONTEXT),
      service.refresh({ refreshToken: first.refreshToken }, CONTEXT),
      service.refresh({ refreshToken: first.refreshToken }, CONTEXT),
    ]);
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  });

  it("无效刷新串不撤销他人会话", async () => {
    const mine = await login("o-mine");
    const error = await failure(
      service.refresh({ refreshToken: "invalid-token" }, CONTEXT),
    );
    expect(error.getStatus()).toBe(401);
    expect(error.getResponse()).toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
    });
    expect(
      await repository.findActiveAccess(mine.accessToken, current),
    ).toBeDefined();
  });

  it("账号受限后凭据立即不可用，退出仍可清理", async () => {
    const first = await login("o-1");
    await isolated.pool.query("update users set status='restricted'");
    const access = await repository.findActiveAccess(
      first.accessToken,
      current,
    );
    expect(access).toBeDefined();
    let meError: HttpException | null = null;
    try {
      service.me(access!);
    } catch (error) {
      meError = error as HttpException;
    }
    expect(meError?.getStatus()).toBe(403);
    const refresh = await failure(
      service.refresh({ refreshToken: first.refreshToken }, CONTEXT),
    );
    expect(refresh.getStatus()).toBe(403);
    await service.logout(access!, CONTEXT.requestId);
    expect(
      await repository.findActiveAccess(first.accessToken, current),
    ).toBeUndefined();
  });

  it("昵称仅落本人且非法值被拒", async () => {
    const first = await login("o-1");
    const access = (await repository.findActiveAccess(
      first.accessToken,
      current,
    ))!;
    const updated = await service.updateNickname(
      access,
      { nickname: "  禾伙搭队长  " },
      CONTEXT.requestId,
    );
    expect(updated.user.nickname).toBe("禾伙搭队长");
    const stored = await isolated.pool.query("select nickname from users");
    expect(stored.rows[0].nickname).toBe("禾伙搭队长");
    const invalid = await failure(
      service.updateNickname(
        access,
        { nickname: "x".repeat(21) },
        CONTEXT.requestId,
      ),
    );
    expect(invalid.getStatus()).toBe(400);
    expect(stored.rows[0].nickname).toBe("禾伙搭队长");
  });

  it("超过来源预算的登录被限流", async () => {
    const strict = new AuthService(
      new ConfigService({
        WECHAT_LOGIN_ENABLED: true,
        WECHAT_APP_ID: "wxtestappid1234567",
        WECHAT_APP_SECRET: "test-secret-32-chars-aaaaaaaaaa",
        AUTH_RATE_LOGIN_PER_SOURCE: 2,
        AUTH_RATE_LOGIN_PER_IDENTITY: 100000,
        AUTH_RATE_LOGIN_GLOBAL: 100000,
        AUTH_RATE_REFRESH_PER_SUBJECT: 100000,
        AUTH_RATE_REFRESH_GLOBAL: 100000,
      }),
      repository,
      new AuthRateLimiter(database),
      new StubWechatProvider(),
      { now: () => current },
      new AccountLifecycle(new CapabilityRegistry()),
    );
    await strict.wechatLogin(
      { code: "stub-identity:o-a", consentVersion: 1 },
      CONTEXT,
    );
    await strict.wechatLogin(
      { code: "stub-identity:o-b", consentVersion: 1 },
      CONTEXT,
    );
    const error = await failure(
      strict.wechatLogin(
        { code: "stub-identity:o-c", consentVersion: 1 },
        CONTEXT,
      ),
    );
    expect(error.getStatus()).toBe(429);
    expect(error.getResponse()).toMatchObject({
      code: "TOO_MANY_REQUESTS",
      details: { retryAfterSeconds: expect.any(Number) },
    });
    expect(await usersCount()).toBe(2);
  });

  it("开关关闭时登录明确不可用", async () => {
    const disabled = new AuthService(
      new ConfigService({ WECHAT_LOGIN_ENABLED: false }),
      repository,
      new AuthRateLimiter(database),
      new StubWechatProvider(),
      { now: () => current },
      new AccountLifecycle(new CapabilityRegistry()),
    );
    const error = await failure(
      disabled.wechatLogin(
        { code: "stub-identity:o-1", consentVersion: 1 },
        CONTEXT,
      ),
    );
    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toMatchObject({
      code: "WECHAT_LOGIN_UNAVAILABLE",
    });
  });

  it("会话存于数据库，不随进程重启丢失", async () => {
    const first = await login("o-1");
    const restart = new DatabaseService(
      new ConfigService({ DATABASE_URL: isolated.url }),
    );
    try {
      const fresh = new AuthRepository(restart);
      expect(
        await fresh.findActiveAccess(first.accessToken, current),
      ).toBeDefined();
    } finally {
      await restart.onApplicationShutdown();
    }
  });

  it("清理任务按保留期删除审计与失效凭据残留", async () => {
    const first = await login("o-1");
    await service.refresh({ refreshToken: first.refreshToken }, CONTEXT);
    await isolated.pool.query(
      "update auth_audit_logs set created_at = now() - interval '181 days'",
    );
    await isolated.pool.query(
      "update auth_tokens set consumed_at = now() - interval '31 days' where consumed_at is not null",
    );
    await isolated.pool.query(
      "update auth_tokens set refresh_expires_at = now() - interval '31 days' where consumed_at is null",
    );
    await isolated.pool.query(
      "update auth_sessions set absolute_expires_at = now() - interval '31 days'",
    );
    await isolated.pool.query(
      "update auth_rate_limits set window_started_at = now() - interval '2 hours'",
    );
    const result = await cleanupAuthArtifacts(isolated.pool, 180);
    expect(result.auditLogs).toBeGreaterThanOrEqual(2);
    expect(result.tokens).toBe(2);
    expect(result.sessions).toBe(1);
    expect(result.rateWindows).toBeGreaterThanOrEqual(1);
    expect(
      (await isolated.pool.query("select count(*)::int c from auth_tokens"))
        .rows[0].c,
    ).toBe(0);
    expect(
      (await isolated.pool.query("select count(*)::int c from auth_sessions"))
        .rows[0].c,
    ).toBe(0);
  });
});
