import { describe, expect, it } from "vitest";
import type { Schema } from "../http";
import {
  candidateFieldRows,
  candidateFieldsV2,
  candidateScopeLabels,
  evidenceLabel,
  evidenceLocation,
  legacyFieldRows,
  legacyNotificationKind,
  legacyScopeLabels,
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
    // v2 候选缺分类时读后端兼容投影的 kind，它仍是通知种类而非赛事种类。
    expect(
      resolveNotificationKind({
        fieldsContract: "candidate-fields-v2",
        fields: { kind: "award" },
        fieldsV2: fields(),
      }),
    ).toBe("award");
    expect(notificationKindLabel("radar")).toBe("未知通知种类");
    expect(notificationKindLabel(null)).toBe("未知通知种类");
    expect(notificationKindLabel("registration")).toBe("报名通知");
  });

  it("契约标记是唯一判据：标了 v2 但缺 fieldsV2 时不静默读旧投影", () => {
    // ADR 0010 §6 以 fieldsContract 判定契约；缺 fieldsV2 属契约错误，
    // 应返回 null 走 legacy 提示，而不是把兼容投影当 v2 展示。
    expect(
      candidateFieldsV2({
        fieldsContract: "candidate-fields-v2",
        fields: { kind: "registration" },
      }),
    ).toBeNull();
    // 反过来，带 fieldsV2 但没有契约标记（历史材料）也不当作 v2。
    expect(
      candidateFieldsV2({ fieldsV2: fields({ eventKind: "学科竞赛" }) }),
    ).toBeNull();
    // 正常 v2 候选才返回字段。
    expect(
      candidateFieldsV2({
        fieldsContract: "candidate-fields-v2",
        fieldsV2: fields({ eventKind: "学科竞赛" }),
      })?.eventKind,
    ).toBe("学科竞赛");
  });

  it("旧材料只在显式 legacy 分支读 kind，且不把它当成赛事种类", () => {
    const legacy = { fields: { kind: "award" } };
    expect(legacyNotificationKind(legacy)).toBe("award");
    expect(candidateFieldsV2(legacy)).toBeNull();
    expect(notificationKindLabel(resolveNotificationKind(legacy))).toBe(
      "获奖公示",
    );
    // 旧材料没有 v2 契约，赛事种类无从展示，不得由 kind 反推；本期该项退出一期
    // 自动提取，因此以「本期不自动提取」告知，而不是声称正文未提供。
    expect(candidateFieldRows(fields())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "赛事种类",
          value: "—",
        }),
      ]),
    );
  });

  it("退役字段没有取值时说明本期不自动提取，不伪装成正文缺失", () => {
    // #206 阶段一：九个字段退出自动提取，但原文证据仍在候选里。展示层不能把它们
    // 显示成「未提取」（读作正文没有）或逐条要求人工清理，也不得隐藏历史取值。
    const empty = candidateFieldRows(fields());
    for (const label of ["赛事种类", "参赛形式", "参赛规则", "赛段名称"]) {
      expect(empty).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label,
            value: "—",
            hint: "本期不自动提取，请按原文人工填写",
          }),
        ]),
      );
    }
    expect(empty.some((row) => row.label === "报名／材料／比赛时间")).toBe(
      true,
    );
    // 历史候选已有取值时照旧展示，不用说明行盖掉真实数据。eventKind／mode
    // 在该 fixture 里本就没有值，仍按说明行处理；规则、赛段与时间必须显示真值。
    const legacyValues = candidateFieldRows(
      fields({
        rules: ["作品须原创。"],
        stageNames: ["初赛", "决赛"],
        deadline: { precision: "date", value: "2026-11-01" },
      }),
    );
    expect(legacyValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "参赛规则", value: "作品须原创。" }),
        expect.objectContaining({ label: "赛段", value: "初赛、决赛" }),
        expect.objectContaining({ label: "报名截止", value: "2026-11-01" }),
      ]),
    );
    expect(
      legacyValues
        .filter((row) =>
          ["参赛规则", "赛段名称", "报名／材料／比赛时间"].includes(row.label),
        )
        .some((row) => row.value === "—"),
    ).toBe(false);
  });

  it("空输入与缺失字段一律返回 null，不伪装成已知值", () => {
    expect(candidateFieldsV2(null)).toBeNull();
    expect(resolveNotificationKind(null)).toBeNull();
    expect(legacyNotificationKind(undefined)).toBeNull();
    expect(notificationKindLabel(resolveNotificationKind({}))).toBe(
      "未知通知种类",
    );
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

  it("赛道规则原文完整保留，否定与例外不得丢失", () => {
    const rows = candidateFieldRows(
      fields({
        tracks: [
          {
            name: "综合赛道",
            modeKind: "team",
            members: "3 人",
            rules: "不得提交已获奖作品，仅限未毕业学生。",
          },
          {
            name: "无规则赛道",
            modeKind: "individual",
            members: null,
            rules: null,
          },
        ],
      }),
    );
    const rule = rows.find((row) => row.label === "赛道规则：综合赛道");
    expect(rule?.value).toBe("不得提交已获奖作品，仅限未毕业学生。");
    // 赛道本身的参赛形式与人数仍单独成行，规则不覆盖它们。
    expect(rows.find((row) => row.label === "赛道：综合赛道")).toMatchObject({
      value: "团队",
      hint: "人数：3 人",
    });
    // rules 为 null 的赛道不生成空规则行，也不伪造成「无规则」。
    expect(rows.some((row) => row.label === "赛道规则：无规则赛道")).toBe(
      false,
    );
  });

  it("新契约的赛道只给名称时说明本期范围，不伪装成解析失败", () => {
    // 本期只自动提取赛道名称，tracks 的 modeKind／members／rules 恒为 null。
    // 旧文案「参赛形式无法可靠归一」会把契约规定的空值说成解析失败。
    const rows = candidateFieldRows(
      fields({
        tracks: [
          { name: "综合赛道", modeKind: null, members: null, rules: null },
        ],
      }),
    );
    const trackRow = rows.find((row) => row.label === "赛道：综合赛道");
    expect(trackRow?.value).toBe("本期只提取赛道名称");
    expect(trackRow?.value).not.toContain("无法可靠归一");
    expect(trackRow?.hint).toContain("按原文人工填写");
    // 空值不生成空规则行，也不伪造成「无规则」。
    expect(rows.some((row) => row.label === "赛道规则：综合赛道")).toBe(false);
  });

  it("历史赛道已有形式与规则时仍展示真实值", () => {
    // 本期范围说明不能盖掉历史候选里已经提取到的真实内容。
    const rows = candidateFieldRows(
      fields({
        tracks: [
          { name: "历史赛道", modeKind: "team", members: "2 人", rules: null },
        ],
      }),
    );
    expect(rows.find((row) => row.label === "赛道：历史赛道")).toMatchObject({
      value: "团队",
      hint: "人数：2 人",
    });
  });

  it("旧材料投影保留已有规则、赛道规则与时间", () => {
    const legacy: Schema["AdminLegacyCandidateFieldsDto"] = {
      name: "历史竞赛",
      edition: "2025",
      kind: "registration",
      organizer: null,
      hosts: [],
      scope: {
        kind: "colleges" as const,
        colleges: ["science"],
        note: "理学院本科生。",
      },
      mode: "team" as const,
      tracks: [
        {
          name: "历史赛道",
          mode: "mixed" as const,
          members: "2 人",
          rules: "往届获奖作品不得重复提交。",
        },
      ],
      members: "2 人",
      rules: ["须提交原创作品", "不接受跨校组队"],
      stageNames: ["校级选拔"],
      startsAt: { precision: "unknown" as const, value: null },
      deadline: { precision: "date" as const, value: "2025-10-30" },
      materialsAt: { precision: "unknown" as const, value: null },
      eventAt: { precision: "unknown" as const, value: null },
    };
    const rows = legacyFieldRows(legacy);
    expect(rows.find((row) => row.label === "参赛规则（旧）")?.value).toBe(
      "须提交原创作品；不接受跨校组队",
    );
    expect(
      rows.find((row) => row.label === "赛道规则（旧）：历史赛道")?.value,
    ).toBe("往届获奖作品不得重复提交。");
    expect(rows.find((row) => row.label === "报名截止（旧）")?.value).toBe(
      "2025-10-30",
    );
    expect(rows.find((row) => row.label === "报名开始（旧）")?.value).toBe(
      "未知",
    );
    // 旧投影的 scope 是正式四值，显示中文标签而不是裸枚举。
    expect(
      rows.find((row) => row.label === "竞赛范围（正式四值投影）")?.value,
    ).toBe("指定学院：science");
    // 旧 kind 是通知种类，不能出现在赛事种类位置。
    expect(rows.some((row) => row.label.includes("赛事种类"))).toBe(false);
  });

  it("旧投影的正式四值 scope 各有中文标签，不与候选四值混用", () => {
    expect(legacyScopeLabels).toEqual({
      all: "全校",
      colleges: "指定学院",
      complex: "复杂规则",
      unknown: "未知",
    });
    expect(legacyScopeLabels.complex).toBe("复杂规则");
    // 候选四值里没有 colleges/complex，两张表不能合并。
    expect(Object.keys(candidateScopeLabels)).not.toContain("complex");
  });

  it("候选范围用协议四值标签，保留 note 与否定说明", () => {
    expect(candidateScopeLabels.other).toBe("其他限制（须读原文）");
    expect(candidateScopeLabels.specified).toBe("指定学院");
    // 正式比赛范围是另一套枚举，候选标签里不得出现 complex 之类的正式值。
    expect(new Set(Object.keys(candidateScopeLabels))).toEqual(
      new Set(["all", "specified", "other", "unknown"]),
    );
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
