import {
  schoolLoginFixture,
  syntheticSuccess,
  challengeResponse,
  schoolFailure,
  multiIdentity,
  deferred,
  loginCredentials,
} from "./school-login-fixture.js";

describe("学校唯一登录：匿名事务边界与凭据保护", () => {
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

  it("无需微信登录即创建匿名事务，返回持有凭证与验证码", async () => {
    const response = await f.request("POST", "auth/school/challenges", {});
    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json();
    expect(body).toMatchObject({
      id: expect.any(String),
      holderToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      status: "waiting",
      reason: null,
      challenge: {
        version: expect.any(String),
        imageDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
        expiresAt: expect.stringMatching(/Z$/),
      },
    });
    // 持有凭证只以摘要落库，请求体不得进入数据库。
    const rows = (
      await f.isolated.pool.query(
        "select id, holder_hash, status, challenge_version from school_login_transactions",
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].holder_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[0].holder_hash).not.toBe(body.holderToken);
    expect(JSON.stringify(rows)).not.toContain(body.holderToken);
    expect(f.counts.get).toBe(1);
    expect(f.counts.post).toBe(0);
  });

  it("创建拒绝任何输入字段，避免伪造主体或预先提交学号", async () => {
    for (const payload of [
      { name: "伪造" },
      { account: "00123456" },
      { consentVersion: 2 },
      { holderToken: "forged" },
      [],
    ])
      expect(
        (await f.request("POST", "auth/school/challenges", payload)).statusCode,
      ).toBe(400);
    expect(f.counts.get).toBe(0);
  });

  it("仅凭事务 ID 不能查询、刷新或提交，跨持有凭证一律 404", async () => {
    const mine = await f.createChallenge();
    const other = await f.createChallenge();
    const forged = "A".repeat(43);
    for (const path of ["status", "captcha"] as const) {
      const response = await f.request(
        "POST",
        `auth/school/challenges/${mine.id}/${path}`,
        { holderToken: forged },
      );
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe("CAMPUS_TRANSACTION_NOT_FOUND");
    }
    const forgedSubmit = await f.request(
      "POST",
      `auth/school/challenges/${mine.id}/submit`,
      {
        ...loginCredentials,
        holderToken: forged,
        challengeVersion: mine.challenge.version,
      },
    );
    expect(forgedSubmit.statusCode).toBe(404);
    expect(forgedSubmit.json().code).toBe("CAMPUS_TRANSACTION_NOT_FOUND");
    // 事务 ID 缺失时同样不泄露事务是否存在。
    expect(
      (
        await f.request(
          "POST",
          "auth/school/challenges/not-a-transaction/status",
          {
            holderToken: mine.holderToken,
          },
        )
      ).statusCode,
    ).toBe(404);
    // 用别人的持有凭证访问我的事务同样是 404。
    expect(
      (
        await f.request("POST", `auth/school/challenges/${mine.id}/status`, {
          holderToken: other.holderToken,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await f.request("POST", `auth/school/challenges/${mine.id}/status`, {
          holderToken: mine.holderToken,
        })
      ).statusCode,
    ).toBe(200);
    expect(f.counts.post).toBe(0);
  });

  it("刷新验证码不延长总期限，并让旧验证码版本失效", async () => {
    const t = await f.createChallenge();
    f.time("2026-10-25T00:01:00Z");
    const refreshed = await f.request(
      "POST",
      `auth/school/challenges/${t.id}/captcha`,
      { holderToken: t.holderToken },
    );
    expect(refreshed.statusCode).toBe(200);
    const body = refreshed.json();
    expect(body.holderToken).toBe(t.holderToken);
    expect(body.challenge.version).not.toBe(t.challenge.version);
    // 总期限固定在创建时刻的 5 分钟。
    expect(body.expiresAt).toBe(
      new Date("2026-10-25T00:05:00.000Z").toISOString(),
    );
    const stale = await f.submitChallenge(t);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("CAMPUS_STALE_CHALLENGE");
    expect(f.counts.post).toBe(0);
  });

  it("过期事务在提交时终结且不外联校方", async () => {
    const t = await f.createChallenge();
    f.time("2026-10-25T00:05:00.001Z");
    const expired = await f.submitChallenge(t);
    expect(expired.statusCode).toBe(200);
    expect(expired.json()).toMatchObject({ status: "expired" });
    expect(f.counts.post).toBe(0);
    expect(
      (
        await f.isolated.pool.query(
          "select status, reason from school_login_transactions",
        )
      ).rows[0],
    ).toEqual({ status: "expired", reason: "expired" });
  });

  it("取消后不能提交，重复取消幂等", async () => {
    const t = await f.createChallenge();
    const cancelled = await f.request(
      "DELETE",
      `auth/school/challenges/${t.id}`,
      { holderToken: t.holderToken },
    );
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe("cancelled");
    const again = await f.request("DELETE", `auth/school/challenges/${t.id}`, {
      holderToken: t.holderToken,
    });
    expect(again.json().status).toBe("cancelled");
    const submit = await f.submitChallenge(t);
    expect(submit.json()).toMatchObject({ status: "cancelled" });
    expect(f.counts.post).toBe(0);
  });

  it("跨事务与旧验证码版本不能互串：提交只能消费自己的验证码版本", async () => {
    const a = await f.createChallenge();
    const b = await f.createChallenge();
    const crossed = await f.request(
      "POST",
      `auth/school/challenges/${a.id}/submit`,
      {
        ...loginCredentials,
        holderToken: a.holderToken,
        challengeVersion: b.challenge.version,
      },
    );
    expect(crossed.statusCode).toBe(409);
    expect(crossed.json().code).toBe("CAMPUS_STALE_CHALLENGE");
    expect(f.counts.post).toBe(0);
  });

  it("姓名或学号与校方返回不一致时拒绝，不建号也不签发会话", async () => {
    f.transport(async (r) =>
      r.method === "GET"
        ? challengeResponse()
        : syntheticSuccess("SYNTHETIC_SUBJECT", "00123456", "合成姓名"),
    );
    const t = await f.createChallenge();
    const response = await f.submitChallenge(t, { name: "不同姓名" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "CAMPUS_IDENTITY_MISMATCH",
      message: "验证失败，姓名与学号不匹配",
    });
    for (const table of [
      "users",
      "campus_bindings",
      "campus_profiles",
      "campus_qualifications",
      "auth_sessions",
      "auth_tokens",
    ])
      expect(await count(table)).toBe(0);
    const reasons = (
      await f.isolated.pool.query(
        "select kind, metadata from auth_audit_logs where kind='campus_login_failed'",
      )
    ).rows;
    expect(reasons).toEqual([
      {
        kind: "campus_login_failed",
        metadata: { reason: "identity_mismatch" },
      },
    ]);
    expect(JSON.stringify(reasons)).not.toContain("不同姓名");
  });

  it("多身份返回 unsupported_verification，不创建空账号", async () => {
    f.transport(async (r) =>
      r.method === "GET" ? challengeResponse() : multiIdentity(),
    );
    const t = await f.createChallenge();
    const response = await f.submitChallenge(t);
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("CAMPUS_UNSUPPORTED_VERIFICATION");
    expect(response.json().details).toEqual({ reason: "multiple_identities" });
    const status = await f.request(
      "POST",
      `auth/school/challenges/${t.id}/status`,
      {
        holderToken: t.holderToken,
      },
    );
    expect(status.json()).toMatchObject({
      status: "failed",
      reason: "multiple_identities",
    });
    expect(await count("users")).toBe(0);
    expect(await count("auth_sessions")).toBe(0);
  });

  it("验证码错误与凭据失败映射为安全 400，不落敏感原值", async () => {
    for (const msg of ["验证码错误", "用户不存在或未激活"]) {
      const t = await f.createChallenge();
      f.transport(async (r) =>
        r.method === "GET" ? challengeResponse() : schoolFailure(msg),
      );
      const response = await f.submitChallenge(t);
      expect(response.statusCode).toBe(400);
      expect(
        response.json().code === "CAMPUS_UNKNOWN_RESPONSE" ||
          response.json().code === "CAMPUS_CAPTCHA_FAILED" ||
          response.json().code === "CAMPUS_CREDENTIALS_FAILED",
      ).toBe(true);
      expect(response.body).not.toContain(loginCredentials.password);
      expect(response.body).not.toContain("00123456");
      expect(await count("users")).toBe(0);
    }
    const audits = await f.isolated.pool.query(
      "select metadata from auth_audit_logs where kind='campus_login_failed'",
    );
    const text = JSON.stringify(audits.rows);
    for (const secret of [
      loginCredentials.password,
      loginCredentials.captcha,
      "00123456",
      "合成姓名",
      "SYNTHETIC_SUBJECT",
    ])
      expect(text).not.toContain(secret);
  });

  it("已终结事务重复提交只回安全状态，不重放密码、不重复签发凭据", async () => {
    const t = await f.createChallenge();
    const first = await f.submitChallenge(t);
    expect(first.statusCode).toBe(200);
    expect(first.json().credential.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(f.counts.post).toBe(1);
    const again = await f.submitChallenge(t);
    expect(again.statusCode).toBe(200);
    expect(again.json().credential).toBeUndefined();
    expect(f.counts.post).toBe(1);
  });

  it("登录后的本人接口只返回脱敏校园账号", async () => {
    const login = await f.submitChallenge(await f.createChallenge());
    const token = login.json().credential.accessToken;
    for (const response of [
      await f.request("GET", "auth/me", undefined, token),
      await f.request("PATCH", "auth/me", { nickname: "新昵称" }, token),
    ]) {
      expect(response.statusCode).toBe(200);
      expect(response.json().campus.maskedAccountNumber).toBe("••••56");
      expect(response.body).not.toContain(loginCredentials.account);
      expect(response.body).not.toContain(loginCredentials.name);
    }
  });

  it("入口关闭时匿名挑战明确不可用，公开接口不受影响", async () => {
    f.config.set("CAMPUS_VERIFICATION_ENABLED", false);
    const response = await f.request("POST", "auth/school/challenges", {});
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe("CAMPUS_VERIFICATION_UNAVAILABLE");
    expect(
      (await f.request("GET", "campus-verification/policy")).statusCode,
    ).toBe(200);
    expect(f.counts.get).toBe(0);
  });

  it("同意版本不符时不向校方提交密码", async () => {
    const t = await f.createChallenge();
    const response = await f.submitChallenge(t, { consentVersion: 1 });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "CAMPUS_CONSENT_MISMATCH",
      details: { currentVersion: 2 },
    });
    expect(f.counts.post).toBe(0);
  });

  it("来源与学号盲索引预算阻止转发校方请求", async () => {
    f.config.set("CAMPUS_RATE_LOGIN_SOURCE", 1);
    await f.createChallenge();
    const limited = await f.request("POST", "auth/school/challenges", {});
    expect(limited.statusCode).toBe(429);
    expect(limited.json().code).toBe("CAMPUS_RATE_LIMITED");
    expect(f.counts.get).toBe(1);

    f.config.set("CAMPUS_RATE_LOGIN_SOURCE", 1000);
    f.config.set("CAMPUS_RATE_LOGIN_ACCOUNT", 1);
    const first = await f.createChallenge();
    await f.submitChallenge(first);
    const second = await f.createChallenge();
    const limitedSubmit = await f.submitChallenge(second);
    expect(limitedSubmit.statusCode).toBe(429);
    // 首次提交一次，被拒的第二次不会外联。
    expect(f.counts.post).toBe(1);
  });

  it("学校超时在预算内计入且事务终结，仍可重新发起", async () => {
    f.transport(async () => {
      throw new Error("school down");
    });
    const response = await f.request("POST", "auth/school/challenges", {});
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe("CAMPUS_UPSTREAM_UNAVAILABLE");
    expect(
      (
        await f.isolated.pool.query(
          "select status, reason from school_login_transactions",
        )
      ).rows[0],
    ).toEqual({ status: "failed", reason: "upstream_unavailable" });
    f.transport(async (r) =>
      r.method === "GET" ? challengeResponse() : syntheticSuccess(),
    );
    const fresh = await f.createChallenge();
    expect(fresh.challenge.version).toEqual(expect.any(String));
  });

  it("慢校方响应不占用数据库事务：期间其他写入可以完成", async () => {
    const started = deferred<void>();
    const gate = deferred<void>();
    f.transport(async (r) => {
      if (r.method === "GET") return challengeResponse();
      started.resolve();
      await gate.promise;
      return syntheticSuccess();
    });
    const t = await f.createChallenge();
    const pending = f.submitChallenge(t);
    await started.promise;
    // 校方响应挂起时，数据库连接仍可自由完成其它写入事务。
    const probe = await f.request("POST", "auth/school/challenges", {});
    expect(probe.statusCode).toBe(201);
    const live = await f.isolated.pool.query("select 1 as ok");
    expect(live.rows[0].ok).toBe(1);
    const pendingRow = (
      await f.isolated.pool.query(
        "select status, operation from school_login_transactions where id=$1",
        [t.id],
      )
    ).rows[0];
    expect(pendingRow).toEqual({ status: "processing", operation: "submit" });
    gate.resolve();
    const done = await pending;
    expect(done.statusCode).toBe(200);
    expect(done.json().credential.accessToken).toEqual(expect.any(String));
  });

  it("POST 取消别名与 DELETE 等价，可用于丢弃 body 的代理", async () => {
    const t = await f.createChallenge();
    const cancelled = await f.request(
      "POST",
      `auth/school/challenges/${t.id}/cancel`,
      { holderToken: t.holderToken },
    );
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe("cancelled");
    // 伪造持有凭证同样不能取消。
    const other = await f.createChallenge();
    expect(
      (
        await f.request("POST", `auth/school/challenges/${other.id}/cancel`, {
          holderToken: "B".repeat(43),
        })
      ).statusCode,
    ).toBe(404);
  });

  it("原生提交拒绝浏览器来源语义与自报平台字段，且不外联校方", async () => {
    const t = await f.createChallenge();
    const browserHeaders: Record<string, string>[] = [
      { origin: "https://h5.example" },
      { referer: "https://h5.example/login" },
      { "sec-fetch-site": "same-origin" },
      { "x-refresh-csrf": "1" },
      { cookie: "hh_user_refresh=h5_" + "a".repeat(43) },
    ];
    for (const headers of browserHeaders) {
      const rejected = await f.request(
        "POST",
        `auth/school/challenges/${t.id}/submit`,
        {
          ...loginCredentials,
          holderToken: t.holderToken,
          challengeVersion: t.challenge.version,
        },
        headers,
      );
      expect(rejected.statusCode).toBe(403);
    }
    const selfDeclared = await f.submitChallenge(t, { clientType: "android" });
    expect(selfDeclared.statusCode).toBe(400);
    expect(f.counts.post).toBe(0);
    // 被拒后原挑战仍可通过原生无 Origin 正常提交。
    const ok = await f.submitChallenge(t);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().credential.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ok.headers["set-cookie"]).toBeUndefined();
    expect(f.counts.post).toBe(1);
  });

  it("H5 提交校验失败在上游认证前被拒，不消耗挑战也不外联", async () => {
    const t = await f.createChallenge();
    const invalidCases: Record<string, string>[] = [
      {},
      { origin: "https://evil.example", "x-refresh-csrf": "1" },
      {
        origin: "https://evil.example",
        referer: "https://h5.example/login",
        "x-refresh-csrf": "1",
      },
      {
        origin: "null",
        referer: "https://h5.example/login",
        "x-refresh-csrf": "1",
      },
      { origin: "https://h5.example" },
      { origin: "https://h5.example", "x-refresh-csrf": "0" },
    ];
    for (const headers of invalidCases) {
      const rejected = await f.request(
        "POST",
        `auth/school/challenges/${t.id}/submit/h5`,
        {
          ...loginCredentials,
          holderToken: t.holderToken,
          challengeVersion: t.challenge.version,
        },
        headers,
      );
      expect(rejected.statusCode).toBe(403);
      expect(rejected.headers["set-cookie"]).toBeUndefined();
    }
    expect(f.counts.post).toBe(0);
    const ok = await f.request(
      "POST",
      `auth/school/challenges/${t.id}/submit/h5`,
      {
        ...loginCredentials,
        holderToken: t.holderToken,
        challengeVersion: t.challenge.version,
      },
      { origin: "https://h5.example", "x-refresh-csrf": "1" },
    );
    expect(ok.statusCode).toBe(200);
    expect(ok.json().credential.refreshToken).toBeUndefined();
    expect(String(ok.headers["set-cookie"])).toMatch(
      /^hh_user_refresh=h5_[A-Za-z0-9_-]{43};/,
    );
    expect(f.counts.post).toBe(1);
  });
});
