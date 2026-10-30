import { afterEach, expect, it, vi } from "vitest";
import { createControlService, createReviewService } from "./adapters";
import { reviewExamples } from "./console/review-examples";
import { ConsoleError } from "./console/resource";
it("未创建运行的中断受理按原请求ID恢复，不传新的扫描参数", async () => {
  const request = vi
    .fn()
    .mockResolvedValue({ requestId: "new-request", status: "accepted" });
  const service = createControlService({ request });
  await service.retry("original-request", {
    operationId: "retry-op",
    reason: "核对原受理范围",
  });
  expect(request).toHaveBeenCalledWith(
    "/ingestion/requests/original-request/retry",
    {
      method: "POST",
      body: { operationId: "retry-op", reason: "核对原受理范围" },
    },
  );
});
afterEach(() => sessionStorage.removeItem("hh-admin-ingestion"));
it("身份核实后Cookie变化导致403时仍保留原操作恢复线索", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("network"))
    .mockResolvedValueOnce({ id: "admin-a" })
    .mockRejectedValueOnce(new ConsoleError(404, "not found"))
    .mockRejectedValueOnce(new ConsoleError(403, "csrf changed"));
  const service = createControlService({ request }, () => "admin-a");
  await expect(
    service.scan({
      sourceId: "life-sciences",
      from: "2026-10-01",
      to: "2026-10-02",
      url: "",
      preview: true,
      operationId: "32b908b0-4ff0-487e-b58c-49454a832a93",
      reason: "核对",
    }),
  ).rejects.toThrow();
  await expect(service.recoverPending!()).rejects.toMatchObject({
    status: 403,
  });
  expect(service.pendingOperation?.()).toBe(
    "32b908b0-4ff0-487e-b58c-49454a832a93",
  );
});
it("恢复前核实服务器身份，其他标签切换账号后不查询或重放旧命令", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("network"))
    .mockResolvedValueOnce({ id: "admin-b" });
  const service = createControlService({ request }, () => "admin-a");
  await expect(
    service.scan({
      sourceId: "life-sciences",
      from: "2026-10-01",
      to: "2026-10-02",
      url: "",
      preview: true,
      operationId: "32b908b0-4ff0-487e-b58c-49454a832a93",
      reason: "核对",
    }),
  ).rejects.toThrow();
  await expect(service.recoverPending!()).rejects.toMatchObject({
    status: 409,
  });
  expect(request).toHaveBeenLastCalledWith("/auth/session");
  expect(service.pendingOperation?.()).not.toBeNull();
  sessionStorage.removeItem("hh-admin-ingestion");
});
it("受理响应丢失时先查询；未找到才按相同输入和operationId恢复", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("network"))
    .mockRejectedValueOnce(new ConsoleError(404, "not accepted"))
    .mockResolvedValueOnce({ requestId: "restored", status: "accepted" });
  const service = createControlService({ request });
  const input = {
    sourceId: "life-sciences",
    from: "2026-10-01",
    to: "2026-10-02",
    url: "",
    preview: true,
    operationId: "32b908b0-4ff0-487e-b58c-49454a832a93",
    reason: "核对",
  };
  await expect(service.scan(input)).rejects.toThrow("network");
  expect(service.pendingOperation?.()).toBe(input.operationId);
  await service.recoverPending!();
  expect(request.mock.calls[1]?.[0]).toBe(
    "/ingestion/requests/by-operation/" + input.operationId,
  );
  expect(request.mock.calls[2]).toEqual(request.mock.calls[0]);
  expect(service.pendingOperation?.()).toBeNull();
});

it("扫描省略空 URL，202只表示受理，中断作为独立终态", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ requestId: "r", status: "accepted" })
    .mockResolvedValueOnce({
      requestId: "r",
      status: "interrupted",
      runId: null,
      result: null,
      error: "进程中断",
    });
  const service = createControlService({ request });
  expect(
    await service.scan({
      sourceId: "life-sciences",
      from: "2026-10-01",
      to: "2026-10-02",
      url: "",
      preview: true,
      operationId: "op",
      reason: "核对",
    }),
  ).toMatchObject({ state: "accepted", requestId: "r" });
  expect(request.mock.calls[0]![1].body).not.toHaveProperty("url");
  expect(await service.request("r")).toMatchObject({ state: "interrupted" });
});
it("预览回执与同一材料绑定，发布采用独立的正式基线命令", async () => {
  const request = vi
    .fn()
    .mockResolvedValue({ preview: true, previewId: "receipt", changes: [] });
  const service = createReviewService({ request });
  const material = structuredClone(reviewExamples[0]!.material);
  const receipt = await service.preview(material, "publish");
  expect(receipt).toMatchObject({
    contentKey: JSON.stringify(material),
    token: "receipt",
  });
  await service.change("publish", material, "发布核对", "command", receipt);
  expect(request.mock.calls[1]![1].body).toMatchObject({
    operationId: "command",
    baseline: material.baseline,
    previewId: "receipt",
    confirm: true,
  });
  expect(request.mock.calls[1]![1].body).not.toHaveProperty("review");
});
