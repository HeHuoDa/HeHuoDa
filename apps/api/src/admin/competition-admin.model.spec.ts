import {
  applyCommand,
  baselineOf,
  compareChanges,
  publishBlocks,
  savePublicationInvalid,
} from "./competition-admin.model.js";
import type { EditionRecord } from "../competitions/competition.model.js";

function record(extra: Partial<EditionRecord> = {}): EditionRecord {
  return {
    id: "alpha",
    name: "测试比赛",
    edition: "2026",
    category: "创新创业",
    organizer: "学校",
    origin: "official",
    publication: "draft",
    stages: [
      {
        id: "alpha-stage",
        name: "校赛",
        organizer: "学院",
        hosts: ["law"],
        scope: { kind: "all", colleges: [], note: "全校" },
        startsAt: { precision: "unknown", value: null },
        deadline: { precision: "date", value: "2026-11-08" },
        materialsAt: { precision: "unknown", value: null },
        eventAt: { precision: "unknown", value: null },
        timeNote: "",
        conflict: false,
        registration: "以原通知为准",
        order: 0,
        sourceIds: ["alpha-notice"],
      },
    ],
    tracks: [
      {
        id: "alpha-track",
        name: "团队赛",
        mode: "team",
        members: "3 人",
        rules: "核对原文",
      },
    ],
    notices: [
      {
        id: "alpha-notice",
        title: "报名通知",
        publisher: "学校",
        url: "https://www.moe.gov.cn/s78/A08/tongzhi/2026/1.html",
        publishedAt: "2026-09-01",
        checkedAt: "2026-10-20",
        kind: "registration",
      },
    ],
    ...extra,
  };
}

describe("管理端比赛命令模型", () => {
  it("基线随记录与学院目录变化，未见记录有稳定基线", () => {
    const colleges = [{ id: "law", name: "法学院", order: 0 }];
    const first = baselineOf(record(), colleges);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(baselineOf(record(), colleges)).toBe(first);
    expect(baselineOf(record({ name: "改名" }), colleges)).not.toBe(first);
    expect(
      baselineOf(record(), [...colleges, { id: "new", name: "新", order: 1 }]),
    ).not.toBe(first);
    expect(baselineOf(null, colleges)).toMatch(/^[a-f0-9]{64}$/);
    expect(baselineOf(null, colleges)).toBe(baselineOf(null, colleges));
  });

  it("保存只应用本次变更字段，不覆盖未提交字段", () => {
    const next = applyCommand(record(), "save", {
      id: "alpha",
      name: "新名称",
    });
    expect(next.name).toBe("新名称");
    expect(next.stages[0].name).toBe("校赛");
    expect(next.publication).toBe("draft");
  });

  it("发布与隐藏只改发布状态，不隐式改动内容", () => {
    const published = applyCommand(record(), "publish", { id: "alpha" });
    expect(published.publication).toBe("published");
    expect(published).toEqual({ ...record(), publication: "published" });
    expect(applyCommand(published, "hide", { id: "alpha" }).publication).toBe(
      "hidden",
    );
  });

  it("人工核对日期按北京时间当天判定，不用 UTC 日期", () => {
    // 2026-10-26T17:00Z 已是北京时间 10-27 01:00。
    const boundary = record({
      notices: [{ ...record().notices[0]!, checkedAt: "2026-10-27" }],
    });
    expect(publishBlocks(boundary, "2026-10-26T17:00:00.000Z")).toEqual([]);
    expect(
      publishBlocks(boundary, "2026-10-26T15:59:00.000Z").map((b) => b.code),
    ).toEqual(["CHECKED_AT_INVALID"]);
  });

  it("save 不能改变发布状态，只能提交草稿内容", () => {
    const draft = record();
    expect(
      applyCommand(draft, "save", { id: "alpha", publication: "published" })
        .publication,
    ).toBe("draft");
    expect(
      applyCommand(draft, "save", { id: "alpha", publication: "hidden" })
        .publication,
    ).toBe("draft");
    expect(savePublicationInvalid(draft, { id: "alpha" })).toBeNull();
    expect(
      savePublicationInvalid(draft, { id: "alpha", publication: "draft" }),
    ).toBeNull();
    expect(
      savePublicationInvalid(draft, { id: "alpha", publication: "published" }),
    ).toContain("publish");
    const published = applyCommand(draft, "publish", { id: "alpha" });
    expect(
      savePublicationInvalid(published, { id: "alpha", publication: "hidden" }),
    ).toContain("publish");
  });

  it("变更摘要列出字段级差异与解除的关系", () => {
    const before = record();
    const after = applyCommand(before, "save", {
      id: "alpha",
      name: "新名称",
      stages: [{ id: "alpha-stage", hosts: ["science"] }],
    });
    const changes = compareChanges(before, after);
    expect(changes.map((c) => c.field)).toEqual(
      expect.arrayContaining(["name", "stages.alpha-stage.hosts"]),
    );
    expect(changes.map((c) => c.field)).not.toContain("publication");
    expect(
      changes.find((c) => c.field === "stages.alpha-stage.hosts"),
    ).toMatchObject({ previous: ["law"], current: ["science"] });
    expect(compareChanges(before, before)).toEqual([]);
  });

  it("发布底线逐项报告缺失:赛段、赛道、来源与人工核对日期", () => {
    const complete = record();
    expect(publishBlocks(complete, "2026-10-27")).toEqual([]);

    const empty = record({ stages: [], tracks: [], notices: [] });
    expect(publishBlocks(empty, "2026-10-27").map((b) => b.code)).toEqual([
      "STAGE_MISSING",
      "TRACK_MISSING",
      "SOURCE_MISSING",
    ]);

    const unknownCheck = record({
      notices: [{ ...complete.notices[0]!, checkedAt: null }],
    });
    expect(
      publishBlocks(unknownCheck, "2026-10-27").map((b) => b.code),
    ).toEqual(["CHECKED_AT_MISSING"]);

    const futureCheck = record({
      notices: [{ ...complete.notices[0]!, checkedAt: "2026-12-01" }],
    });
    expect(publishBlocks(futureCheck, "2026-10-27").map((b) => b.code)).toEqual(
      ["CHECKED_AT_INVALID"],
    );

    const unsafeUrl = record({
      notices: [{ ...complete.notices[0]!, url: "http://www.moe.gov.cn/a" }],
    });
    expect(publishBlocks(unsafeUrl, "2026-10-27").map((b) => b.code)).toEqual([
      "SOURCE_INVALID",
    ]);

    const incompleteStage = record({
      stages: [{ ...complete.stages[0]!, name: "  " }],
    });
    expect(
      publishBlocks(incompleteStage, "2026-10-27").map((b) => b.code),
    ).toEqual(["STAGE_INCOMPLETE"]);

    const unreferenced = record({
      stages: [{ ...complete.stages[0]!, sourceIds: [] }],
    });
    expect(
      publishBlocks(unreferenced, "2026-10-27").map((b) => b.code),
    ).toEqual(["SOURCE_UNLINKED"]);
  });

  it("草稿允许保留未知时间与缺失关系，不因发布规则被拒", () => {
    const draft = record({
      stages: [
        {
          ...record().stages[0]!,
          startsAt: { precision: "unknown", value: null },
          deadline: { precision: "unknown", value: null },
          sourceIds: [],
        },
      ],
      notices: [{ ...record().notices[0]!, checkedAt: null }],
    });
    expect(
      applyCommand(draft, "save", { id: "alpha", name: "草稿改名" }).name,
    ).toBe("草稿改名");
    expect(publishBlocks(draft, "2026-10-27").length).toBeGreaterThan(0);
  });
});
