import { afterEach, describe, expect, it, vi } from "vitest";
import { createPublicCatalog } from "./public-catalog";
afterEach(() => vi.unstubAllGlobals());
describe("公开目录真实请求适配", () => {
  it("请求公开学院和比赛契约，不请求管理目录", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(String(url));
      return new Response(
        JSON.stringify(
          String(url).endsWith("/colleges")
            ? [{ id: "public-college", name: "公开学院", order: 1 }]
            : {
                items: [],
                totalPages: 0,
                page: 1,
                pageSize: 5,
                hasMore: false,
                totalStages: 0,
                totalCompetitions: 0,
                evaluatedAt: "2026-10-20T00:00:00Z",
              },
        ),
        { status: 200 },
      );
    });
    const api = createPublicCatalog();
    expect(await api.colleges()).toHaveLength(1);
    expect((await api.list("公开 比赛", 1)).items).toEqual([]);
    expect(urls[0]).toBe("/api/v1/colleges");
    expect(urls[1]).toContain("/api/v1/competitions?");
    expect(urls[1]).toContain("q=");
  });
  it("缺失或错误响应不伪装成空列表", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("<html>not api</html>", { status: 200 }),
    );
    await expect(createPublicCatalog().colleges()).rejects.toThrow();
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 503 }));
    await expect(createPublicCatalog().list("", 1)).rejects.toThrow();
  });
});
