import { describe, expect, it } from "vitest";
import { createResourceController } from "./resource";

describe("管理查询公开边界", () => {
  it("空列表不伪装失败，查询失败清理旧数据并可重新加载", async () => {
    const controller = createResourceController<string>();
    const pending = controller.load(() =>
      Promise.resolve({ items: [], total: 0 }),
    );
    expect(controller.state.status).toBe("loading");
    await pending;
    expect(controller.state.status).toBe("ready");
    expect(controller.state.items).toEqual([]);
    await controller.load(() => Promise.reject(new Error("network")));
    expect(controller.state.status).toBe("error");
    expect(controller.state.error).toContain("请求失败");
    expect(controller.state.items).toEqual([]);
    await controller.load(() => Promise.resolve({ items: ["恢复"], total: 1 }));
    expect(controller.state.status).toBe("ready");
    expect(controller.state.items).toEqual(["恢复"]);
  });
  it("切换查询立即清理旧数据，迟到列表和详情不能覆盖新视图", async () => {
    let resolveOld!: (value: { items: string[]; total: number }) => void;
    const controller = createResourceController<string>();
    const old = controller.load(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    await controller.select(() => Promise.resolve("旧详情"));
    await controller.load(() =>
      Promise.resolve({ items: ["新记录"], total: 1 }),
    );
    resolveOld({ items: ["旧记录"], total: 1 });
    await old;
    expect(controller.state.items).toEqual(["新记录"]);
    expect(controller.state.detail).toBeNull();
    let resolveDetail!: (value: string) => void;
    const detail = controller.select(
      () =>
        new Promise((resolve) => {
          resolveDetail = resolve;
        }),
    );
    controller.clear();
    resolveDetail("已离开的记录");
    await detail;
    expect(controller.state.detail).toBeNull();
  });
});
