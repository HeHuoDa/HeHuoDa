import { generateH5RefreshToken, generateToken } from "./auth-token.js";
import {
  assertH5OriginAndCsrf,
  assertNativeClientBoundary,
  buildH5RefreshCookie,
  clearH5RefreshCookie,
  h5Origins,
  isH5ChannelRequest,
  readH5RefreshCookie,
} from "./h5-security.js";

describe("H5 Cookie 与来源安全工具", () => {
  const allowed = ["https://app.example"];

  it("仅接受精确 Origin 或在缺失 Origin 时解析合法 Referer 源", () => {
    expect(() =>
      assertH5OriginAndCsrf(
        { origin: "https://app.example", "x-refresh-csrf": "1" },
        allowed,
      ),
    ).not.toThrow();

    expect(() =>
      assertH5OriginAndCsrf(
        {
          referer: "https://app.example/pages/auth/login?next=/",
          "x-refresh-csrf": "1",
        },
        allowed,
      ),
    ).not.toThrow();

    for (const headers of [
      { "x-refresh-csrf": "1" },
      { origin: "https://evil.example", "x-refresh-csrf": "1" },
      {
        origin: "null",
        referer: "https://app.example/login",
        "x-refresh-csrf": "1",
      },
      {
        origin: "https://evil.example",
        referer: "https://app.example/login",
        "x-refresh-csrf": "1",
      },
      {
        referer: "https://app.example.evil.com/login",
        "x-refresh-csrf": "1",
      },
      { origin: "https://app.example" },
      { origin: "https://app.example", "x-refresh-csrf": "0" },
      { origin: "https://app.example", "x-refresh-csrf": ["1", "1"] },
    ])
      expect(() => assertH5OriginAndCsrf(headers, allowed)).toThrow();

    expect(() =>
      assertH5OriginAndCsrf(
        { origin: "https://app.example", "x-refresh-csrf": "1" },
        [],
      ),
    ).toThrow();
  });

  it("解析 H5 Cookie 并拒绝重复名称、空值或原生格式", () => {
    const h5 = generateH5RefreshToken();
    const native = generateToken();
    expect(readH5RefreshCookie(undefined)).toEqual({ state: "absent" });
    expect(readH5RefreshCookie("other=1")).toEqual({ state: "absent" });
    expect(readH5RefreshCookie(`hh_user_refresh=${h5}`)).toEqual({
      state: "present",
      token: h5,
    });
    expect(
      readH5RefreshCookie(`hh_user_refresh=${h5}; hh_user_refresh=${h5}`),
    ).toEqual({
      state: "invalid",
    });
    expect(readH5RefreshCookie("hh_user_refresh=")).toEqual({
      state: "invalid",
    });
    expect(readH5RefreshCookie(`hh_user_refresh=${native}`)).toEqual({
      state: "invalid",
    });
    expect(isH5ChannelRequest({ cookie: "hh_user_refresh=" })).toBe(true);
    expect(isH5ChannelRequest({ "x-refresh-csrf": "1" })).toBe(true);
    expect(isH5ChannelRequest({})).toBe(false);
  });

  it("原生边界拒绝浏览器来源特征头或 H5 Cookie", () => {
    expect(() => assertNativeClientBoundary({})).not.toThrow();
    for (const headers of [
      { origin: "https://app.example" },
      { origin: "null" },
      { referer: "https://app.example/" },
      { "sec-fetch-site": "same-origin" },
      { "sec-fetch-mode": "cors" },
      { "sec-fetch-dest": "empty" },
      { "sec-fetch-user": "?1" },
      { "x-refresh-csrf": "1" },
      { cookie: `hh_user_refresh=${generateH5RefreshToken()}` },
    ])
      expect(() => assertNativeClientBoundary(headers)).toThrow();
  });

  it("生成和清除 Cookie 严格遵循路径、作用域与生产 Secure", () => {
    const now = new Date("2026-10-25T00:00:00.000Z");
    const expires = new Date("2026-11-24T00:00:00.000Z");
    const token = generateH5RefreshToken();
    const prod = buildH5RefreshCookie(token, expires, now, true);
    expect(prod).toBe(
      `hh_user_refresh=${token}; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=2592000; Expires=Tue, 24 Nov 2026 00:00:00 GMT; Secure`,
    );
    expect(prod).not.toMatch(/Domain=/i);

    const dev = buildH5RefreshCookie(token, expires, now, false);
    expect(dev).not.toContain("; Secure");

    expect(clearH5RefreshCookie(true)).toBe(
      "hh_user_refresh=; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
    );
    expect(clearH5RefreshCookie(false)).toBe(
      "hh_user_refresh=; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=0",
    );
  });

  it("配置层 H5_ALLOWED_ORIGINS 拒绝非 HTTPS 生产源与非法路径", () => {
    expect(h5Origins("", true)).toEqual([]);
    expect(
      h5Origins("https://app.example, https://h5.example:8443", true),
    ).toEqual(["https://app.example", "https://h5.example:8443"]);
    expect(() => h5Origins("http://app.example", true)).toThrow();
    expect(() => h5Origins("https://app.example/path", false)).toThrow();
    expect(() => h5Origins("*", false)).toThrow();
  });
});
