import { generateToken, generateTokenPair, hashToken } from "./auth-token.js";

describe("平台凭据工具", () => {
  it("生成高熵不重复的 base64url 令牌", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const pair = generateTokenPair();
    expect(pair.accessToken).not.toBe(pair.refreshToken);
  });
  it("仅保存摘要且不可反推明文", () => {
    const token = generateToken();
    const digest = hashToken(token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toBe(token);
    expect(digest).not.toContain(token);
  });
});
