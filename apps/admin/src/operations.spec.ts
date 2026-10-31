import { afterEach, expect, it, vi } from "vitest";
import { createOperationsService } from "./operations";
import { createControlService } from "./adapters";
import { ConsoleError } from "./console/resource";
afterEach(() => sessionStorage.removeItem("hh-admin-ingestion"));

it("另一通知的附件页不能恢复或重放原通知命令", async () => {
  const original = createOperationsService(
    { request: vi.fn().mockRejectedValue(new TypeError("network")) },
    () => "actor",
    () => "old-notice",
  );
  await expect(
    original.reparse("05a45dca-68ca-4ea5-ad1c-c13e1cdc0ee7", {
      versionId: "v",
      baseline: 1,
      operationId: "32b908b0-4ff0-487e-b58c-49454a832a93",
      reason: "原通知",
    }),
  ).rejects.toThrow();
  const request = vi.fn();
  const other = createOperationsService(
    { request },
    () => "actor",
    () => "new-notice",
  );
  expect(other.pendingOperation()).toBeNull();
  await expect(other.recoverPending()).rejects.toMatchObject({ status: 404 });
  expect(request).not.toHaveBeenCalled();
  expect(original.pendingOperation()).not.toBeNull();
});

it("附件页不恢复或覆盖同一管理员遗留的扫描命令", async () => {
  const scan = createControlService(
    { request: vi.fn().mockRejectedValue(new TypeError("network")) },
    () => "actor",
  );
  const operationId = "32b908b0-4ff0-487e-b58c-49454a832a93";
  await expect(
    scan.scan({
      sourceId: "registered",
      from: "2026-10-01",
      to: "2026-10-31",
      url: "",
      preview: true,
      reason: "原扫描",
      operationId,
    }),
  ).rejects.toThrow();
  const request = vi.fn();
  const attachment = createOperationsService({ request }, () => "actor");
  expect(attachment.pendingOperation()).toBeNull();
  await expect(attachment.recoverPending()).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    attachment.reparse("a", {
      versionId: "v",
      baseline: 1,
      operationId: "new",
      reason: "新附件",
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(request).not.toHaveBeenCalled();
  expect(scan.pendingOperation?.()).toBe(operationId);
});

it("刷新后按当前管理员恢复附件命令，保留原版本、理由和证据基线", async () => {
  const body = {
    operationId: "32b908b0-4ff0-487e-b58c-49454a832a93",
    versionId: "version",
    baseline: 7,
    reason: "核对原始提取版本",
  };
  const first = createOperationsService(
    { request: vi.fn().mockRejectedValue(new TypeError("network")) },
    () => "actor",
  );
  await expect(
    first.reparse("05a45dca-68ca-4ea5-ad1c-c13e1cdc0ee7", body),
  ).rejects.toThrow();
  const request = vi
    .fn()
    .mockResolvedValueOnce({ id: "actor" })
    .mockRejectedValueOnce(new ConsoleError(404, "not found"))
    .mockResolvedValueOnce({ requestId: "same-request", status: "accepted" });
  const restored = createOperationsService({ request }, () => "actor");
  expect(restored.pendingOperation()).toBe(body.operationId);
  await restored.recoverPending();
  expect(request.mock.calls[0]![0]).toBe("/auth/session");
  expect(request.mock.calls[2]).toEqual([
    "/ingestion/attachments/05a45dca-68ca-4ea5-ad1c-c13e1cdc0ee7/reparse",
    { method: "POST", body },
  ]);
  expect(restored.pendingOperation()).toBeNull();
});

it("附件受理响应丢失后先查原标识，404时只重放同一命令", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("network"))
    .mockRejectedValueOnce(new ConsoleError(404, "not accepted"))
    .mockResolvedValueOnce({
      requestId: "accepted-request",
      status: "accepted",
    });
  const service = createOperationsService({ request });
  const body = {
    baseline: 3,
    versionId: "version",
    operationId: "op",
    reason: "核对原版本",
  };
  await expect(service.reparse("attachment", body)).rejects.toThrow("network");
  expect(service.pendingOperation()).toBe("op");
  await service.recoverPending();
  expect(request.mock.calls[1]![0]).toBe("/ingestion/requests/by-operation/op");
  expect(request.mock.calls[2]).toEqual(request.mock.calls[0]);
  expect(service.pendingOperation()).toBeNull();
});

it("栏目操作使用登记来源和栏目路径，保留核验与基线命令", async () => {
  const request = vi.fn().mockResolvedValue({});
  const service = createOperationsService({ request });
  const command = {
    status: "verified" as const,
    checkedAt: "2026-10-31",
    sampleUrls: ["https://example.edu/info/1.htm"],
    paginationResult: "success" as const,
    reason: "核对分页与公开样本",
    operationId: "op",
  };
  await service.verify("source", "channel", command);
  expect(request).toHaveBeenCalledWith(
    "/ingestion/sources/source/channels/channel/verification",
    {
      method: "PUT",
      body: command,
    },
  );
  await service.configure("source", "channel", {
    baseline: "baseline",
    enabled: false,
    reason: "停用",
    operationId: "stop",
  });
  expect(request).toHaveBeenLastCalledWith(
    "/ingestion/sources/source/channels/channel",
    {
      method: "PATCH",
      body: {
        baseline: "baseline",
        enabled: false,
        reason: "停用",
        operationId: "stop",
      },
    },
  );
});
it("附件版本文本分页读取，重解析保留内容版本和证据基线，202不当作完成", async () => {
  const request = vi
    .fn()
    .mockResolvedValue({ requestId: "accepted-request", status: "accepted" });
  const service = createOperationsService({ request });
  await service.attachmentText("attachment", "version", 3);
  expect(request).toHaveBeenLastCalledWith(
    "/ingestion/attachments/attachment/versions/version?page=3&pageSize=10",
  );
  const body = {
    baseline: 7,
    versionId: "version",
    operationId: "op",
    reason: "重新核对提取",
  };
  expect(await service.reparse("attachment", body)).toEqual({
    requestId: "accepted-request",
    status: "accepted",
  });
  expect(request).toHaveBeenLastCalledWith(
    "/ingestion/attachments/attachment/reparse",
    { method: "POST", body },
  );
});
