import assert from "node:assert/strict";
import { test } from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { DEMO_PARTICIPANT, emptyDraft } from "@hehuoda/client-domain/team";
import { useSessionStore } from "../src/stores/session.ts";
import {
  createProfileTeamController,
  initialProfileTeamState,
} from "../src/stores/profile-team-controller.ts";

// 固定时钟：演示 fixture 的截止时间仍相对真实时间生成，这里只固定控制器读数。
const NOW = Date.parse("2026-10-20T10:00:00+08:00");

function fixture(selected = "demo-7", section = "teams") {
  setActivePinia(createPinia());
  const session = useSessionStore();
  const state = initialProfileTeamState();
  const controller = createProfileTeamController(state, session, () => NOW);
  controller.switchSection(section);
  if (selected) controller.select(selected);
  return { session, state, controller };
}
const teamOf = (session, id) => session.teams.find((t) => t.id === id);
const recordOf = (session, id) => session.records.find((a) => a.id === id);

test("A01 队长与普通成员入口边界：直接调用控制器也按派生成员关系拒绝", () => {
  const { session, controller } = fixture("demo-7");
  assert.equal(controller.isCaptain(teamOf(session, "demo-7")), true);
  assert.equal(controller.beginEdit(), true);
  controller.cancelEdit();
  assert.equal(controller.beginManage("closed"), true);
  controller.cancelConfirm();
  assert.equal(controller.beginManage("leave"), false);

  controller.select("demo-8");
  assert.equal(controller.isCaptain(teamOf(session, "demo-8")), false);
  assert.equal(controller.beginEdit(), false);
  assert.equal(controller.beginManage("closed"), false);
  assert.equal(controller.beginManage("transfer", "member-7"), false);
  assert.equal(controller.beginManage("remove", "captain-7"), false);
  // 自己是普通成员的队伍：即使直接调用也不能处理该队申请。
  session.records.push({
    id: "incoming-8",
    teamId: "demo-8",
    applicantId: "applicant-8",
    nickname: "演示申请者八",
    role: "编程",
    note: "希望加入学习资料整理计划。",
    state: "PENDING",
  });
  assert.equal(controller.beginProcess("incoming-8", "invite"), false);
  assert.equal(controller.beginManage("leave"), true);
  controller.cancelConfirm();
  // 动作层同样拒绝，隐藏按钮不是唯一约束。
  assert.match(session.manage("demo-8", "closed"), /仅队长/);
});

test("A02 撤回自己的申请需确认，重复确认不产生额外变更", () => {
  const { session, state, controller } = fixture(null, "applications");
  const record = recordOf(session, "own-pending");
  const before = teamOf(session, "demo-3").members.length;
  assert.equal(controller.beginRespond("own-pending", "withdraw"), true);
  assert.match(state.confirm.title, /撤回申请/);
  controller.cancelConfirm();
  assert.equal(record.state, "PENDING");

  controller.beginRespond("own-pending", "withdraw");
  controller.submit();
  controller.submit();
  assert.equal(record.state, "WITHDRAWN");
  assert.equal(teamOf(session, "demo-3").members.length, before);
  assert.equal(controller.beginRespond("own-pending", "withdraw"), false);
});

test("A03 邀请与拒绝前取消不变；邀请只转已邀请并生成邀请，不加人", () => {
  const { session, controller } = fixture("demo-7");
  const members = () => teamOf(session, "demo-7").members.length;

  controller.beginProcess("incoming-1", "reject");
  controller.cancelConfirm();
  assert.equal(recordOf(session, "incoming-1").state, "PENDING");

  assert.equal(controller.beginProcess("incoming-1", "invite"), true);
  controller.submit();
  assert.equal(recordOf(session, "incoming-1").state, "INVITED");
  assert.equal(
    session.invitations.filter(
      (i) => i.applicationId === "incoming-1" && i.state === "ACTIVE",
    ).length,
    1,
  );
  assert.equal(members(), 2);
  assert.equal(controller.beginProcess("incoming-1", "invite"), false);

  assert.equal(controller.beginProcess("incoming-2", "reject"), false);
  assert.equal(recordOf(session, "incoming-2").state, "INVITED");
});

