import { expect, it, vi } from "vitest";
import { createControlService, createReviewService } from "./adapters";
import { reviewExamples } from "./console/review-examples";

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
