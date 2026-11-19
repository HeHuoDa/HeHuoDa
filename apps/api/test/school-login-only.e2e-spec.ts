import { validateEnvironment } from "../src/config/env.validation.js";
import {
  schoolLoginFixture,
  syntheticSuccess,
  challengeResponse,
} from "./school-login-fixture.js";

// 无微信配置场景：只开启学校唯一登录。与其他开关场景分文件，避免进程环境互相污染。
describe("仅学校唯一登录、无微信配置时可运行", () => {
  it("环境校验不再要求微信凭据，预算与开关按默认值就绪", () => {
    const environment = validateEnvironment({
      NODE_ENV: "test",
      CAMPUS_VERIFICATION_ENABLED: "true",
      CAMPUS_TERMS: JSON.stringify([
        {
          id: "synthetic",
          startAt: "2026-09-01T00:00:00+08:00",
          endAt: "2027-02-01T00:00:00+08:00",
        },
      ]),
      CAMPUS_SUBJECT_HMAC_KEY: Buffer.alloc(32, 1).toString("base64"),
      CAMPUS_PROFILE_KEYS: JSON.stringify({
        v1: Buffer.alloc(32, 2).toString("base64"),
      }),
      CAMPUS_PROFILE_KEY_ID: "v1",
    });
    expect(environment.WECHAT_LOGIN_ENABLED).toBe(false);
    expect(environment.WECHAT_APP_ID).toBe("");
    expect(environment.WECHAT_APP_SECRET).toBe("");
    expect(environment.CAMPUS_RATE_LOGIN_GLOBAL).toBe(500);
    expect(environment.CAMPUS_RATE_LOGIN_SOURCE).toBe(100);
    expect(environment.CAMPUS_RATE_LOGIN_ACCOUNT).toBe(5);
  });

  it("无微信登录时完整匿名登录、读取资料、刷新与登出可用", async () => {
    const f = await schoolLoginFixture({ WECHAT_LOGIN_ENABLED: false });
    try {
      f.transport(async (r) =>
        r.method === "GET" ? challengeResponse() : syntheticSuccess(),
      );
      const t = await f.createChallenge();
      const login = await f.submitChallenge(t);
      expect(login.statusCode).toBe(200);
      const credential = login.json().credential;
      expect(credential.user.nickname).toBe("禾伙搭用户");
      expect(
        (await f.request("GET", "auth/me", undefined, credential.accessToken))
          .statusCode,
      ).toBe(200);
      // 微信登录仍受配置保护（#223 收口），但平台刷新与会话继续可用。
      expect(
        (
          await f.request("POST", "auth/wechat/login", {
            code: "stub-identity:o-x",
            consentVersion: 1,
          })
        ).statusCode,
      ).toBe(503);
      const refreshed = await f.request("POST", "auth/refresh", {
        refreshToken: credential.refreshToken,
      });
      expect(refreshed.statusCode).toBe(200);
      expect(
        (
          await f.request(
            "POST",
            "auth/logout",
            undefined,
            refreshed.json().accessToken,
          )
        ).statusCode,
      ).toBe(204);
    } finally {
      await f.close();
    }
  });
});
