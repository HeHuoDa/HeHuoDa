import { describe, expect, it } from "vitest";
import {
  allowedReviewAction,
  samePreview,
  validateReviewDraft,
} from "./review";
import { reviewExamples } from "./review-examples";
describe("候选审核页面规则", () => {
  it("人工日期和理由不可猜测，已导入不能拒绝，已发布更新预览绑定同一内容", () => {
    const file = structuredClone(reviewExamples[0]!.material);
    expect(validateReviewDraft(file)).toMatchObject({ field: "checkedAt" });
    file.checkedAt = "2026-02-30";
    expect(validateReviewDraft(file)?.field).toBe("checkedAt");
    file.checkedAt = "2026-10-20";
    file.resolution = "已核对来源与缺失字段";
    expect(validateReviewDraft(file)).toBeNull();
    expect(allowedReviewAction("imported", "reject")).toBe(false);
    expect(allowedReviewAction("rejected", "reopen")).toBe(true);
    const key = JSON.stringify(file);
    expect(samePreview(key, file)).toBe(true);
    file.batch.competitions[0]!.name = "改动后的内容";
    expect(samePreview(key, file)).toBe(false);
  });
});
