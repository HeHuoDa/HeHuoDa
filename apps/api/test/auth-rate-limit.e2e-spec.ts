import { authTestApp, type AuthTestApp } from "./auth-fixture.js";

// ConfigModule 在模块加载时读取环境，因此收紧预算的场景放在独立文件。
describe("认证来源限流", () => {
  let strict: AuthTestApp;
  beforeAll(async () => {
    strict = await authTestApp({ AUTH_RATE_LOGIN_PER_SOURCE: "2" });
  });
  afterAll(async () => {
    await strict?.close();
  });

  it("超过来源预算后返回429且公开接口不受影响", async () => {
    for (const openId of ["o-r1", "o-r2"]) {
      const response = await strict.request("POST", "auth/wechat/login", {
        code: "stub-identity:" + openId,
        consentVersion: 1,
      });
      expect(response.statusCode).toBe(200);
    }
    const limited = await strict.request("POST", "auth/wechat/login", {
      code: "stub-identity:o-r3",
      consentVersion: 1,
    });
    expect(limited.statusCode).toBe(429);
    const body = limited.json();
    expect(body).toEqual({
      code: "TOO_MANY_REQUESTS",
      message: expect.any(String),
      requestId: expect.any(String),
      details: { retryAfterSeconds: expect.any(Number) },
    });
    expect(body.details.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect((await strict.request("GET", "health")).statusCode).toBe(200);
    expect((await strict.request("GET", "competitions")).statusCode).toBe(200);
  });
});