test("A03 拒绝只处理待处理申请，终态后不能再次处理", () => {
  const { session, controller } = fixture("demo-7");
  assert.equal(controller.beginProcess("incoming-1", "reject"), true);
  controller.submit();
  assert.equal(recordOf(session, "incoming-1").state, "REJECTED");
  assert.equal(teamOf(session, "demo-7").members.length, 2);
  assert.equal(controller.beginProcess("incoming-1", "invite"), false);
});

test("A04 撤销邀请保留历史，受邀者随后无法再确认入队", () => {
  const { session, state, controller } = fixture("demo-7");
  assert.equal(controller.beginProcess("incoming-2", "revoke"), true);
  controller.submit();
  assert.equal(recordOf(session, "incoming-2").state, "REVOKED");
  assert.equal(
    session.invitations.find((i) => i.applicationId === "incoming-2").state,
    "REVOKED",
  );
  assert.equal(teamOf(session, "demo-7").members.length, 2);
  // 受邀者一侧：没有有效邀请时入口与动作都失败。
  assert.equal(controller.beginRespond("incoming-2", "accept"), false);
  assert.match(
    session.respond("incoming-2", "accept", NOW),
    /找不到自己的申请|邀请已失效/,
  );
  assert.equal(teamOf(session, "demo-7").members.length, 2);
  assert.equal(state.confirm, null);
});

test("A05 接受邀请只增员一次，重复确认不再增加成员", () => {
  const { session, controller } = fixture(null, "applications");
  const team = teamOf(session, "demo-2");
  assert.equal(team.members.length, 2);
  assert.equal(controller.beginRespond("history-0", "accept"), true);
  controller.submit();
  controller.submit();
  assert.equal(team.members.length, 3);
  assert.equal(recordOf(session, "history-0").state, "ACCEPTED");
  assert.equal(
    session.invitations.find((i) => i.applicationId === "history-0").state,
    "ACCEPTED",
  );
  assert.equal(controller.beginRespond("history-0", "accept"), false);

  assert.equal(controller.beginRespond("own-accepted", "decline"), false);
});

test("A05 拒绝邀请保留终态且不增加成员", () => {
  const { session, controller } = fixture(null, "applications");
  const team = teamOf(session, "demo-2");
  assert.equal(controller.beginRespond("history-0", "decline"), true);
  controller.submit();
  assert.equal(recordOf(session, "history-0").state, "DECLINED");
  assert.equal(team.members.length, 2);
});

for (const [name, change] of [
  [
    "满员",
    (session) => {
      const team = teamOf(session, "demo-2");
      team.capacity = team.members.length;
    },
  ],
  [
    "已截止",
    (session) => {
      teamOf(session, "demo-2").deadline = new Date(0).toISOString();
    },
  ],
  [
    "已暂停",
    (session) => {
      teamOf(session, "demo-2").state = "paused";
    },
  ],
  [
    "已关闭",
    (session) => {
      teamOf(session, "demo-2").state = "closed";
    },
  ],
  [
    "已解散",
    (session) => {
      teamOf(session, "demo-2").dissolved = true;
    },
  ],
  [
    "角色需求被移除",
    (session) => {
      teamOf(session, "demo-2").roles = ["建模"];
    },
  ],
  [
    "邀请被撤销",
    (session) => {
      session.invitations.find((i) => i.applicationId === "history-0").state =
        "REVOKED";
    },
  ],
]) {
  test(`A06 打开确认后${name}，提交失败且不增加成员、不改写其他记录`, () => {
    const { session, state, controller } = fixture(null, "applications");
    const before = JSON.stringify(session.records);
    assert.equal(controller.beginRespond("history-0", "accept"), true);
    change(session);
    controller.submit();
    assert.match(state.feedback, /操作失败/);
    assert.equal(teamOf(session, "demo-2").members.length, 2);
    assert.equal(recordOf(session, "history-0").state, "INVITED");
    assert.equal(JSON.stringify(session.records), before);
    assert.equal(state.confirm, null);
  });
}

