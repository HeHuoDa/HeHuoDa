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
});
