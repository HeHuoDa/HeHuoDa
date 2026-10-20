import { describe, expect, it } from "vitest";
import {
  emptyCompetition,
  validateCompetition,
  competitionPatch,
} from "./competitions";

describe("比赛维护输入契约", () => {
  it("补丁区分未更改关系与显式清空，并拒绝无来源赛段的发布", () => {
    const before = emptyCompetition();
    Object.assign(before, { id: "contest", name: "比赛" });
    before.notices.push({
      id: "notice",
      title: "通知",
      publisher: "学院",
      url: "https://xxgc.sicau.edu.cn/",
      kind: "registration",
      publishedAt: null,
      checkedAt: null,
    });
    const after = structuredClone(before);
    expect(competitionPatch(after, before).notices).toBeUndefined();
    after.notices = [];
    expect(competitionPatch(after, before).notices).toEqual([]);
    expect(validateCompetition(after, [], "publish")?.message).toContain(
      "发布",
    );
  });
  it("拒绝跨届来源引用，未知时间保持未知，日期不补时刻", () => {
    const draft = emptyCompetition();
    Object.assign(draft, { id: "contest-2026", name: "测试比赛" });
    draft.stages.push({
      id: "school",
      name: "校赛",
      organizer: "",
      hosts: [],
      scope: { kind: "unknown", colleges: [], note: "" },
      startsAt: { precision: "unknown", value: null },
      deadline: { precision: "date", value: "2026-11-08" },
      materialsAt: { precision: "unknown", value: null },
      eventAt: { precision: "unknown", value: null },
      timeNote: "",
      conflict: false,
      registration: "",
      order: 0,
      sourceIds: ["other-edition"],
    });
    expect(validateCompetition(draft, [])?.message).toContain("来源");
    draft.stages[0]!.sourceIds = [];
    expect(validateCompetition(draft, [])).toBeNull();
    expect(competitionPatch(draft, null).stages?.[0]?.deadline).toEqual({
      precision: "date",
      value: "2026-11-08",
    });
  });
});