test("A07 移交后旧队长立即失去管理权限，成为普通成员后可退出", () => {
  const { session, controller, state } = fixture("demo-7");
  assert.equal(controller.beginManage("transfer", "member-6"), true);
  assert.match(controller.state.confirm.title, /移交队长/);
  // 确认标题必须写明移交给谁，且取消后仍保留已选成员。
  assert.match(controller.state.confirm.title, /演示伙伴 7/);
  assert.equal(state.successor, "member-6");
  controller.cancelConfirm();
  assert.equal(state.successor, "member-6");
  assert.equal(controller.beginManage("transfer", "member-6"), true);
  controller.submit();
  const team = teamOf(session, "demo-7");
  assert.equal(
    team.members.find((m) => m.id === DEMO_PARTICIPANT.id).captain,
    false,
  );
  assert.equal(team.members.find((m) => m.id === "member-6").captain, true);
  assert.equal(controller.isCaptain(team), false);
  assert.equal(controller.beginEdit(), false);
  assert.equal(controller.beginManage("closed"), false);
  assert.equal(controller.beginManage("leave"), true);
  controller.cancelConfirm();
});

test("A07 移交前打开的旧管理确认不能越权执行", () => {
  const { session, state, controller } = fixture("demo-7");
  assert.equal(controller.beginManage("closed"), true);
  session.manage("demo-7", "transfer", "member-6");
  controller.submit();
  assert.equal(teamOf(session, "demo-7").state, "open");
  assert.match(state.feedback, /仅队长/);
  assert.equal(state.confirm, null);
});

test("A08 移除成员、退出队伍与解散都会清理成员关系与联系方式授权", () => {
  const { session, controller } = fixture("demo-7");
  session.contactAuthorizations["member-6"] = true;
  assert.equal(session.canViewContact("demo-7", "member-6"), true);
  assert.equal(controller.beginManage("remove", "member-6"), true);
  controller.submit();
  assert.equal(teamOf(session, "demo-7").members.length, 1);
  assert.equal("member-6" in session.contactAuthorizations, false);
  assert.equal(session.canViewContact("demo-7", "member-6"), false);

  controller.select("demo-8");
  session.contactShared = true;
  assert.equal(session.canViewContact("demo-8", DEMO_PARTICIPANT.id), true);
  assert.equal(controller.beginManage("leave"), true);
  controller.submit();
  assert.equal(
    controller.mine().some((t) => t.id === "demo-8"),
    false,
  );
  assert.equal(session.canViewContact("demo-8", DEMO_PARTICIPANT.id), false);
  assert.equal(controller.state.selectedId, "");

  controller.select("demo-7");
  session.contactAuthorizations[DEMO_PARTICIPANT.id] = true;
  assert.equal(controller.beginManage("dissolve"), true);
  controller.submit();
  const dissolved = teamOf(session, "demo-7");
  assert.equal(dissolved.dissolved, true);
  assert.equal(dissolved.members.length, 0);
  assert.deepEqual(session.contactAuthorizations, {});
  assert.equal(session.canViewContact("demo-7", DEMO_PARTICIPANT.id), false);
  assert.equal(controller.selectedTeam(), undefined);
});

test("A09 关闭招募后没有暂停或恢复入口，直接调用也失败", () => {
  const { session, controller } = fixture("demo-7");
  assert.equal(controller.beginManage("closed"), true);
  controller.submit();
  const team = teamOf(session, "demo-7");
  assert.equal(team.state, "closed");
  assert.equal(recordOf(session, "incoming-2").state, "INVALID");
  assert.equal(recordOf(session, "incoming-1").state, "INVALID");
  assert.equal(controller.beginManage("paused"), false);
  assert.equal(controller.beginManage("open"), false);
  assert.match(session.manage("demo-7", "paused"), /不能暂停或恢复/);
  assert.match(session.manage("demo-7", "open"), /不能暂停或恢复/);
});

