import { cleanupAuthArtifacts } from "./auth-cleanup.js";

describe("认证数据清理", () => {
  it("拒绝非法的审计保留天数且不外联", async () => {
    const pool = {
      query: async () => {
        throw new Error("校验失败前不应触达数据库");
      },
    };
    await expect(cleanupAuthArtifacts(pool as never, 0)).rejects.toThrow();
    await expect(cleanupAuthArtifacts(pool as never, 1.5)).rejects.toThrow();
    await expect(
      cleanupAuthArtifacts(pool as never, Number.NaN),
    ).rejects.toThrow();
  });
});
