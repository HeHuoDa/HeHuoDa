import { validateEnvironment } from "./env.validation.js";

describe("validateEnvironment", () => {
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
