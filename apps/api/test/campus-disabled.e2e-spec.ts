import { authTestApp } from "./auth-fixture.js";
describe("校园核验默认关闭", () => {
  let f: Awaited<ReturnType<typeof authTestApp>>;
  beforeAll(async () => {
    f = await authTestApp();
  });
  afterAll(async () => {
    await f?.close();
  });
  it("公开告知可读；有效会话看到未核验和关闭入口，不能外联", async () => {
    const policy = await f.request("GET", "campus-verification/policy");
    expect(policy.statusCode).toBe(200);
    expect(policy.json().content).toContain("认证仅核对学校账号信息");
    const login = await f.request("POST", "auth/wechat/login", {
      code: "stub-identity:campus-disabled",
      consentVersion: 1,
    });
    const headers = { authorization: "Bearer " + login.json().accessToken };
    const status = await f.request(
      "GET",
      "campus-verification",
      undefined,
      headers,
    );
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      status: "unverified",
      available: false,
      currentTerm: null,
    });
    expect(
      (await f.request("POST", "campus-verification/transactions", {}, headers))
        .statusCode,
    ).toBe(503);
    expect(
      (
        await f.request(
          "GET",
          "campus-verification/profile",
          undefined,
          headers,
        )
      ).json(),
    ).toEqual({ profile: null });
  });
});
