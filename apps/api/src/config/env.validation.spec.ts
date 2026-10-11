import { validateEnvironment } from "./env.validation.js";

describe("validateEnvironment", () => {
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
