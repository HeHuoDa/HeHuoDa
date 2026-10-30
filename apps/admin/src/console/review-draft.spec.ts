import { describe, expect, it } from "vitest";
import { toReviewDraft, serializeReviewDraft } from "./review-draft";
import { reviewExamples } from "./review-examples";
describe("服务端审核材料局部补丁", () => {
  it("嵌套关系缺省保留，空数组清空，非空数组替换；外层实体仍按ID补丁合并", () => {
    const input = structuredClone(reviewExamples[1]!.material);
    const before = input.formalBefore!.stages[0]!;
    before.hosts = ["science"];
    before.sourceIds = ["example-notice-ref"];
    before.scope = { kind: "colleges", colleges: ["science"], note: "" };
    input.batch.competitions = [
      { id: input.targetId, stages: [{ id: before.id }] },
    ];
    const draft = toReviewDraft(input);
    expect(draft.batch.competitions[0]!.stages[0]!.hosts).toEqual(["science"]);
    draft.batch.competitions[0]!.stages[0]!.hosts = [];
    draft.batch.competitions[0]!.stages[0]!.sourceIds = [];
    draft.batch.competitions[0]!.stages[0]!.scope.colleges = ["law"];
    const stage = serializeReviewDraft(draft, input).batch.competitions[0]!
      .stages![0]!;
    expect(stage).toMatchObject({
      hosts: [],
      sourceIds: [],
      scope: { colleges: ["law"] },
    });
    expect(
      toReviewDraft({
        ...input,
        batch: { competitions: [{ id: input.targetId, stages: [] }] },
      }).batch.competitions[0]!.stages,
    ).toHaveLength(1);
  });
  it("已有目标的合法id/notices补丁继承正式字段，未编辑提交保持原形", () => {
    const input = structuredClone(reviewExamples[1]!.material);
    input.batch.competitions = [
      { id: input.targetId, notices: input.batch.competitions[0]!.notices },
    ];
    const draft = toReviewDraft(input);
    expect(draft.batch.competitions[0]!.name).toBe(input.formalBefore!.name);
    expect(draft.batch.competitions[0]!.stages).toHaveLength(1);
    expect(serializeReviewDraft(draft, input)).toEqual(input);
    draft.batch.competitions[0]!.organizer = "";
    expect(
      serializeReviewDraft(draft, input).batch.competitions[0],
    ).not.toHaveProperty("organizer");
    draft.batch.competitions[0]!.name = "人工修正名称";
    expect(
      serializeReviewDraft(draft, input).batch.competitions[0],
    ).toMatchObject({ name: "人工修正名称" });
    expect(
      serializeReviewDraft(draft, input).batch.competitions[0],
    ).not.toHaveProperty("stages");
  });
});
