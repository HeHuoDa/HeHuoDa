import { expect, it, vi } from "vitest";
import { createOperationsService } from "./operations";

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
