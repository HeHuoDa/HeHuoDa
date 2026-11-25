import {
  schoolLoginFixture,
  loginCredentials,
  syntheticSuccess,
  challengeResponse,
} from "./school-login-fixture.js";
import { authTestApp } from "./auth-fixture.js";
import { passwordHash } from "../src/admin/admin-security.js";
import { generateToken, hashToken } from "../src/auth/auth-token.js";

const H5_ORIGIN = "https://h5.example";
const H5_HEADERS = { origin: H5_ORIGIN, "x-refresh-csrf": "1" };

function cookiePair(setCookieHeader: unknown): {
  pair: string;
  token: string;
  raw: string;
} {
  const raw = String(setCookieHeader);
  const pair = raw.split(";")[0]!;
  return { pair, token: pair.slice("hh_user_refresh=".length), raw };
}

describe("H5 HttpOnly Cookie 会话、来源边界与并发语义", () => {
  let f: Awaited<ReturnType<typeof schoolLoginFixture>>;

  beforeEach(async () => {
    f = await schoolLoginFixture({ H5_ALLOWED_ORIGINS: H5_ORIGIN });
    f.transport(async (r) =>
      r.method === "GET" ? challengeResponse() : syntheticSuccess(),
    );
  });

  afterEach(async () => {
    await f?.close();
  });

  const loginH5 = async (
    headers: Record<string, string> = H5_HEADERS,
    extra: Record<string, unknown> = {},
  ) => {
    const t = await f.createChallenge();
    const res = await f.request(
      "POST",
      `auth/school/challenges/${t.id}/submit/h5`,
      {
        ...loginCredentials,
        holderToken: t.holderToken,
        challengeVersion: t.challenge.version,
        ...extra,
      },
      headers,
    );
    return { challenge: t, res };
  };

  it("H5 登录通过 Cookie 下发刷新凭据，JSON 不暴露 refreshToken 且不落库明文", async () => {
    const { res } = await loginH5();
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");

    const body = res.json();
    expect(body.status).toBe("succeeded");
    expect(Object.keys(body.credential).sort()).toEqual([
      "accessExpiresAt",
      "accessToken",
      "kind",
      "sessionExpiresAt",
      "user",
    ]);
    expect(body.credential.refreshToken).toBeUndefined();

    const { token, raw } = cookiePair(res.headers["set-cookie"]);
    expect(token).toMatch(/^h5_[A-Za-z0-9_-]{43}$/);
    expect(raw).toContain("Path=/api/v1/auth; HttpOnly; SameSite=Lax");
    expect(raw).toContain("Max-Age=2592000");
    expect(raw).not.toMatch(/Domain=/i);
    expect(raw).not.toContain("; Secure");

    const tokens = (
      await f.isolated.pool.query("select refresh_hash from auth_tokens")
    ).rows;
    expect(tokens).toHaveLength(1);
    expect(tokens[0].refresh_hash).toBe(hashToken(token));
    expect(JSON.stringify(tokens)).not.toContain(token);
  });

  it("支持 Origin 缺失时回退 Referer 源精确匹配，拒绝非法 Origin 配合法 Referer", async () => {
    const byReferer = await loginH5({
      referer: "https://h5.example/pages/login?from=home",
      "x-refresh-csrf": "1",
    });
    expect(byReferer.res.statusCode).toBe(200);

    const evilOriginWithGoodReferer = await loginH5({
      origin: "https://evil.example",
      referer: "https://h5.example/pages/login",
      "x-refresh-csrf": "1",
    });
    expect(evilOriginWithGoodReferer.res.statusCode).toBe(403);
    expect(evilOriginWithGoodReferer.res.headers["set-cookie"]).toBeUndefined();

    const emptyOriginWithGoodReferer = await loginH5({
      origin: "",
      referer: "https://h5.example/pages/login",
      "x-refresh-csrf": "1",
    });
    expect(emptyOriginWithGoodReferer.res.statusCode).toBe(403);

    const badReferer = await loginH5({
      referer: "https://h5.example.evil.com/login",
      "x-refresh-csrf": "1",
    });
    expect(badReferer.res.statusCode).toBe(403);
  });

  it("H5 刷新严格校验来源、CSRF、空体与混合凭据，403/400 不影响原凭据", async () => {
    const { res } = await loginH5();
    const { pair, token } = cookiePair(res.headers["set-cookie"]);
    const accessToken = res.json().credential.accessToken as string;

    // 1. Cookie 已出现但缺 CSRF / 错误 Origin，绝不落回原生通道（即使带 refreshToken body 或 Bearer）
    const rejectedHeaders: Record<string, string>[] = [
      { cookie: pair },
      { cookie: pair, origin: H5_ORIGIN },
      { cookie: pair, origin: H5_ORIGIN, "x-refresh-csrf": "0" },
      { cookie: pair, origin: "https://evil.example", "x-refresh-csrf": "1" },
      {
        cookie: pair,
        origin: "null",
        referer: `${H5_ORIGIN}/app`,
        "x-refresh-csrf": "1",
      },
      { cookie: pair, authorization: `Bearer ${accessToken}` },
    ];
    for (const headers of rejectedHeaders) {
      const r = await f.request(
        "POST",
        "auth/refresh",
        { refreshToken: token },
        headers,
      );
      expect(r.statusCode).toBe(403);
      expect(r.headers["set-cookie"]).toBeUndefined();
    }

    // 2. 合法 Origin + CSRF 下，非空体或混用 Bearer 返回 400 且不消费 Cookie
    const nonEmpty = await f.request(
      "POST",
      "auth/refresh",
      { refreshToken: token },
      { ...H5_HEADERS, cookie: pair },
    );
    expect(nonEmpty.statusCode).toBe(400);
    expect(nonEmpty.headers["set-cookie"]).toBeUndefined();

    const mixedBearer = await f.request("POST", "auth/refresh", undefined, {
      ...H5_HEADERS,
      cookie: pair,
      authorization: `Bearer ${accessToken}`,
    });
    expect(mixedBearer.statusCode).toBe(400);
    expect(mixedBearer.headers["set-cookie"]).toBeUndefined();

    // 3. 前述失败均未消费或破坏原 Cookie，仍可正常轮换
    const ok = await f.request(
      "POST",
      "auth/refresh",
      {},
      { ...H5_HEADERS, cookie: pair },
    );
    expect(ok.statusCode).toBe(200);
    const rotated = ok.json();
    expect(rotated.refreshToken).toBeUndefined();
    expect(rotated.accessToken).not.toBe(accessToken);
    expect(cookiePair(ok.headers["set-cookie"]).token).not.toBe(token);
  });

  it("重复 Cookie 名称、非法 Cookie 值、缺失 Cookie 与跨通道凭据互不轮换", async () => {
    const { res: h5Res } = await loginH5();
    const h5Cookie = cookiePair(h5Res.headers["set-cookie"]);

    // 原生无 Origin 登录
    const tNative = await f.createChallenge();
    const nativeRes = await f.submitChallenge(tNative);
    expect(nativeRes.statusCode).toBe(200);
    expect(nativeRes.headers["set-cookie"]).toBeUndefined();
    const nativeCred = nativeRes.json().credential;

    // 重复 Cookie 名称
    const dup = await f.request("POST", "auth/refresh", undefined, {
      ...H5_HEADERS,
      cookie: `${h5Cookie.pair}; ${h5Cookie.pair}`,
    });
    expect(dup.statusCode).toBe(401);
    expect(dup.json().code).toBe("INVALID_REFRESH_TOKEN");
    expect(String(dup.headers["set-cookie"])).toContain("Max-Age=0");

    // 把原生令牌放进 H5 Cookie -> 拒绝且原原生会话不受影响
    const nativeInCookie = await f.request("POST", "auth/refresh", undefined, {
      ...H5_HEADERS,
      cookie: `hh_user_refresh=${nativeCred.refreshToken}`,
    });
    expect(nativeInCookie.statusCode).toBe(401);
    expect(String(nativeInCookie.headers["set-cookie"])).toContain("Max-Age=0");

    // 把 H5 令牌放进原生 JSON 刷新 -> 拒绝且原 H5 会话不受影响
    const h5InBody = await f.request("POST", "auth/refresh", {
      refreshToken: h5Cookie.token,
    });
    expect(h5InBody.statusCode).toBe(401);

    // 无 Cookie 仅带 CSRF 头 -> 401 且清 Cookie
    const missingCookie = await f.request(
      "POST",
      "auth/refresh",
      undefined,
      H5_HEADERS,
    );
    expect(missingCookie.statusCode).toBe(401);
    expect(String(missingCookie.headers["set-cookie"])).toContain("Max-Age=0");

    // 原生 JSON 刷新带浏览器语义头 -> 403 且不消耗原生令牌
    const nativeWithOrigin = await f.request(
      "POST",
      "auth/refresh",
      { refreshToken: nativeCred.refreshToken },
      { origin: H5_ORIGIN },
    );
    expect(nativeWithOrigin.statusCode).toBe(403);

    // 验证两个会话依然完好可用
    const h5Ok = await f.request("POST", "auth/refresh", undefined, {
      ...H5_HEADERS,
      cookie: h5Cookie.pair,
    });
    expect(h5Ok.statusCode).toBe(200);
    const nativeOk = await f.request("POST", "auth/refresh", {
      refreshToken: nativeCred.refreshToken,
    });
    expect(nativeOk.statusCode).toBe(200);
    expect(nativeOk.headers["set-cookie"]).toBeUndefined();
    expect(nativeOk.json().refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("串行协调刷新保持绝对期限，过期/重放撤销整族并清除 Cookie", async () => {
    const { res } = await loginH5();
    const first = cookiePair(res.headers["set-cookie"]);
    const firstBody = res.json().credential;

    // 第 10 天刷新：新 Cookie 沿用原 sessionExpiresAt
    f.time("2026-11-04T00:00:00Z");
    const secondRes = await f.request("POST", "auth/refresh", undefined, {
      ...H5_HEADERS,
      cookie: first.pair,
    });
    expect(secondRes.statusCode).toBe(200);
    const second = cookiePair(secondRes.headers["set-cookie"]);
    expect(secondRes.json().sessionExpiresAt).toBe(firstBody.sessionExpiresAt);
    expect(second.raw).toContain("Max-Age=1728000");

    // 串行使用最新 Cookie 继续刷新
    f.time("2026-11-10T00:00:00Z");
    const thirdRes = await f.request("POST", "auth/refresh", undefined, {
      ...H5_HEADERS,
      cookie: second.pair,
    });
    expect(thirdRes.statusCode).toBe(200);
    const third = cookiePair(thirdRes.headers["set-cookie"]);
    expect(thirdRes.json().sessionExpiresAt).toBe(firstBody.sessionExpiresAt);

    // 旧 Cookie 重放 -> 401 REFRESH_TOKEN_REPLAY、清 Cookie 并撤销整族
    const replay = await f.request("POST", "auth/refresh", undefined, {
      ...H5_HEADERS,
      cookie: first.pair,
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().code).toBe("REFRESH_TOKEN_REPLAY");
    expect(String(replay.headers["set-cookie"])).toContain("Max-Age=0");

    // 第三代新 Cookie 与新 access 也全部失效
    const afterReplayRefresh = await f.request(
      "POST",
      "auth/refresh",
      undefined,
      { ...H5_HEADERS, cookie: third.pair },
    );
    expect(afterReplayRefresh.statusCode).toBe(401);
    expect(String(afterReplayRefresh.headers["set-cookie"])).toContain(
      "Max-Age=0",
    );
    const afterReplayMe = await f.request(
      "GET",
      "auth/me",
      undefined,
      thirdRes.json().accessToken as string,
    );
    expect(afterReplayMe.statusCode).toBe(401);

    // 另一独立会话过期后刷新同样返回 401 并清 Cookie
    const { res: expRes } = await loginH5();
    const expCookie = cookiePair(expRes.headers["set-cookie"]);
    f.time("2026-12-15T00:00:00Z");
    const expiredRefresh = await f.request("POST", "auth/refresh", undefined, {
      ...H5_HEADERS,
      cookie: expCookie.pair,
    });
    expect(expiredRefresh.statusCode).toBe(401);
    expect(String(expiredRefresh.headers["set-cookie"])).toContain("Max-Age=0");
  });

  it("两条相同旧 Cookie 并发刷新最多一次成功，且最终整族不可用", async () => {
    const { res } = await loginH5();
    const first = cookiePair(res.headers["set-cookie"]);

    const [a, b] = await Promise.all([
      f.request("POST", "auth/refresh", undefined, {
        ...H5_HEADERS,
        cookie: first.pair,
      }),
      f.request("POST", "auth/refresh", undefined, {
        ...H5_HEADERS,
        cookie: first.pair,
      }),
    ]);
    const responses = [a, b];
    const successes = responses.filter((r) => r.statusCode === 200);
    const replays = responses.filter((r) => r.statusCode === 401);
    expect(successes).toHaveLength(1);
    expect(replays).toHaveLength(1);
    expect(replays[0]!.json().code).toBe("REFRESH_TOKEN_REPLAY");
    expect(String(replays[0]!.headers["set-cookie"])).toContain("Max-Age=0");

    // 即使其中一次先成功拿回新 Cookie 与新 access，最终会话族也已被另一次重放彻底撤销
    const dbSession = (
      await f.isolated.pool.query(
        "select revoked_at, revoked_reason from auth_sessions",
      )
    ).rows[0];
    expect(dbSession.revoked_at).not.toBeNull();
    expect(dbSession.revoked_reason).toBe("refresh_replay");

    const winner = successes[0]!;
    const winnerCookie = cookiePair(winner.headers["set-cookie"]);
    const followUp = await f.request("POST", "auth/refresh", undefined, {
      ...H5_HEADERS,
      cookie: winnerCookie.pair,
    });
    expect(followUp.statusCode).toBe(401);
    expect(String(followUp.headers["set-cookie"])).toContain("Max-Age=0");
    expect(
      (
        await f.request(
          "GET",
          "auth/me",
          undefined,
          winner.json().accessToken as string,
        )
      ).statusCode,
    ).toBe(401);
  });

  it("H5 退出支持 access 过期、重复退出、受限账号退出，拒绝非法请求且不落回原生", async () => {
    const { res } = await loginH5();
    const h5Cookie = cookiePair(res.headers["set-cookie"]);
    const accessToken = res.json().credential.accessToken as string;

    // 推进时钟使 access 过期（> 15 分钟）
    f.time("2026-10-25T00:20:00Z");
    expect(
      (await f.request("GET", "auth/me", undefined, accessToken)).statusCode,
    ).toBe(401);

    // 缺 CSRF 头但有 Cookie（即使同时带 Bearer）-> 403，不撤销、不清 Cookie
    const missingCsrf = await f.request("POST", "auth/logout", undefined, {
      origin: H5_ORIGIN,
      cookie: h5Cookie.pair,
      authorization: `Bearer ${accessToken}`,
    });
    expect(missingCsrf.statusCode).toBe(403);
    expect(missingCsrf.headers["set-cookie"]).toBeUndefined();

    // 混用 Bearer + 合法 H5 头 -> 400，不撤销
    const mixed = await f.request("POST", "auth/logout", undefined, {
      ...H5_HEADERS,
      cookie: h5Cookie.pair,
      authorization: `Bearer ${accessToken}`,
    });
    expect(mixed.statusCode).toBe(400);

    // 凭 Cookie 完成 H5 退出
    const logout = await f.request("POST", "auth/logout", undefined, {
      ...H5_HEADERS,
      cookie: h5Cookie.pair,
    });
    expect(logout.statusCode).toBe(204);
    expect(String(logout.headers["set-cookie"])).toContain("Max-Age=0");

    // 重复退出（带旧 Cookie 或已无 Cookie）均安全返回 204 并清 Cookie
    const repeatHeaders: Record<string, string>[] = [
      { ...H5_HEADERS, cookie: h5Cookie.pair },
      H5_HEADERS,
      { ...H5_HEADERS, cookie: `${h5Cookie.pair}; ${h5Cookie.pair}` },
      { ...H5_HEADERS, cookie: "hh_user_refresh=invalid" },
    ];
    for (const headers of repeatHeaders) {
      const again = await f.request("POST", "auth/logout", undefined, headers);
      expect(again.statusCode).toBe(204);
      expect(String(again.headers["set-cookie"])).toContain("Max-Age=0");
    }

    // 退出后刷新被拒
    const afterLogout = await f.request("POST", "auth/refresh", undefined, {
      ...H5_HEADERS,
      cookie: h5Cookie.pair,
    });
    expect(afterLogout.statusCode).toBe(401);
    expect(String(afterLogout.headers["set-cookie"])).toContain("Max-Age=0");

    // 受限账号 H5 刷新返回 403 且不清 Cookie，仍可通过 H5 logout 退出清理
    const { res: r2 } = await loginH5();
    const c2 = cookiePair(r2.headers["set-cookie"]);
    await f.isolated.pool.query("update users set status='restricted'");
    const restrictedRefresh = await f.request(
      "POST",
      "auth/refresh",
      undefined,
      { ...H5_HEADERS, cookie: c2.pair },
    );
    expect(restrictedRefresh.statusCode).toBe(403);
    expect(restrictedRefresh.json().code).toBe("ACCOUNT_RESTRICTED");
    expect(restrictedRefresh.headers["set-cookie"]).toBeUndefined();

    const restrictedLogout = await f.request("POST", "auth/logout", undefined, {
      ...H5_HEADERS,
      cookie: c2.pair,
    });
    expect(restrictedLogout.statusCode).toBe(204);
    expect(String(restrictedLogout.headers["set-cookie"])).toContain(
      "Max-Age=0",
    );
  });

  it("刷新与退出并发竞争以最终撤销状态为准，不会复活会话", async () => {
    const { res } = await loginH5();
    const first = cookiePair(res.headers["set-cookie"]);

    const [refreshRes, logoutRes] = await Promise.all([
      f.request("POST", "auth/refresh", undefined, {
        ...H5_HEADERS,
        cookie: first.pair,
      }),
      f.request("POST", "auth/logout", undefined, {
        ...H5_HEADERS,
        cookie: first.pair,
      }),
    ]);
    expect(logoutRes.statusCode).toBe(204);
    expect([200, 401]).toContain(refreshRes.statusCode);

    const dbSession = (
      await f.isolated.pool.query(
        "select revoked_at, revoked_reason from auth_sessions",
      )
    ).rows[0];
    expect(dbSession.revoked_at).not.toBeNull();
    expect(dbSession.revoked_reason).toBe("logout");

    if (refreshRes.statusCode === 200) {
      const nextCookie = cookiePair(refreshRes.headers["set-cookie"]);
      const nextTry = await f.request("POST", "auth/refresh", undefined, {
        ...H5_HEADERS,
        cookie: nextCookie.pair,
      });
      expect(nextTry.statusCode).toBe(401);
      expect(String(nextTry.headers["set-cookie"])).toContain("Max-Age=0");
      expect(
        (
          await f.request(
            "GET",
            "auth/me",
            undefined,
            refreshRes.json().accessToken as string,
          )
        ).statusCode,
      ).toBe(401);
    }
  });

  it("受限流拒绝时不清除 Cookie 且不消费凭据", async () => {
    f.config.set("AUTH_RATE_REFRESH_PER_SUBJECT", 1);
    const { res } = await loginH5();
    const first = cookiePair(res.headers["set-cookie"]);

    const ok = await f.request("POST", "auth/refresh", undefined, {
      ...H5_HEADERS,
      cookie: first.pair,
    });
    expect(ok.statusCode).toBe(200);
    const second = cookiePair(ok.headers["set-cookie"]);

    const limited = await f.request("POST", "auth/refresh", undefined, {
      ...H5_HEADERS,
      cookie: second.pair,
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["set-cookie"]).toBeUndefined();

    // 放宽限流或下一个窗口仍可用 second 继续刷新
    f.config.set("AUTH_RATE_REFRESH_PER_SUBJECT", 100);
    const recovered = await f.request("POST", "auth/refresh", undefined, {
      ...H5_HEADERS,
      cookie: second.pair,
    });
    expect(recovered.statusCode).toBe(200);

    // 缺失或非法 Cookie 的刷新尝试也受来源限流约束，被限流后不写多余审计且不清 Cookie
    f.config.set("AUTH_RATE_REFRESH_PER_SUBJECT", 1);
    f.time("2026-10-25T00:05:00Z");
    const firstMissing = await f.request(
      "POST",
      "auth/refresh",
      undefined,
      H5_HEADERS,
    );
    expect(firstMissing.statusCode).toBe(401);
    const rateLimitedMissing = await f.request(
      "POST",
      "auth/refresh",
      undefined,
      H5_HEADERS,
    );
    expect(rateLimitedMissing.statusCode).toBe(429);
    expect(rateLimitedMissing.headers["set-cookie"]).toBeUndefined();
    const rejectedAudits = await f.isolated.pool.query(
      "select count(*)::int c from auth_audit_logs where kind='refresh_rejected'",
    );
    expect(rejectedAudits.rows[0].c).toBe(1);
  });

  it("允许列表默认空时安全拒绝 H5 写操作，生产模式 Cookie 强制 Secure 且隔离管理员边界", async () => {
    // 默认空 H5_ALLOWED_ORIGINS 安全拒绝
    f.config.set("H5_ALLOWED_ORIGINS", "");
    const { res: denied } = await loginH5();
    expect(denied.statusCode).toBe(403);
    expect(f.counts.post).toBe(0);

    // 生产模式 + 管理员隔离验证
    const prod = await authTestApp({
      NODE_ENV: "production",
      WECHAT_LOGIN_ADAPTER: "real",
      WECHAT_LOGIN_ENABLED: "false",
      CAMPUS_VERIFICATION_ENABLED: "true",
      CAMPUS_TERMS: JSON.stringify([
        {
          id: "t1",
          startAt: "2026-09-01T00:00:00+08:00",
          endAt: "2027-02-01T00:00:00+08:00",
        },
      ]),
      CAMPUS_SUBJECT_HMAC_KEY: Buffer.alloc(32, 1).toString("base64"),
      CAMPUS_PROFILE_KEYS: JSON.stringify({
        v1: Buffer.alloc(32, 2).toString("base64"),
      }),
      CAMPUS_PROFILE_KEY_ID: "v1",
      ADMIN_ALLOWED_ORIGINS: "https://admin.example",
      H5_ALLOWED_ORIGINS: "https://h5.example",
    });
    try {
      const salt = Buffer.alloc(16, 1);
      const hash = await passwordHash("prod-admin-password", salt);
      await prod.pool.query(
        "INSERT INTO admin_accounts (username, display_name, password_salt, password_hash) VALUES ($1,$2,$3,$4)",
        ["admin-user", "管理员", salt, hash],
      );
      const userId = "user-prod-1";
      await prod.pool.query(
        "INSERT INTO users (id, nickname) VALUES ($1, $2)",
        [userId, "禾伙搭用户"],
      );
      const sessionId = "session-prod-1";
      const h5Token = "h5_" + generateToken();
      const accessToken = generateToken();
      await prod.pool.query(
        "INSERT INTO auth_sessions (id, user_id, absolute_expires_at) VALUES ($1, $2, now() + interval '30 days')",
        [sessionId, userId],
      );
      await prod.pool.query(
        "INSERT INTO auth_tokens (id, session_id, generation, access_hash, access_expires_at, refresh_hash, refresh_expires_at) VALUES ($1,$2,1,$3,now() + interval '15 minutes',$4,now() + interval '30 days')",
        ["tok-1", sessionId, hashToken(accessToken), hashToken(h5Token)],
      );

      const h5Refresh = await prod.request("POST", "auth/refresh", undefined, {
        origin: "https://h5.example",
        "x-refresh-csrf": "1",
        cookie: `hh_user_refresh=${h5Token}`,
      });
      expect(h5Refresh.statusCode).toBe(200);
      const rotated = cookiePair(h5Refresh.headers["set-cookie"]);
      expect(rotated.raw).toContain("; Secure");
      expect(rotated.raw).toContain(
        "Path=/api/v1/auth; HttpOnly; SameSite=Lax",
      );
      expect(rotated.raw).not.toMatch(/Domain=/i);

      // 管理员 Origin 不能用于 H5 通道，H5 Origin 不能用于管理员接口
      const crossOriginH5 = await prod.request(
        "POST",
        "auth/refresh",
        undefined,
        {
          origin: "https://admin.example",
          "x-refresh-csrf": "1",
          cookie: rotated.pair,
        },
      );
      expect(crossOriginH5.statusCode).toBe(403);

      const crossOriginAdmin = await prod.request(
        "POST",
        "admin/auth/login",
        { username: "admin-user", password: "prod-admin-password" },
        { origin: "https://h5.example" },
      );
      expect(crossOriginAdmin.statusCode).toBe(403);

      // H5 Cookie 和用户 Bearer 均不能通过管理员认证
      const h5CookieOnAdmin = await prod.request(
        "GET",
        "admin/auth/session",
        undefined,
        { cookie: rotated.pair },
      );
      expect(h5CookieOnAdmin.statusCode).toBe(401);

      const userBearerOnAdmin = await prod.request(
        "GET",
        "admin/auth/session",
        undefined,
        { authorization: `Bearer ${h5Refresh.json().accessToken}` },
      );
      expect(userBearerOnAdmin.statusCode).toBe(403);

      // 管理员正常登录仍原样通过
      const adminOk = await prod.request(
        "POST",
        "admin/auth/login",
        { username: "admin-user", password: "prod-admin-password" },
        { origin: "https://admin.example" },
      );
      expect(adminOk.statusCode).toBe(200);

      // H5 生产退出也带 ; Secure
      const h5Logout = await prod.request("POST", "auth/logout", undefined, {
        origin: "https://h5.example",
        "x-refresh-csrf": "1",
        cookie: rotated.pair,
      });
      expect(h5Logout.statusCode).toBe(204);
      expect(String(h5Logout.headers["set-cookie"])).toContain(
        "Max-Age=0; Secure",
      );
    } finally {
      await prod.close();
    }
  });
});
