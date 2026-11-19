import { describe, expect, it } from "vitest";
import {
  competitionErrorMessage,
  emptyCompetition,
  validateCompetition,
  competitionPatch,
} from "./competitions";
import { ConsoleError } from "./resource";

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

describe("比赛维护错误文案", () => {
  it("保留服务端具体的比赛错误原因，不收敛成通用重试提示", () => {
    expect(
      competitionErrorMessage(
        new ConsoleError(
          409,
          "基线已变化：请重新读取后再提交",
          "COMPETITION_BASELINE_STALE",
        ),
      ),
    ).toContain("基线已变化");
    // 非比赛错误维持既有状态文案。
    expect(competitionErrorMessage(new ConsoleError(409, "其他冲突"))).toBe(
      "版本或基线已过期，请重新加载并重新审核。",
    );
  });
  it("无来源链接时指出具体违反项而不是只给一句通用提示", () => {
    const draft = emptyCompetition();
    Object.assign(draft, { id: "contest", name: "比赛" });
    draft.notices.push({
      id: "notice",
      title: "通知",
      publisher: "学院",
      url: "http://xxgc.sicau.edu.cn/",
      kind: "registration",
      publishedAt: null,
      checkedAt: null,
    });
    draft.stages.push({
      id: "stage",
      name: "校赛",
      organizer: "学院",
      hosts: [],
      scope: { kind: "all", colleges: [], note: "" },
      startsAt: { precision: "unknown", value: null },
      deadline: { precision: "unknown", value: null },
      materialsAt: { precision: "unknown", value: null },
      eventAt: { precision: "unknown", value: null },
      timeNote: "",
      conflict: false,
      registration: "线上报名",
      order: 0,
      sourceIds: ["notice"],
    });
    expect(validateCompetition(draft, [])?.message).toContain("https");
  });
});