test("A10 编辑校验准确、首错可定位、草稿保留，成功后列表与详情同步", () => {
  const { session, state, controller } = fixture("demo-7");
  assert.equal(controller.beginEdit(), true);
  assert.equal(state.draft.title, "植物摄影小组");

  state.draft.title = "短";
  assert.equal(controller.saveEdit(), false);
  assert.equal(state.errors.title, "标题需为 2–60 字。");
  assert.equal(state.errorTarget, "profile-team-title-field");
  assert.ok(state.draft);
  assert.equal(teamOf(session, "demo-7").title, "植物摄影小组");

  state.draft.title = "校园植物摄影";
  state.draft.roles = [];
  state.draft.skills = "字".repeat(501);
  assert.equal(controller.saveEdit(), false);
  // 首错按表单视觉顺序：技能说明在角色需求之上。
  assert.equal(state.errorTarget, "profile-team-skills-field");
  state.draft.skills = "";
  assert.equal(controller.saveEdit(), false);
  assert.equal(state.errorTarget, "profile-team-roles-field");

  state.draft.roles = ["设计"];
  state.draft.capacity = "1";
  assert.equal(controller.saveEdit(), false);
  assert.equal(state.errorTarget, "profile-team-capacity-field");

  state.draft.capacity = "2";
  teamOf(session, "demo-7").members.push({
    id: "member-extra",
    nickname: "额外成员",
    role: "调研",
    captain: false,
  });
  assert.equal(controller.saveEdit(), false);
  assert.match(state.errors.capacity, /容量不能小于当前成员人数/);

  state.draft.capacity = "3";
  state.draft.deadline = "2026-10-20T09:59";
  assert.equal(controller.saveEdit(), false);
  assert.match(state.errors.deadline, /晚于当前时刻/);

  state.draft.deadline = "2026-12-01T12:00";
  state.draft.mode = "offline";
  state.draft.location = "";
  assert.equal(controller.saveEdit(), false);
  assert.match(state.errors.location, /线下合作地点/);

  state.draft.location = "雅安校区";
  assert.equal(controller.saveEdit(), true);
  assert.equal(state.draft, null);
  assert.equal(teamOf(session, "demo-7").title, "校园植物摄影");
  assert.equal(controller.selectedTeam().title, "校园植物摄影");
  assert.ok(controller.mine().some((t) => t.title === "校园植物摄影"));
});

test("A11 容量与截止沿用共享校验边界", () => {
  const { state, controller } = fixture("demo-7");
  for (const capacity of ["21", "0", "2.5", ""]) {
    controller.beginEdit();
    state.draft.capacity = capacity;
    assert.equal(controller.saveEdit(), false, capacity);
    assert.ok(state.errors.capacity, capacity);
    controller.cancelEdit();
  }
  controller.beginEdit();
  state.draft.capacity = "20";
  assert.equal(controller.saveEdit(), true);
  controller.beginEdit();
  state.draft.deadline = "2026-10-20T10:00";
  assert.equal(controller.saveEdit(), false);
  assert.match(state.errors.deadline, /晚于当前时刻/);
  controller.cancelEdit();
});

test("A12 取消编辑不保留改动，重新打开读取最新队伍并保留比赛关联", () => {
  const { session, state, controller } = fixture("demo-7");
  const team = teamOf(session, "demo-7");
  team.type = "competition";
  team.trackId = "track-a";
  team.competition = {
    id: "competition-a",
    name: "示例比赛",
    edition: "2026",
    category: "创新",
    organizer: "示例学院",
    origin: "demo",
    tracks: [{ id: "track-a", name: "赛道 A", members: "3 人", rules: "规则" }],
    stages: [],
    notices: [],
    evaluatedAt: new Date(NOW).toISOString(),
  };
  controller.beginEdit();
  state.draft.title = "未保存的标题";
  controller.cancelEdit();
  assert.equal(state.draft, null);
  assert.equal(team.title, "植物摄影小组");

  controller.beginEdit();
  assert.equal(state.draft.title, "植物摄影小组");
  assert.equal(state.draft.competition.id, "competition-a");
  assert.equal(state.draft.trackId, "track-a");
  state.draft.progress = "已补充进度";
  assert.equal(controller.saveEdit(), true);
  assert.equal(team.progress, "已补充进度");
  assert.equal(team.competition.id, "competition-a");
  assert.equal(team.trackId, "track-a");
  assert.equal(team.type, "competition");
});

