import { describe, expect, it } from "vitest";
import type { Schema } from "../http";
import {
  candidateFieldRows,
  candidateFieldsV2,
  candidateScopeLabels,
  evidenceLabel,
  evidenceLocation,
  legacyNotificationKind,
  notificationKindLabel,
  resolveNotificationKind,
  reviewHints,
} from "./candidate-view";

type Fields = Schema["AdminCandidateFieldsDto"];
const unknownTime = () => ({ precision: "unknown" as const, value: null });
function fields(patch: Partial<Fields> = {}): Fields {
  return {
    name: "示例创新设计竞赛",
    edition: null,
    eventKind: null,
    organizer: null,
    hosts: [],
    scope: { kind: "unknown", colleges: [], note: "" },
    mode: null,
    modeKind: null,
    tracks: [],
    members: null,
    rules: [],
    stageNames: [],
    startsAt: unknownTime(),
    deadline: unknownTime(),
    materialsAt: unknownTime(),
    eventAt: unknownTime(),
    ...patch,
  };
}

describe("候选字段 v2 展示适配", () => {
  it("通知种类只读分类结果，未知枚举不显示成报名通知", () => {
    expect(
      resolveNotificationKind({
        fieldsContract: "candidate-fields-v2",
        classification: { notificationKind: "supplement" },
        fieldsV2: fields(),
      }),
    ).toBe("supplement");
    // v2 候选缺分类时不回退旧投影，避免通知种类出现第二个来源。
    expect(
      resolveNotificationKind({
        fieldsContract: "candidate-fields-v2",
        fields: { kind: "award" },
        fieldsV2: fields(),
      }),
    ).toBeNull();
    expect(notificationKindLabel("radar")).toBe("未知通知类型");
    expect(notificationKindLabel(null)).toBe("未知通知类型");
    expect(notificationKindLabel("registration")).toBe("报名通知");
  });

  it("旧材料只在显式 legacy 分支读 kind，且不把它当成赛事种类", () => {
    const legacy = { fields: { kind: "award" } };
    expect(legacyNotificationKind(legacy)).toBe("award");
    expect(candidateFieldsV2(legacy)).toBeNull();
    expect(notificationKindLabel(resolveNotificationKind(legacy))).toBe(
      "获奖公示",
    );
    // 旧材料没有 v2 契约，赛事种类无从展示，不得由 kind 反推。
    expect(candidateFieldRows(fields())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "赛事种类", value: "未提取" }),
      ]),
    );
  });

  it("校验旧材料缺失字段时，不把未授权值伪装成已知", () => {
    expect(candidateFieldsV2(null)).toBeNull();
    expect(resolveNotificationKind(null)).toBeNull();
    expect(legacyNotificationKind(undefined)).toBeNull();
  });

  it("分别展示赛事种类、参赛形式原文与归一结果", () => {
    const rows = candidateFieldRows(
      fields({
        eventKind: "创业计划类",
        mode: "每班组成一支队伍",
        modeKind: "team",
      }),
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "赛事种类", value: "创业计划类" }),
        expect.objectContaining({
          label: "参赛形式原文",
          value: "每班组成一支队伍",
          hint: "归一结果：团队",
        }),
      ]),
    );
    const unnormalized = candidateFieldRows(fields({ mode: "按通知另行确定" }));
    expect(
      unnormalized.find((row) => row.label === "参赛形式原文"),
    ).toMatchObject({
      value: "按通知另行确定",
      hint: "无法可靠归一，导入时须人工填写个人／团队／混合",
    });
  });

  it("候选范围用协议四值标签，保留 note 与否定说明", () => {
    expect(candidateScopeLabels.other).toBe("其他限制（须读原文）");
    expect(candidateScopeLabels.specified).toBe("指定学院");
    // 正式比赛范围是另一套枚举，候选标签里不得出现 complex 之类的正式值。
    expect(Object.keys(candidateScopeLabels)).toEqual([
      "all",
      "specified",
      "other",
      "unknown",
    ]);
    const rows = candidateFieldRows(
      fields({
        scope: {
          kind: "other",
          colleges: [],
          note: "除食品学院外均可参加。",
        },
      }),
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "参赛范围",
          value: "其他限制（须读原文）",
          hint: "除食品学院外均可参加。",
        }),
      ]),
    );
    const specified = candidateFieldRows(
      fields({ scope: { kind: "specified", colleges: ["science"], note: "" } }),
    );
    expect(specified.find((row) => row.label === "参赛范围")?.value).toBe(
      "指定学院：science",
    );
  });

  it("缺失、冲突与警告分开呈现，不把冲突混成缺失", () => {
    const hints = reviewHints({
      conflicts: ["参赛形式存在互不覆盖的要求，须人工核对"],
      missing: ["承办学院"],
      warnings: ["附件仅记录链接，未解析或核实附件规则"],
    });
    expect(hints.map((hint) => hint.kind)).toEqual([
      "conflict",
      "missing",
      "warning",
    ]);
    expect(hints[1]!.text).toBe("缺少字段：承办学院");
  });

  it("证据定位绑定自身版本，附件证据没有版本时不静默跳到最新版", () => {
    const html = evidenceLocation(
      "notice-1",
      {
        excerpt: "报名截止：11 月 8 日",
        paragraph: 2,
        url: "https://example.edu/a",
        noticeVersion: "v-old",
      },
      "v-new",
    );
    expect(html).toEqual({
      path: "/ingestion/notices/notice-1",
      query: { version: "v-old", paragraph: "2" },
    });
    // 缺 noticeVersion 时退回材料自身版本，而不是通知的最新版本。
    expect(
      evidenceLocation(
        "notice-1",
        {
          excerpt: "报名截止",
          paragraph: 1,
          url: "https://example.edu/a",
        },
        "material-version",
      )?.query.version,
    ).toBe("material-version");
    expect(
      evidenceLocation(
        "notice-1",
        {
          excerpt: "第一页",
          format: "pdf",
          url: "https://example.edu/a.pdf",
          noticeVersion: "v1",
          page: 3,
        },
        "v1",
      ),
    ).toBeNull();
    const pdf = evidenceLocation(
      "notice-1",
      {
        excerpt: "第一页",
        format: "pdf",
        url: "https://example.edu/a.pdf",
        noticeVersion: "v1",
        attachmentVersion: "attach-v2",
        page: 3,
      },
      "v1",
    );
    expect(pdf).toEqual({
      path: "/ingestion/notices/notice-1",
      query: {
        version: "v1",
        attachmentUrl: "https://example.edu/a.pdf",
        attachmentVersion: "attach-v2",
        segment: "3",
        attachmentPage: "1",
      },
    });
    expect(
      evidenceLocation(
        undefined,
        {
          excerpt: "x",
          url: "https://example.edu/a",
          paragraph: 0,
        },
        "v1",
      ),
    ).toBeNull();
  });

  it("证据位置文案与协议段落口径一致", () => {
    const base = { excerpt: "y", url: "https://example.edu/a" };
    expect(evidenceLabel({ ...base, paragraph: 0 })).toBe("HTML 第1段");
    expect(evidenceLabel({ ...base, paragraph: -1 })).toBe("标题／元数据");
    expect(evidenceLabel({ ...base, format: "docx", paragraph: 4 })).toBe(
      "DOCX 第4段",
    );
    expect(evidenceLabel({ ...base, format: "pdf", page: 2 })).toBe(
      "PDF 第2页",
    );
  });
});
