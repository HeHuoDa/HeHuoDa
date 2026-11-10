import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import ElementPlus from "element-plus";
import ReviewEvidence from "./ReviewEvidence.vue";
import { reviewExamples } from "../console/review-examples";
import { toReviewDraft } from "../console/review-draft";
import type { ReviewInput } from "../console/review";

async function setup(file: ReviewInput, noticeId = "notice-1") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/ingestion/notices/:id", component: { template: "<div />" } },
    ],
  });
  await router.push("/ingestion/notices/notice-1");
  await router.isReady();
  const wrapper = mount(ReviewEvidence, {
    props: { file, noticeId },
    global: { plugins: [ElementPlus, router] },
  });
  return wrapper;
}

describe("候选证据展示", () => {
  it("新契约候选分别展示通知类型与赛事种类", async () => {
    const file = toReviewDraft(reviewExamples[0]!.material);
    file.candidate.classification = {
      classification: "definite",
      notificationKind: "supplement",
      ruleVersion: "competition-rules-8",
      reasons: ["标题含变更词"],
      exclusions: [],
      needsReview: true,
      priority: 1,
    };
    file.candidate.fieldsV2 = {
      ...file.candidate.fieldsV2!,
      eventKind: "学科竞赛",
      mode: "个人作品或集体作品均可",
      modeKind: "mixed",
    };
    const wrapper = await setup(file);
    const text = wrapper.text();
    expect(text).toContain("变更补充");
    expect(text).toContain("学科竞赛");
    expect(text).toContain("个人作品或集体作品均可");
    expect(text).toContain("归一结果：个人或团队");
    wrapper.unmount();
  });

  it("未知通知类型显示未知，不显示报名通知", async () => {
    const file = toReviewDraft(reviewExamples[0]!.material);
    file.candidate.classification = {
      classification: "definite",
      notificationKind: "unknown-kind",
      ruleVersion: "competition-rules-8",
      reasons: [],
      exclusions: [],
      needsReview: true,
      priority: 1,
    } as unknown as ReviewInput["candidate"]["classification"];
    const wrapper = await setup(file);
    expect(wrapper.text()).toContain("未知通知类型");
    expect(wrapper.text()).not.toContain("报名通知");
    wrapper.unmount();
  });

  it("旧材料没有 v2 字段时给出显式说明，不伪造赛事种类", async () => {
    const file = toReviewDraft(reviewExamples[11]!.material);
    expect(file.candidate.fieldsV2).toBeUndefined();
    file.candidate.fields = { ...file.candidate.fields, kind: "award" };
    const wrapper = await setup(file);
    const text = wrapper.text();
    expect(text).toContain("旧版审核材料没有候选 v2 字段");
    expect(text).toContain("获奖公示");
    // 旧 kind 是通知种类，不能出现在赛事种类位置。
    expect(text).not.toContain("赛事种类获奖公示");
    wrapper.unmount();
  });

  it("保留冲突、缺失与警告，并声明形态检查不等于依据充分", async () => {
    const file = toReviewDraft(reviewExamples[0]!.material);
    file.candidate.conflicts = ["参赛形式存在互不覆盖的要求，须人工核对"];
    file.candidate.missing = ["eventKind"];
    file.candidate.warnings = ["附件仅记录链接，未解析或核实附件规则"];
    const wrapper = await setup(file);
    const text = wrapper.text();
    expect(text).toContain("冲突（须人工解决）");
    expect(text).toContain("缺少字段：eventKind");
    expect(text).toContain("附件仅记录链接");
    expect(text).toContain("不等于「依据充分」");
    wrapper.unmount();
  });

  it("附件证据缺版本时不给定位链接并说明原因", async () => {
    const file = toReviewDraft(reviewExamples[0]!.material);
    file.evidenceReferences = [
      {
        format: "pdf",
        url: "https://example.edu/a.pdf",
        noticeVersion: "v1",
        attachmentVersion: null,
        page: 2,
        field: "attachmentText",
        excerpt: "第一页内容",
      },
      {
        format: "docx",
        url: "https://example.edu/b.docx",
        noticeVersion: "v1",
        attachmentVersion: "attach-v3",
        paragraph: 4,
        field: "attachmentText",
        excerpt: "第四段内容",
      },
    ];
    const wrapper = await setup(file);
    const text = wrapper.text();
    expect(text).toContain("未绑定附件版本");
    expect(text).toContain("attach-v3");
    expect(text).toContain("DOCX 第4段");
    const targets = wrapper
      .findAllComponents({ name: "RouterLink" })
      .map((link) => link.props("to") as { query?: Record<string, string> });
    expect(
      targets.some(
        (to) =>
          to?.query?.attachmentVersion === "attach-v3" &&
          to?.query?.segment === "4",
      ),
    ).toBe(true);
    wrapper.unmount();
  });

  it("渲染后仍可见赛道规则与否定条款，不被展示层吞掉", async () => {
    const file = toReviewDraft(reviewExamples[0]!.material);
    file.candidate.fieldsV2 = {
      ...file.candidate.fieldsV2!,
      rules: ["须提交原创作品"],
      tracks: [
        {
          name: "综合赛道",
          modeKind: "team",
          members: "3 人",
          rules: "不得提交已获奖作品，仅限未毕业学生。",
        },
      ],
    };
    const wrapper = await setup(file);
    const text = wrapper.text();
    expect(text).toContain("参赛规则");
    expect(text).toContain("须提交原创作品");
    expect(text).toContain("赛道规则：综合赛道");
    expect(text).toContain("不得提交已获奖作品，仅限未毕业学生。");
    wrapper.unmount();
  });

  it("旧材料渲染后仍可见已有规则、赛道规则与日期", async () => {
    const file = toReviewDraft(reviewExamples[11]!.material);
    expect(file.candidate.fieldsV2).toBeUndefined();
    file.candidate.fields = {
      ...file.candidate.fields,
      kind: "registration",
      rules: ["不接受跨校组队"],
      tracks: [
        {
          name: "历史赛道",
          mode: "team",
          members: "2 人",
          rules: "往届获奖作品不得重复提交。",
        },
      ],
      deadline: { precision: "date", value: "2026-11-08" },
    };
    const wrapper = await setup(file);
    const text = wrapper.text();
    expect(text).toContain("旧版审核材料没有候选 v2 字段");
    expect(text).toContain("参赛规则（旧）");
    expect(text).toContain("不接受跨校组队");
    expect(text).toContain("赛道规则（旧）：历史赛道");
    expect(text).toContain("往届获奖作品不得重复提交。");
    expect(text).toContain("报名截止（旧）");
    expect(text).toContain("2026-11-08");
    wrapper.unmount();
  });
});
