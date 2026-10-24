import { authTestApp, type AuthTestApp } from "./auth-fixture.js";

// ConfigModule 在模块加载时读取环境，因此关闭开关的场景放在独立文件，
// 保证本文件的 AppModule 以 WECHAT_LOGIN_ENABLED=false 完成验证。
describe("微信登录开关关闭时的 HTTP 行为", () => {
  let test: AuthTestApp;
  beforeAll(async () => {
    test = await authTestApp({ WECHAT_LOGIN_ENABLED: "false" });
  });
  afterAll(async () => {
    await test?.close();
  });

  it("登录与刷新明确不可用，公开接口继续工作", async () => {
    const login = await test.request("POST", "auth/wechat/login", {
      code: "stub-identity:o-off",
      consentVersion: 1,
    });
    expect(login.statusCode).toBe(503);
    expect(login.json()).toEqual({
      code: "WECHAT_LOGIN_UNAVAILABLE",
      message: expect.any(String),
      requestId: expect.any(String),
    });
    const refresh = await test.request("POST", "auth/refresh", {
      refreshToken: "whatever",
    });
    expect(refresh.statusCode).toBe(503);
    expect(refresh.json().code).toBe("WECHAT_LOGIN_UNAVAILABLE");
    expect((await test.request("GET", "health")).statusCode).toBe(200);
    expect((await test.request("GET", "competitions")).statusCode).toBe(200);
  });
});
