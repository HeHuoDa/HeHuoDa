import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrate } from "../src/database/migrate.js";
import { testDatabase } from "./competition-fixture.js";
import {
  schoolLoginFixture,
  syntheticSuccess,
  challengeResponse,
  loginCredentials,
} from "./school-login-fixture.js";

describe("学校唯一登录：唯一绑定、原子签发与会话生命周期", () => {
  let f: Awaited<ReturnType<typeof schoolLoginFixture>>;
  beforeEach(async () => {
    f = await schoolLoginFixture();
  });
  afterEach(async () => {
    await f?.close();
  });
  const count = async (table: string) =>
    (await f.isolated.pool.query(`select count(*)::int c from ${table}`))
      .rows[0].c;
  const loginOnce = async (extra: Record<string, unknown> = {}) => {
    const t = await f.createChallenge();
    const response = await f.submitChallenge(t, extra);
    if (response.statusCode !== 200)
      throw new Error("测试登录失败：" + response.body);
    return response.json<{
      id: string;
      status: string;
      credential: {
        user: { id: string; nickname: string; status: string };
        accessToken: string;
        refreshToken: string;
        accessExpiresAt: string;
        sessionExpiresAt: string;
      };
    }>();
  };

  it("合法身份首登只产生一个用户、绑定与会话，默认昵称正确", async () => {
    const result = await loginOnce();
    expect(result.status).toBe("succeeded");
    expect(result.credential).toMatchObject({
      kind: "active",
      user: { nickname: "禾伙搭用户", status: "active" },
      accessToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      refreshToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(await count("users")).toBe(1);
    expect(await count("campus_bindings")).toBe(1);
    expect(await count("campus_profiles")).toBe(1);
    expect(await count("campus_qualifications")).toBe(1);
    expect(await count("auth_sessions")).toBe(1);
    expect(await count("auth_tokens")).toBe(1);
    const binding = (
      await f.isolated.pool.query(
        "select source, subject_hmac from campus_bindings",
      )
    ).rows[0];
    expect(binding.source).toBe("sicau-eauth");
    expect(binding.subject_hmac).toMatch(/^[a-f0-9]{64}$/);
    // 明文学号、姓名、主体与凭据都不落库。
    const dump = JSON.stringify(
      (
        await f.isolated.pool.query(
          "select (select array_agg(t) from campus_bindings t) b, (select array_agg(t) from campus_profiles t) p, (select array_agg(t) from auth_tokens t) k, (select array_agg(t) from auth_audit_logs t) a",
        )
      ).rows,
    );
    for (const secret of [
      "00123456",
      "合成姓名",
      "SYNTHETIC_SUBJECT",
      result.credential.accessToken,
      result.credential.refreshToken,
      loginCredentials.password,
      loginCredentials.captcha,
    ])
      expect(dump).not.toContain(secret);
  });

  it("同一学校身份二次登录复用账号，不重复建号", async () => {
    const first = await loginOnce();
    const second = await loginOnce();
    expect(second.credential.user.id).toBe(first.credential.user.id);
    expect(await count("users")).toBe(1);
    expect(await count("campus_bindings")).toBe(1);
    expect(await count("auth_sessions")).toBe(2);
  });

  it("并发首登同一身份只建一个账号，全部成功且会话独立", async () => {
    const challenges = await Promise.all(
      Array.from({ length: 5 }, () => f.createChallenge()),
    );
    const results = await Promise.all(
      challenges.map((t) => f.submitChallenge(t)),
    );
    expect(results.map((r) => r.statusCode)).toEqual(Array(5).fill(200));
    const ids = new Set(
      results.map((r) => r.json().credential.user.id as string),
    );
    expect(ids.size).toBe(1);
    expect(await count("users")).toBe(1);
    expect(await count("campus_bindings")).toBe(1);
    expect(await count("auth_sessions")).toBe(5);
    expect(f.counts.post).toBe(5);
  });

  it("受限与注销中账号拒绝签发新会话，也不能靠重新建号绕过", async () => {
    const first = await loginOnce();
    for (const status of ["restricted", "closing", "deleted"]) {
      await f.isolated.pool.query("update users set status=$1", [status]);
      const t = await f.createChallenge();
      const response = await f.submitChallenge(t);
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe("ACCOUNT_RESTRICTED");
      expect(await count("users")).toBe(1);
      expect(await count("auth_sessions")).toBe(1);
      const row = (
        await f.isolated.pool.query(
          "select status, reason from school_login_transactions where id=$1",
          [t.id],
        )
      ).rows[0];
      expect(row).toEqual({ status: "failed", reason: "account_restricted" });
      const audit = (
        await f.isolated.pool.query(
          "select metadata from auth_audit_logs where kind='campus_login_rejected_account'",
        )
      ).rows;
      expect(JSON.stringify(audit)).not.toContain("00123456");
    }
    expect(first.credential.user.id).toBeDefined();
  });

  it("Bearer 闭环：资料、刷新轮换、重放撤销与登出", async () => {
    const session = await loginOnce();
    const bearer = session.credential.accessToken;

    const me = await f.request("GET", "auth/me", undefined, bearer);
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: { nickname: "禾伙搭用户", status: "active" },
      campus: { status: "valid", termId: "synthetic-fall" },
      availability: { teaming: false },
    });
    expect(me.body).not.toContain("00123456");

    const profile = await f.request(
      "GET",
      "campus-verification/profile",
      undefined,
      bearer,
    );
    expect(profile.json()).toMatchObject({
      profile: { accountNumber: "00123456", name: "合成姓名" },
    });

    const refreshed = await f.request("POST", "auth/refresh", {
      refreshToken: session.credential.refreshToken,
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().refreshToken).not.toBe(
      session.credential.refreshToken,
    );
    expect(refreshed.json().sessionExpiresAt).toBe(
      session.credential.sessionExpiresAt,
    );

    // 已轮换的旧刷新凭据重放撤销整个会话族。
    const replay = await f.request("POST", "auth/refresh", {
      refreshToken: session.credential.refreshToken,
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().code).toBe("REFRESH_TOKEN_REPLAY");
    expect(
      (
        await f.request(
          "GET",
          "auth/me",
          undefined,
          refreshed.json().accessToken,
        )
      ).statusCode,
    ).toBe(401);

    const fresh = await loginOnce();
    const logout = await f.request(
      "POST",
      "auth/logout",
      undefined,
      fresh.credential.accessToken,
    );
    expect(logout.statusCode).toBe(204);
    expect(
      (
        await f.request(
          "GET",
          "auth/me",
          undefined,
          fresh.credential.accessToken,
        )
      ).statusCode,
    ).toBe(401);
  });

  it("仅数据库写事务内的调用不占用校方网络：慢提交期间事务仍可写入", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    let entered: () => void = () => {};
    const started = new Promise<void>((resolveStarted) => {
      entered = resolveStarted;
    });
    let call = 0;
    f.transport(async (r) => {
      if (r.method === "GET") return challengeResponse();
      call++;
      if (call === 1) return syntheticSuccess();
      entered();
      await gate;
      return syntheticSuccess("SECOND_SUBJECT", "00999999", "合成姓名");
    });
    const first = await f.createChallenge();
    await f.submitChallenge(first);
    const second = await f.createChallenge();
    const pending = f.submitChallenge(second, { account: "00999999" });
    await started;
    // 校方响应尚未返回时，创建事务的短事务照常提交。
    const parallel = await f.createChallenge();
    expect(parallel.holderToken).toEqual(expect.any(String));
    release();
    const response = await pending;
    expect(response.statusCode).toBe(200);
    expect(await count("users")).toBe(2);
  });

  it("生命周期撤销使资格与会话失效，清理后释放资料但保留绑定", async () => {
    const session = await loginOnce();
    const access = (await f.repository.findActiveAccess(
      session.credential.accessToken,
      f.clock.now(),
    ))!;
    await f.isolated.pool.query(
      "update campus_qualifications set revoked_at=now()",
    );
    const me = await f.request(
      "GET",
      "auth/me",
      undefined,
      session.credential.accessToken,
    );
    expect(me.json().campus.status).toBe("revoked");

    const campusModule = f.registry
      .all()
      .find((module) => module.id === "campus")!;
    await f.repository.withAccessTransaction(async (tx) => {
      await campusModule.lifecycle.cleanup(tx, access.user.id, f.clock.now());
    });
    expect(await count("campus_profiles")).toBe(0);
    expect(await count("campus_qualifications")).toBe(0);
    expect(await count("campus_bindings")).toBe(1);
  });

  it("增量迁移：已有用户与会话可升级，重复执行安全，新表就绪", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hh-school-login-"));
    let db: Awaited<ReturnType<typeof testDatabase>> | undefined;
    try {
      const migrations = resolve("migrations");
      for (const file of (await readdir(migrations)).filter(
        (entry) => entry.endsWith(".sql") && entry < "0014",
      ))
        await copyFile(join(migrations, file), join(directory, file));
      db = await testDatabase(directory);
      await db.pool.query(
        "INSERT INTO users(id,nickname) VALUES ('old-user','原账号')",
      );
      await db.pool.query(
        "INSERT INTO auth_sessions(id,user_id,absolute_expires_at) VALUES ('old-session','old-user',now()+interval '1 day')",
      );
      await migrate(db.pool);
      await migrate(db.pool);
      expect(
        (await db.pool.query("SELECT nickname FROM users WHERE id='old-user'"))
          .rows[0].nickname,
      ).toBe("原账号");
      expect(
        (
          await db.pool.query(
            "SELECT revoked_at FROM auth_sessions WHERE id='old-session'",
          )
        ).rows[0].revoked_at,
      ).toBeNull();
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int c FROM schema_migrations WHERE name='0014_school_login.sql'",
          )
        ).rows[0].c,
      ).toBe(1);
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int c FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='school_login_transactions'",
          )
        ).rows[0].c,
      ).toBe(1);
      // 回退条件：只回退服务不改表；旧服务不查询新表仍可运行。
      await db.pool.query("SELECT count(*) FROM school_login_transactions");
    } finally {
      await db?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("空库全新安装可直接迁移到最新并写入学校登录事务", async () => {
    const db = await testDatabase();
    try {
      const result = await db.pool.query(
        "INSERT INTO school_login_transactions(id,holder_hash,instance_id,status,operation,created_at,expires_at) VALUES ('fresh',repeat('a',64),'i','processing','create',now(),now()+interval '5 min') RETURNING id",
      );
      expect(result.rows[0].id).toBe("fresh");
      await expect(
        db.pool.query(
          "INSERT INTO school_login_transactions(id,holder_hash,instance_id,status,created_at,expires_at) VALUES ('dup',repeat('a',64),'i','waiting',now(),now()+interval '5 min')",
        ),
      ).rejects.toThrow(/school_login_one_active_holder/);
      await expect(
        db.pool.query(
          "INSERT INTO school_login_transactions(id,holder_hash,instance_id,status,created_at,expires_at) VALUES ('bad',repeat('b',64),'i','unknown',now(),now()+interval '5 min')",
        ),
      ).rejects.toThrow(/school_login_transactions_status_check/);
    } finally {
      await db.close();
    }
  });
});
