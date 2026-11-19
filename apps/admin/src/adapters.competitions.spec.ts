import { describe, expect, it, vi } from "vitest";
import { createCompetitionService } from "./adapters";
import {
  competitionPatch,
  emptyCompetition,
  exampleCompetitions,
} from "./console/competitions";
import type { PageQuery } from "./console/resource";

const query = (value: Partial<PageQuery> = {}): PageQuery => ({
  q: "",
  status: "",
  from: "",
  to: "",
  page: 1,
  pageSize: 20,
  ...value,
});
const baseline = "a".repeat(64);
const item = (id: string) => ({
  id,
  name: "全国大学生创新竞赛 " + id,
  edition: "2026",
  category: "创新创业",
  organizer: "教育部",
  origin: "official" as const,
  publication: "draft" as const,
  stageCount: 2,
  trackCount: 1,
  noticeCount: 3,
  baseline,
});
const detail = (id: string) => ({
  ...item(id),
  stages: [
    {
      id: id + "-stage",
      name: "全国赛",
      organizer: "教育部",
      hosts: [],
      scope: { kind: "unknown" as const, colleges: [], note: "" },
      startsAt: { precision: "unknown" as const, value: null },
      deadline: { precision: "unknown" as const, value: null },
      materialsAt: { precision: "unknown" as const, value: null },
      eventAt: { precision: "unknown" as const, value: null },
      timeNote: "",
      conflict: false,
      registration: "以原通知为准",
      order: 0,
      sourceIds: [id + "-notice"],
    },
  ],
  tracks: [
    {
      id: id + "-track",
      name: "团队赛",
      mode: "team" as const,
      members: "3-5",
      rules: "规则",
    },
  ],
  notices: [
    {
      id: id + "-notice",
      title: "报名通知",
      publisher: "教育部",
      url: "https://www.moe.gov.cn/notice",
      publishedAt: "2026-09-01",
      checkedAt: "2026-09-05",
      kind: "registration" as const,
    },
  ],
  baseline,
});

