import { validateEnvironment } from "./env.validation.js";

describe("validateEnvironment", () => {
  it("可信代理默认禁用，拒绝任意来源和非法网段配置", () => {
    expect(validateEnvironment({}).API_TRUSTED_PROXY_CIDRS).toBe("");
    expect(
      validateEnvironment({ API_TRUSTED_PROXY_CIDRS: "172.20.0.0/16" })
        .API_TRUSTED_PROXY_CIDRS,
    ).toBe("172.20.0.0/16");
    for (const cidrs of [
      "true",
      "0.0.0.0/0",
      "172.20.0.0/33",
      "http://proxy",
      "172.20.0.0",
    ])
      expect(() =>
        validateEnvironment({ API_TRUSTED_PROXY_CIDRS: cidrs }),
      ).toThrow();
  });
  it("校园核验默认关闭，开启时必须配置独立密钥和明确学期", () => {
    expect(validateEnvironment({}).CAMPUS_VERIFICATION_ENABLED).toBe(false);
    expect(() =>
      validateEnvironment({ CAMPUS_VERIFICATION_ENABLED: true }),
    ).toThrow();
    const base = {
      CAMPUS_VERIFICATION_ENABLED: true,
      CAMPUS_SUBJECT_HMAC_KEY: Buffer.alloc(32, 1).toString("base64"),
      CAMPUS_PROFILE_KEYS: JSON.stringify({
        v1: Buffer.alloc(32, 2).toString("base64"),
      }),
      CAMPUS_PROFILE_KEY_ID: "v1",
      CAMPUS_TERMS: JSON.stringify([
        {
          id: "synthetic",
          startAt: "2026-09-01T00:00:00+08:00",
          endAt: "2027-02-01T00:00:00+08:00",
        },
      ]),
    };
    expect(validateEnvironment(base).CAMPUS_VERIFICATION_ENABLED).toBe(true);
    for (const terms of [
      [
        {
          id: "duplicate",
          startAt: "2026-09-01T00:00:00Z",
          endAt: "2026-10-01T00:00:00Z",
        },
        {
          id: "duplicate",
          startAt: "2026-10-01T00:00:00Z",
          endAt: "2026-11-01T00:00:00Z",
        },
      ],
      [
        {
          id: "one",
          startAt: "2026-09-01T00:00:00Z",
          endAt: "2026-10-01T00:00:00Z",
        },
        {
          id: "two",
          startAt: "2026-09-30T23:59:59Z",
          endAt: "2026-11-01T00:00:00Z",
        },
      ],
      [
        {
          id: "reversed",
          startAt: "2026-10-01T00:00:00Z",
          endAt: "2026-09-01T00:00:00Z",
        },
      ],
    ])
      expect(() =>
        validateEnvironment({ ...base, CAMPUS_TERMS: JSON.stringify(terms) }),
      ).toThrow();
    expect(() =>
      validateEnvironment({
        ...base,
        CAMPUS_TERMS: JSON.stringify([
          { id: "bad", startAt: "2026-09-01", endAt: "2027-02-01" },
        ]),
      }),
    ).toThrow();
    expect(() =>
      validateEnvironment({
        ...base,
        CAMPUS_PROFILE_KEYS: JSON.stringify({
          v1: base.CAMPUS_SUBJECT_HMAC_KEY,
        }),
      }),
    ).toThrow();
  });
  it("requires a database in production and defaults documentation to private", () => {
    expect(() => validateEnvironment({ NODE_ENV: "production" })).toThrow();
    const config = validateEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://test:test@db:5432/test",
      HOST: "0.0.0.0",
    });
    expect(config.HOST).toBe("0.0.0.0");
    expect(config.SWAGGER_ENABLED).toBe(false);
    expect(validateEnvironment({ NODE_ENV: "test" }).SWAGGER_ENABLED).toBe(
      true,
    );
    expect(() => validateEnvironment({ HOST: "invalid host" })).toThrow();
  });
  it("enables the daily schedule by default and accepts an explicit stop", () => {
    expect(
      validateEnvironment({ NODE_ENV: "development" }).INGESTION_ENABLED,
    ).toBe(true);
    expect(
      validateEnvironment({ INGESTION_ENABLED: "false" }).INGESTION_ENABLED,
    ).toBe(false);
  });
  it("defaults PORT to 3001 when it is missing", () => {
    expect(validateEnvironment({ NODE_ENV: "test" }).PORT).toBe(3001);
  });

  it("rejects a PORT outside the TCP port range", () => {
    expect(() => validateEnvironment({ PORT: "70000" })).toThrow();
  });

  it("keeps wechat login disabled by default without credentials", () => {
    const config = validateEnvironment({ NODE_ENV: "test" });
    expect(config.WECHAT_LOGIN_ENABLED).toBe(false);
    expect(config.WECHAT_APP_ID).toBe("");
    expect(config.WECHAT_APP_SECRET).toBe("");
    expect(config.WECHAT_LOGIN_ADAPTER).toBe("real");
  });

  it("requires appid and secret once wechat login is enabled", () => {
    expect(() =>
      validateEnvironment({ WECHAT_LOGIN_ENABLED: "true" }),
    ).toThrow();
    const config = validateEnvironment({
      WECHAT_LOGIN_ENABLED: "true",
      WECHAT_APP_ID: "wxtestappid1234567",
      WECHAT_APP_SECRET: "test-secret-32-chars-aaaaaaaaaa",
    });
    expect(config.WECHAT_APP_ID).toBe("wxtestappid1234567");
  });

  it("rejects the stub adapter outside non-production environments", () => {
    expect(
      validateEnvironment({
        NODE_ENV: "test",
        WECHAT_LOGIN_ADAPTER: "stub",
      }).WECHAT_LOGIN_ADAPTER,
    ).toBe("stub");
    expect(() =>
      validateEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://test:test@db:5432/test",
        WECHAT_LOGIN_ADAPTER: "stub",
      }),
    ).toThrow();
  });

  it("provides rate budgets and audit retention with safe defaults", () => {
    const config = validateEnvironment({ NODE_ENV: "test" });
    expect(config.AUTH_RATE_LOGIN_PER_SOURCE).toBe(10);
    expect(config.AUTH_RATE_LOGIN_PER_IDENTITY).toBe(20);
    expect(config.AUTH_RATE_LOGIN_GLOBAL).toBe(300);
    expect(config.AUTH_RATE_REFRESH_PER_SUBJECT).toBe(20);
    expect(config.AUTH_RATE_REFRESH_GLOBAL).toBe(600);
    expect(config.AUTH_AUDIT_RETENTION_DAYS).toBe(180);
    expect(() =>
      validateEnvironment({ AUTH_AUDIT_RETENTION_DAYS: "0" }),
    ).toThrow();
  });
});
