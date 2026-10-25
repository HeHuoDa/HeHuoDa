import { authTestApp, type AuthTestApp } from "./auth-fixture.js";

describe("认证 HTTP 契约", () => {
  let test: AuthTestApp;
  beforeAll(async () => {
    test = await authTestApp();
  });
  afterAll(async () => {
    await test?.close();
  });

  const login = (openId: string, consentVersion = 1) =>
    test
      .request("POST", "auth/wechat/login", {
        code: "stub-identity:" + openId,
        consentVersion,
      })
      .then((r) => r.json());
  const bearer = (token: string) => ({ authorization: "Bearer " + token });

  it("微信登录返回账号与可轮换凭据", async () => {
    const response = await test.request("POST", "auth/wechat/login", {
      code: "stub-identity:o-http",
      consentVersion: 1,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json();
    expect(body).toMatchObject({
      kind: "active",
      user: {
        id: expect.any(String),
        nickname: "微信用户",
        status: "active",
      },
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      accessExpiresAt: expect.stringMatching(/Z$/),
      sessionExpiresAt: expect.stringMatching(/Z$/),
    });
  });

  it("协议版本不匹配返回400并携带当前版本", async () => {
    const response = await test.request("POST", "auth/wechat/login", {
      code: "stub-identity:o-consent",
      consentVersion: 2,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: "CONSENT_VERSION_MISMATCH",
      message: expect.any(String),
      requestId: expect.any(String),
      details: { currentVersion: 1 },
    });
  });

  it.each([
    ["stub-invalid", 401, "WECHAT_CODE_INVALID"],
    ["stub-upstream", 503, "WECHAT_UPSTREAM_UNAVAILABLE"],
  ])("code %s 映射为 %s", async (code, status, errCode) => {
    const response = await test.request("POST", "auth/wechat/login", {
      code,
      consentVersion: 1,
    });
    expect(response.statusCode).toBe(status);
    const body = response.json();
    expect(body.code).toBe(errCode);
    expect(body.requestId).toEqual(expect.any(String));
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(body)).not.toContain(code);
  });

  it.each([
    ["缺少 code", { consentVersion: 1 }],
    ["code 为空", { code: "", consentVersion: 1 }],
    [
      "consentVersion 非整数",
      { code: "stub-identity:o-1", consentVersion: 1.5 },
    ],
    [
      "多余字段",
      { code: "stub-identity:o-1", consentVersion: 1, openId: "o-x" },
    ],
  ])("参数错误 %s 为400", async (_, payload) => {
    const response = await test.request("POST", "auth/wechat/login", payload);
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("BAD_REQUEST");
  });

  it("刷新轮换凭据，重放撤销会话族", async () => {
    const first = await login("o-refresh");
    const refreshed = await test.request("POST", "auth/refresh", {
      refreshToken: first.refreshToken,
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().refreshToken).not.toBe(first.refreshToken);
    const replay = await test.request("POST", "auth/refresh", {
      refreshToken: first.refreshToken,
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().code).toBe("REFRESH_TOKEN_REPLAY");
    const afterReplay = await test.request("POST", "auth/refresh", {
      refreshToken: refreshed.json().refreshToken,
    });
    expect(afterReplay.statusCode).toBe(401);
  });

  it("me 返回账号、未核验校园状态与未开放能力", async () => {
    const first = await login("o-me");
    const response = await test.request(
      "GET",
      "auth/me",
      undefined,
      bearer(first.accessToken),
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      user: {
        id: expect.any(String),
        nickname: "微信用户",
        status: "active",
      },
      campus: {
        status: "unverified",
        termId: null,
        verifiedAt: null,
        validUntil: null,
      },
      availability: { teaming: false },
    });
  });

  it("昵称可修改并持久化，非法值与越权被拒", async () => {
    const first = await login("o-nickname");
    const patched = await test.request(
      "PATCH",
      "auth/me",
      { nickname: "  禾伙搭队长 " },
      bearer(first.accessToken),
    );
    expect(patched.statusCode).toBe(200);
    expect(patched.json().user.nickname).toBe("禾伙搭队长");
    // POST 是同一处理器的微信小程序端别名（wx.request 不支持 PATCH）。
    const aliased = await test.request(
      "POST",
      "auth/me",
      { nickname: "禾伙搭队长二号" },
      bearer(first.accessToken),
    );
    expect(aliased.statusCode).toBe(200);
    expect(aliased.json().user.nickname).toBe("禾伙搭队长二号");
    const reread = await test.request(
      "GET",
      "auth/me",
      undefined,
      bearer(first.accessToken),
    );
    expect(reread.json().user.nickname).toBe("禾伙搭队长二号");

    for (const nickname of ["", "   ", "x".repeat(21)])
      expect(
        (
          await test.request(
            "PATCH",
            "auth/me",
            { nickname },
            bearer(first.accessToken),
          )
        ).statusCode,
      ).toBe(400);

    expect(
      (await test.request("PATCH", "auth/me", { nickname: "新昵称" }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await test.request(
          "PATCH",
          "auth/me",
          { nickname: "新昵称" },
          {
            authorization: "Bearer invalid",
          },
        )
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await test.request(
          "GET",
          "auth/me",
          undefined,
          bearer(first.accessToken),
        )
      ).json().user.nickname,
    ).toBe("禾伙搭队长二号");
  });

  it("账号受限后旧凭据立即不可访问，退出仍可清理", async () => {
    const first = await login("o-restricted");
    await test.pool.query("update users set status='restricted'");
    const me = await test.request(
      "GET",
      "auth/me",
      undefined,
      bearer(first.accessToken),
    );
    expect(me.statusCode).toBe(403);
    expect(me.json().code).toBe("ACCOUNT_RESTRICTED");
    const logout = await test.request(
      "POST",
      "auth/logout",
      undefined,
      bearer(first.accessToken),
    );
    expect(logout.statusCode).toBe(204);
    expect(
      (
        await test.request(
          "GET",
          "auth/me",
          undefined,
          bearer(first.accessToken),
        )
      ).statusCode,
    ).toBe(401);
  });

  it("退出撤销会话，重复退出返回安全401", async () => {
    const first = await login("o-logout");
    const logout = await test.request(
      "POST",
      "auth/logout",
      undefined,
      bearer(first.accessToken),
    );
    expect(logout.statusCode).toBe(204);
    expect(logout.body).toBe("");
    for (const [label, headers] of [
      ["旧凭据", bearer(first.accessToken)],
      ["无凭据", undefined],
    ] as const) {
      expect(
        (await test.request("POST", "auth/logout", undefined, headers))
          .statusCode,
      ).toBe(401);
      void label;
    }
  });

  it("公开接口不依赖认证状态", async () => {
    expect((await test.request("GET", "health")).statusCode).toBe(200);
    expect((await test.request("GET", "competitions")).statusCode).toBe(200);
  });

  it("错误响应不泄露内部细节", async () => {
    const response = await test.request("GET", "auth/me");
    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body).toEqual({
      code: "UNAUTHORIZED",
      message: "未授权",
      requestId: expect.any(String),
    });
  });
});