describe("比赛维护真实接口适配", () => {
  it("列表只发送契约字段，空筛选省略且 pageSize 收敛到 1–50", async () => {
    const request = vi.fn().mockResolvedValue({
      items: [item("alpha")],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    const service = createCompetitionService({ request });
    const result = await service.list(
      query({ q: "  创新  ", status: "published", page: 2, pageSize: 500 }),
    );
    const url = new URL(request.mock.calls[0]![0], "https://example.test");
    expect(url.pathname).toBe("/competitions");
    // 服务端文本检索是字面包含匹配，trim 后发送。
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: "2",
      pageSize: "50",
      status: "published",
      q: "创新",
    });
    expect(result.items[0]).toEqual({
      id: "alpha",
      title: "全国大学生创新竞赛 alpha",
      status: "draft",
      // 管理列表契约没有日期列，明确留空由页面显示空态。
      date: "",
      secondary: "2026 · 创新创业 · 教育部 · 2 赛段 · 1 赛道 · 3 来源",
    });
    request.mockClear();
    await createCompetitionService({ request }).list(query({ pageSize: 0 }));
    expect(new URL(request.mock.calls[0]![0], "https://e.test").search).toBe(
      "?page=1&pageSize=1",
    );
  });

  it("详情只保留基线并完整映射表单内容", async () => {
    const request = vi.fn().mockResolvedValue(detail("alpha"));
    const value = await createCompetitionService({ request }).detail("alpha");
    expect(request).toHaveBeenCalledWith("/competitions/alpha");
    expect(value).toMatchObject({ id: "alpha", baseline });
    expect(value.content).toMatchObject({
      name: "全国大学生创新竞赛 alpha",
      publication: "draft",
    });
    expect(value.content).not.toHaveProperty("baseline");
    expect(value.content.stages[0]!.sourceIds).toEqual(["alpha-notice"]);
  });

  it("新建按 ID 读取服务端基线并回报是否已存在", async () => {
    const request = vi.fn().mockResolvedValue({
      targetId: "new-contest",
      exists: true,
      baseline,
      publication: "published",
    });
    const value = await createCompetitionService({ request }).baseline(
      "new-contest",
    );
    expect(request).toHaveBeenCalledWith("/competitions/baseline/new-contest");
    expect(value).toEqual({
      targetId: "new-contest",
      exists: true,
      baseline,
      publication: "published",
    });
  });

  it("id 走 URL 编码，避免拼接出另一条路径", async () => {
    const request = vi.fn().mockResolvedValue(detail("alpha"));
    await createCompetitionService({ request }).detail("a/b?c");
    expect(request).toHaveBeenCalledWith("/competitions/a%2Fb%3Fc");
  });

  it("预览提交 UUID、原因、动作、基线与补丁，并把回执绑定到内容键", async () => {
    const request = vi.fn().mockResolvedValue({
      previewId: "preview-id",
      targetId: "alpha",
      action: "save",
      baseline,
      publication: "draft",
      changes: [{ field: "name", previous: "旧", current: "新" }],
      blocks: [],
    });
    const service = createCompetitionService({ request });
    const content = detail("alpha") as never;
    const draft = structuredClone(content) as ReturnType<
      typeof emptyCompetition
    >;
    draft.name = "新名称";
    const receipt = await service.preview({
      content: draft,
      patch: competitionPatch(draft, content),
      baseline,
      action: "save",
      reason: "核对预览",
    });
    const body = request.mock.calls[0]![1].body;
    expect(request.mock.calls[0]![0]).toBe("/competitions/alpha/preview");
    expect(body).toMatchObject({
      operationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      reason: "核对预览",
      action: "save",
      baseline,
      patch: { id: "alpha", name: "新名称" },
    });
    expect(receipt.token).toBe("preview-id");
    expect(receipt.contentKey).toContain("新名称");
    expect(receipt.blocks).toEqual([]);
  });

  it("预览回执与目标或动作不符时视为过期，不能用于提交", async () => {
    const request = vi.fn().mockResolvedValue({
      previewId: "preview-id",
      targetId: "other",
      action: "save",
      baseline,
      publication: "draft",
      changes: [],
      blocks: [],
    });
    const draft = emptyCompetition();
    draft.id = "alpha";
    await expect(
      createCompetitionService({ request }).preview({
        content: draft,
        patch: { id: "alpha" },
        baseline,
        action: "save",
        reason: "核对",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("保存命令发送幂等标识与预览回执，publish/hide 不带补丁", async () => {
    const result = {
      targetId: "alpha",
      action: "save",
      publication: "draft",
      baseline,
      changes: [],
      auditOperationId: "audit",
    };
    const request = vi.fn().mockResolvedValue(result);
    const service = createCompetitionService({ request });
    const receipt = {
      contentKey: "key",
      token: "preview-id",
      changes: [],
      blocks: [],
    };
    await service.change({
      patch: { id: "alpha", name: "新名称" },
      baseline,
      action: "save",
      reason: "保存草稿",
      operationId: "operation-id",
      receipt,
      confirmPublished: true,
    });
    expect(request.mock.calls[0]![1].body).toEqual({
      operationId: "operation-id",
      reason: "保存草稿",
      action: "save",
      baseline,
      patch: { id: "alpha", name: "新名称" },
      previewId: "preview-id",
      confirmPublished: true,
    });
    request.mockClear();
    await service.change({
      patch: { id: "alpha", name: "忽略" },
      baseline,
      action: "publish",
      reason: "发布",
      operationId: "operation-id-2",
      confirmPublished: false,
    });
    expect(request.mock.calls[0]![1].body).toEqual({
      operationId: "operation-id-2",
      reason: "发布",
      action: "publish",
      baseline,
    });
  });

  it("发布或隐藏拒绝携带预览回执，避免把旧回执用错命令", async () => {
    const request = vi.fn();
    await expect(
      createCompetitionService({ request }).change({
        patch: { id: "alpha" },
        baseline,
        action: "hide",
        reason: "隐藏",
        operationId: "operation-id",
        receipt: { contentKey: "k", token: "t", changes: [], blocks: [] },
        confirmPublished: false,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(request).not.toHaveBeenCalled();
  });
});

describe("独立比赛示例服务", () => {
  it("只读：预览与写入沿用未开放提示", async () => {
    await expect(
      exampleCompetitions.preview({
        content: emptyCompetition(),
        patch: { id: "x" },
        baseline: "b",
        action: "save",
        reason: "核对",
      }),
    ).rejects.toThrow();
    await expect(
      exampleCompetitions.change({
        patch: { id: "x" },
        baseline: "b",
        action: "save",
        reason: "核对",
        operationId: "o",
        confirmPublished: false,
      }),
    ).rejects.toThrow();
  });
});
