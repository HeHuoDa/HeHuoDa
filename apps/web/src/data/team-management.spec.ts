import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { DEMO_PARTICIPANT, draftFromTeam, useTeamDemoStore } from "./team-demo";
import { useProfileDemoStore } from "./profile-demo";

describe("队伍、申请与邀请会话状态", () => {
  beforeEach(() => setActivePinia(createPinia()));
  it("关闭后不能借暂停恢复重新开放，相关邀请已失效", () => {
    const s = useTeamDemoStore(),
      t = s.teams.find((t) => t.id === "demo-7")!;
    expect(s.manage(t.id, "closed")).toContain("已完成");
    expect(s.manage(t.id, "paused")).toContain("不能暂停或恢复");
    expect(s.manage(t.id, "open")).toContain("不能暂停或恢复");
    expect(t.state).toBe("closed");
    expect(
      s.records
        .filter((a) => a.teamId === t.id)
        .every((a) => a.state === "INVALID"),
    ).toBe(true);
  });
  it("申请与发出邀请均不增加成员，邀请不预占名额", () => {
    const s = useTeamDemoStore(),
      t = s.teams.find((t) => t.id === "demo-7")!;
    const count = t.members.length;
    expect(s.processApplication("incoming-1", "invite")).toContain(
      "不预占名额",
    );
    expect(t.members).toHaveLength(count);
    expect(
      s.invitations.filter(
        (i) => i.state === "ACTIVE" && i.applicationId.startsWith("incoming"),
      ),
    ).toHaveLength(2);
    expect(s.processApplication("incoming-1", "invite")).toContain("失败");
    expect(t.members).toHaveLength(count);
  });
  it("确认入队只增加一次成员，申请/邀请终态一致", () => {
    const s = useTeamDemoStore(),
      t = s.teams.find((t) => t.id === "demo-2")!;
    const count = t.members.length;
    expect(s.respond("history-0", "accept")).toContain("入队已确认");
    expect(t.members).toHaveLength(count + 1);
    expect(s.records.find((a) => a.id === "history-0")?.state).toBe("ACCEPTED");
    expect(
      s.invitations.find((i) => i.applicationId === "history-0")?.state,
    ).toBe("ACCEPTED");
    expect(s.respond("history-0", "accept")).toContain("失败");
    expect(t.members).toHaveLength(count + 1);
    expect(s.applications[t.id]).toBeUndefined();
  });
  it.each(["full", "deadline", "paused", "closed", "role", "revoked"])(
    "确认重新检查 %s，失败不增加成员",
    (condition) => {
      const s = useTeamDemoStore(),
        t = s.teams.find((t) => t.id === "demo-2")!;
      const count = t.members.length;
      if (condition === "full") t.capacity = count;
      if (condition === "deadline")
        t.deadline = new Date(Date.now()).toISOString();
      if (condition === "paused" || condition === "closed") t.state = condition;
      if (condition === "role") t.roles = ["设计"];
      if (condition === "revoked")
        s.invitations.find((i) => i.applicationId === "history-0")!.state =
          "REVOKED";
      expect(s.respond("history-0", "accept")).toContain("失败");
      expect(t.members).toHaveLength(count);
    },
  );
  it("邀请竞争最后一个名额时，后确认者无法加入", () => {
    const s = useTeamDemoStore(),
      t = s.teams.find((t) => t.id === "demo-2")!;
    t.capacity = t.members.length + 1;
    // 模拟另一位已受邀成员先确认；有效邀请仍不持有名额。
    t.members.push({
      id: "other-confirmed",
      nickname: "先确认的示例成员",
      role: "编程",
      captain: false,
    });
    expect(s.respond("history-0", "accept")).toContain("已满员");
    expect(t.members.some((m) => m.id === DEMO_PARTICIPANT.id)).toBe(false);
  });
  it("撤回、拒绝与撤销保留记录且使邀请失效", () => {
    const s = useTeamDemoStore();
    expect(s.respond("history-0", "withdraw")).toContain("已撤回");
    expect(s.respond("history-0", "accept")).toContain("失败");
    expect(s.processApplication("incoming-1", "reject")).toContain("已拒绝");
    expect(s.processApplication("incoming-2", "revoke")).toContain("已撤销");
    expect(s.records.find((a) => a.id === "incoming-2")?.state).toBe("REVOKED");
    s.reset();
    expect(s.respond("history-0", "decline")).toContain("已拒绝");
    expect(
      s.invitations.find((i) => i.applicationId === "history-0")?.state,
    ).toBe("DECLINED");
  });
  it("队长不能直接退出；移交后权限随成员关系变化", () => {
    const s = useTeamDemoStore(),
      t = s.teams.find((t) => t.id === "demo-7")!;
    expect(s.manage(t.id, "leave")).toContain("不能直接退出");
    expect(s.manage(t.id, "transfer", "missing")).toContain("失败");
    expect(s.manage(t.id, "transfer", "member-6")).toContain("已完成");
    expect(t.members.filter((m) => m.captain).map((m) => m.id)).toEqual([
      "member-6",
    ]);
    expect(s.manage(t.id, "dissolve")).toContain("仅队长");
    expect(s.processApplication("incoming-1", "invite")).toContain("失败");
    expect(s.manage(t.id, "leave")).toContain("已完成");
  });
  it("招募编辑复用验证，不能缩容至成员数以下；公开对象同步", () => {
    const s = useTeamDemoStore(),
      t = s.teams.find((t) => t.id === "demo-7")!;
    t.members.push({
      id: "third",
      nickname: "第三成员",
      role: "调研",
      captain: false,
    });
    const d = draftFromTeam(t);
    expect(
      s.editTeam(t.id, { ...d, capacity: "2" }).errors.capacity,
    ).toBeDefined();
    expect(s.editTeam(t.id, { ...d, title: "新的图鉴招募" }).ok).toBe(true);
    expect(s.teams.find((x) => x.id === t.id)?.title).toBe("新的图鉴招募");
    expect(s.editTeam("demo-8", d).ok).toBe(false);
  });
  it("同队有效成员与所有者授权同时满足才可查看，退出/移除/解散即时清理", () => {
    const s = useTeamDemoStore(),
      profile = useProfileDemoStore();
    expect(s.canViewContact("demo-7", "member-6")).toBe(false);
    s.contactAuthorizations["member-6"] = true;
    expect(s.canViewContact("demo-7", "member-6")).toBe(true);
    expect(s.canViewContact("demo-7", "member-6", "applicant-1")).toBe(false);
    profile.contactShared = true;
    expect(s.canViewContact("demo-7", DEMO_PARTICIPANT.id, "member-6")).toBe(
      true,
    );
    s.manage("demo-7", "remove", "member-6");
    expect(s.canViewContact("demo-7", "member-6")).toBe(false);
    expect(s.contactAuthorizations["member-6"]).toBeUndefined();
    s.contactAuthorizations["captain-7"] = true;
    s.manage("demo-8", "leave");
    expect(s.canViewContact("demo-8", "captain-7")).toBe(false);
    s.manage("demo-7", "dissolve");
    expect(s.canViewContact("demo-7", DEMO_PARTICIPANT.id)).toBe(false);
    expect(
      s.records
        .filter((a) => a.teamId === "demo-7")
        .every((a) => a.state === "INVALID"),
    ).toBe(true);
    s.reset();
    expect(profile.contactShared).toBe(false);
    expect(s.contactAuthorizations).toEqual({});
  });
});
