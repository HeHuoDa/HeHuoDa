import {
  generateH5RefreshToken,
  generateH5TokenPair,
  generateToken,
  generateTokenPair,
  hashToken,
  isH5RefreshToken,
  isNativeRefreshToken,
} from "./auth-token.js";

describe("平台凭据工具", () => {
  it("生成高熵不重复的 base64url 令牌", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const pair = generateTokenPair();
    expect(pair.accessToken).not.toBe(pair.refreshToken);
    expect(isNativeRefreshToken(pair.refreshToken)).toBe(true);
    expect(isH5RefreshToken(pair.refreshToken)).toBe(false);
  });

  it("生成并隔离 H5 专用刷新凭据格式", () => {
    const h5 = generateH5RefreshToken();
    expect(h5).toMatch(/^h5_[A-Za-z0-9_-]{43}$/);
    expect(isH5RefreshToken(h5)).toBe(true);
    expect(isNativeRefreshToken(h5)).toBe(false);
    const pair = generateH5TokenPair();
    expect(isNativeRefreshToken(pair.accessToken)).toBe(true);
    expect(isH5RefreshToken(pair.refreshToken)).toBe(true);
    expect(hashToken(h5)).not.toBe(hashToken(h5.slice(3)));
  });

  it("仅保存摘要且不可反推明文", () => {
    const token = generateToken();
    const digest = hashToken(token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toBe(token);
    expect(digest).not.toContain(token);
  });
});