test("A13 会话重置后旧确认与旧编辑不作用于同 ID 新对象", () => {
  const { session, state, controller } = fixture("demo-7");
  assert.equal(controller.beginManage("closed"), true);
  session.reset();
  controller.submit();
  assert.equal(teamOf(session, "demo-7").state, "open");
  assert.match(state.feedback, /操作失败/);
  assert.equal(state.confirm, null);

  controller.select("demo-7");
  controller.beginEdit();
  state.draft.title = "重置前的草稿";
  session.reset();
  assert.equal(controller.saveEdit(), false);
  assert.equal(teamOf(session, "demo-7").title, "植物摄影小组");
  assert.equal(state.draft, null);
  assert.match(state.feedback, /队伍已变化/);
});

test("A13 重置后再次选择可正常编辑新对象", () => {
  const { session, state, controller } = fixture("demo-7");
  controller.beginEdit();
  session.reset();
  controller.reset();
  assert.equal(state.draft, null);
  assert.equal(state.selectedId, "");
  controller.select("demo-7");
  assert.equal(controller.beginEdit(), true);
  state.draft.title = "重置后的新标题";
  assert.equal(controller.saveEdit(), true);
  assert.equal(teamOf(session, "demo-7").title, "重置后的新标题");
});

test("A14 会话内新队伍可被同一个对象管理，人数一致", () => {
  const { session, controller } = fixture(null);
  const team = session.publish(
    {
      ...emptyDraft(),
      title: "会话内新队伍",
      type: "other",
      goal: "一起完成一个可以展示的校园学习项目。",
      roles: ["编程"],
      mode: "online",
      capacity: "4",
      deadline: "2026-12-01T12:00",
    },
    NOW,
  );
  assert.ok(team);
  assert.ok(controller.mine().some((t) => t.id === team.id));
  controller.select(team.id);
  // 列表、详情与会话发布返回的对象共享同一份状态（响应式代理与原始对象同源）。
  assert.equal(controller.selectedTeam().id, team.id);
  assert.equal(controller.selectedTeam().members.length, team.members.length);
  assert.equal(controller.isCaptain(controller.selectedTeam()), true);
  assert.equal(controller.beginEdit(), true);
  controller.cancelEdit();
  assert.equal(controller.beginManage("paused"), true);
  controller.submit();
  assert.equal(team.state, "paused");
  assert.equal(controller.selectedTeam().members.length, 1);
});

test("A15 无队伍、无记录时返回空集合，选择失效队伍不保留详情", () => {
  const { session, controller } = fixture("demo-7");
  session.teams.forEach((t) => {
    t.members = t.members.filter((m) => m.id !== DEMO_PARTICIPANT.id);
  });
  assert.deepEqual(controller.mine(), []);
  controller.select("demo-7");
  assert.equal(controller.selectedTeam(), undefined);
  assert.equal(controller.state.selectedId, "");
  session.records = [];
  assert.deepEqual(controller.ownRecords(), []);
  assert.deepEqual(controller.teamRecords(undefined), []);
});

test("A16 切分区清理弹层与选择，同分区重复进入不误清确认", () => {
  const { state, controller } = fixture("demo-7");
  assert.equal(controller.beginManage("closed"), true);
  controller.switchSection("teams");
  assert.ok(state.confirm);
  controller.switchSection("applications");
  assert.equal(state.confirm, null);
  assert.equal(state.selectedId, "");
  assert.equal(state.feedback, "");
});

test("统一重置恢复初始示例并保留明确反馈", () => {
  const { session, state, controller } = fixture("demo-7");
  assert.equal(controller.beginEdit(), true);
  state.draft.title = "待丢弃";
  controller.resetAll();
  assert.equal(state.draft, null);
  assert.equal(state.selectedId, "");
  assert.match(state.feedback, /已重置/);
  assert.equal(teamOf(session, "demo-7").title, "植物摄影小组");
});
