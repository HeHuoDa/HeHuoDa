import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  applicationStatus,
  canonicalTeamQuery,
  deadlineInstant,
  emptyDraft,
  filterTeams,
  initialTeams,
  parseTeamFilters,
  recruitmentStatus,
  useTeamDemoStore,
  validateDraft,
} from "./team-demo";
const now = Date.parse("2026-10-05T12:00:00+08:00");
const valid = () => ({
  ...emptyDraft(),
  title: "校园图鉴",
  type: "other",
  goal: "一起整理校园植物记录与照片，制作学习图鉴。",
  roles: ["调研"] as const,
  mode: "online",
  deadline: "2026-10-06T12:00",
});
const draft = () => ({ ...valid(), roles: [...valid().roles] });
describe("招募演示领域行为", () => {
  beforeEach(() => setActivePinia(createPinia()));
  it("截止时刻不可申请；满员和截止是派生状态", () => {
    const teams = initialTeams(now);
    const t = teams[0]!;
    expect(recruitmentStatus(t, now).available).toBe(true);
    expect(recruitmentStatus(t, Date.parse(t.deadline))).toEqual({
      available: false,
      label: "已截止",
    });
    expect(recruitmentStatus(teams[2]!, now).label).toBe("已暂停");
    expect(recruitmentStatus(teams[3]!, now).label).toBe("已关闭");
    expect(recruitmentStatus(teams[4]!, now).label).toBe("已满员");
    expect(recruitmentStatus(teams[5]!, now).label).toBe("已截止");
    expect(applicationStatus(teams[6]!, now, false).label).toBe("你是演示队长");
    expect(applicationStatus(teams[7]!, now, false).label).toBe(
      "你已是演示成员",
    );
  });
  it("申请幂等，不改变成员；重置清除创建和申请", () => {
    const s = useTeamDemoStore();
    const id = s.teams[0]!.id,
      count = s.teams[0]!.members.length;
    expect(s.apply(id, "调研", "愿意查文献")).toBe(true);
    expect(s.apply(id, "调研", "重复")).toBe(false);
    expect(s.teams[0]!.members).toHaveLength(count);
    expect(applicationStatus(s.teams[0]!, Date.now(), true).label).toBe(
      "演示申请待处理",
    );
    const team = s.publish(draft(), now)!;
    expect(team.members).toHaveLength(1);
    expect(team.goal).toBe(draft().goal);
    s.reset();
    expect(s.records.some((a) => a.id.startsWith("application-"))).toBe(false);
    expect(s.teams.some((t) => t.id === team.id)).toBe(false);
  });
  it("时间始终按北京时间解析并拒绝无效日历日期", () => {
    expect(deadlineInstant("2026-10-05T12:00")).toBe(now);
    expect(deadlineInstant("2026-02-30T12:00")).toBeNaN();
    expect(deadlineInstant("2026-10-05")).toBeNaN();
  });
  it("校验长度、人数、职责、截止时间与赛道归属", () => {
    expect(validateDraft(draft(), now)).toEqual({});
    for (const capacity of ["1", "21", "2.5", "", "-2"])
      expect(validateDraft({ ...draft(), capacity }, now)).toHaveProperty(
        "capacity",
      );
    expect(
      validateDraft({ ...draft(), deadline: "2026-10-05T12:00" }, now),
    ).toHaveProperty("deadline");
    expect(
      validateDraft({ ...draft(), trackId: "foreign" }, now),
    ).toHaveProperty("trackId");
    expect(validateDraft({ ...draft(), mode: "hybrid" }, now)).toHaveProperty(
      "location",
    );
    expect(
      validateDraft(
        {
          ...draft(),
          title: "a",
          goal: "short",
          roles: [],
          progress: "x".repeat(501),
        },
        now,
      ),
    ).toMatchObject({
      title: expect.any(String),
      goal: expect.any(String),
      roles: expect.any(String),
      progress: expect.any(String),
    });
  });
  it("筛选条件取交集，字面搜索，排序稳定；URL 正规化幂等", () => {
    const teams = initialTeams(now);
    const f = parseTeamFilters({
      q: " 植物 ",
      role: "调研",
      mode: "hybrid",
      status: "available",
    });
    expect(filterTeams(teams, f, now).map((t) => t.id)).toEqual([
      "demo-1",
      "demo-7",
    ]);
    expect(filterTeams(teams, { ...f, q: ".*" }, now)).toHaveLength(0);
    expect(
      filterTeams(teams, { ...f, competition: "real-id" }, now),
    ).toHaveLength(0);
    const canonical = canonicalTeamQuery({
      q: [" hi ", "ignored"],
      type: "illegal",
      page: "0",
      role: "bad",
      ref: "keep",
    });
    expect(canonical).toEqual({ q: "hi", ref: "keep" });
    expect(canonicalTeamQuery({ q: "hi", ref: "keep" })).toEqual(canonical);
    expect(
      filterTeams(teams.reverse(), parseTeamFilters({}), now)
        .slice(0, 2)
        .map((t) => t.id),
    ).toEqual(["demo-1", "demo-2"]);
  });
});
