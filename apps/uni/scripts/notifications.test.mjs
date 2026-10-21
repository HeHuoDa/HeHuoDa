import assert from "node:assert/strict";
import { test } from "node:test";
import { createPinia } from "pinia";
import { useSessionStore } from "../src/stores/session.ts";
import {
  initialTeamState,
  createTeamActions,
} from "@hehuoda/client-domain/team-session";
import { DEMO_PARTICIPANT, draftFromTeam } from "@hehuoda/client-domain/team";
import {
  captureNotificationBaseline,
  createNotificationActions,
  initialNotifications,
  filterNotifications,
  notificationType,
} from "../src/stores/notification-session.ts";

test("首次打开通知页之前的退出动作生成一次进展，失败重试不重复", () => {
  const session = useSessionStore(createPinia());
  const initial = session.notifications.length;
  session.manage("demo-8", "leave");
  assert.equal(session.notifications.length, initial + 1);
  assert.equal(session.notifications.at(-1).target.teamId, "demo-8");
  session.manage("demo-8", "leave");
  assert.equal(session.notifications.length, initial + 1);
});

function fixture() {
  const now = Date.now();
  const teams = initialTeamState(now);
  const actions = createTeamActions(teams, {
    contactShared: false,
    reset() {},
  });
  const state = { notifications: initialNotifications() };
  const notifications = createNotificationActions(
    state,
    teams,
    actions.invitationProblem,
  );
  function change(action) {
    const before = captureNotificationBaseline(teams);
    action();
    notifications.recordChanges(before, now);
  }
  return { now, teams, actions, state, notifications, change };
}

test("固定身份不能触发的他人转换经事件边界映射，邀请/拒绝/撤销/失效去重", () => {
  for (const next of ["INVITED", "REJECTED", "REVOKED", "INVALID"]) {
    const f = fixture();
    const record = f.teams.records.find((r) => r.id === "own-pending");
    if (["REVOKED", "INVALID"].includes(next)) {
      record.state = "INVITED";
      f.teams.invitations.push({
        id: "external-inv",
        applicationId: record.id,
        state: "ACTIVE",
      });
    }
    const initial = f.state.notifications.length;
    f.change(() => {
      record.state = next;
      if (next === "INVITED")
        f.teams.invitations.push({
          id: "external-inv",
          applicationId: record.id,
          state: "ACTIVE",
        });
      else if (next !== "REJECTED")
        f.teams.invitations.find((i) => i.id === "external-inv").state = next;
    });
    assert.equal(f.state.notifications.length, initial + 1, next);
    assert.equal(f.state.notifications.at(-1).target.recordId, record.id);
    f.change(() => {});
    assert.equal(f.state.notifications.length, initial + 1);
  }
});

test("队长收到新申请会定位队伍，初始历史/他人变化/移交不补发", () => {
  const f = fixture();
  const initial = f.state.notifications.length;
  f.change(() => {});
  assert.equal(f.state.notifications.length, initial);
  f.change(() =>
    f.teams.records.push({
      id: "external-new",
      teamId: "demo-7",
      applicantId: "external",
      nickname: "同学",
      role: "调研",
      note: "申请",
      state: "PENDING",
    }),
  );
  assert.deepEqual(f.state.notifications.at(-1).target, {
    section: "teams",
    teamId: "demo-7",
    recordId: "external-new",
  });
  f.change(() => f.actions.manage("demo-7", "transfer", "member-6"));
  assert.equal(f.state.notifications.length, initial + 1);
});

test("邀请截止只记录观察，不改业务状态，恢复后再次不可用不重复", () => {
  const f = fixture();
  const record = f.teams.records.find((r) => r.id === "history-0");
  const team = f.teams.teams.find((t) => t.id === record.teamId);
  team.state = "open";
  team.capacity = 20;
  team.roles = [record.role];
  team.deadline = new Date(f.now + 1000).toISOString();
  f.notifications.sync(f.now);
  const initial = f.state.notifications.length;
  f.notifications.sync(f.now + 1000);
  assert.equal(f.state.notifications.length, initial + 1);
  assert.equal(record.state, "INVITED");
  assert.equal(
    f.teams.invitations.find((i) => i.applicationId === record.id).state,
    "ACTIVE",
  );
  f.notifications.sync(f.now + 2000);
  team.deadline = new Date(f.now + 10000).toISOString();
  f.notifications.sync(f.now + 2000);
  team.state = "paused";
  f.notifications.sync(f.now + 2000);
  assert.equal(f.state.notifications.length, initial + 1);
});

test("同次显式失效只有一条转换通知，失败重试不添加", () => {
  const f = fixture();
  const record = f.teams.records.find((r) => r.id === "history-0");
  const initial = f.state.notifications.length;
  f.change(() => {
    record.state = "INVALID";
    f.teams.invitations.find((i) => i.applicationId === record.id).state =
      "INVALID";
  });
  f.notifications.sync(f.now + 1);
  assert.equal(f.state.notifications.length, initial + 1);
});

test("共享 session 中确认入队再退出分别通知，资料重置保留，统一重置恢复", () => {
  const s = useSessionStore(createPinia());
  const r = s.records.find((r) => r.id === "history-0");
  const t = s.teams.find((t) => t.id === r.teamId);
  t.state = "open";
  t.roles = [r.role];
  t.capacity = 20;
  t.deadline = new Date(Date.now() + 60000).toISOString();
  const initial = s.notifications.length;
  s.respond(r.id, "accept");
  assert.equal(s.notifications.length, initial + 1);
  s.respond(r.id, "accept");
  assert.equal(s.notifications.length, initial + 1);
  s.manage(t.id, "leave");
  assert.equal(s.notifications.length, initial + 2);
  s.resetProfile();
  assert.equal(s.notifications.length, initial + 2);
  const business = JSON.stringify([s.records, s.invitations, s.teams]);
  s.markAllNotificationsRead(123);
  assert.equal(s.unreadNotificationCount, 0);
  assert.equal(JSON.stringify([s.records, s.invitations, s.teams]), business);
  s.reset();
  assert.deepEqual(
    JSON.parse(JSON.stringify(s.notifications)),
    initialNotifications(),
  );
  assert.equal(s.sessionRevision, 1);
  s.manage("demo-8", "leave");
  assert.equal(s.notifications.length, initial + 1);
});

test("筛选不影响全局全部已读且保留首次 readAt；未知类型安全兜底", () => {
  const f = fixture();
  f.state.notifications.push({
    id: "future",
    type: "future",
    title: "<script>",
    body: "纯文本",
    time: f.now,
    readAt: null,
  });
  assert.equal(
    filterNotifications(f.state.notifications, true, "announcement").length,
    1,
  );
  f.notifications.markRead("future", 1);
  f.notifications.markRead("future", 2);
  assert.equal(f.state.notifications.at(-1).readAt, 1);
  f.notifications.markAllRead(3);
  assert.equal(filterNotifications(f.state.notifications, true, "").length, 0);
  assert.equal(filterNotifications([], false, "").length, 0);
  assert.equal(notificationType("future"), "其他通知");
});

test("发布新队伍不是确认入队，不制造成员进展通知", () => {
  const s = useSessionStore(createPinia());
  const draft = draftFromTeam(s.teams.find((t) => t.id === "demo-7"));
  draft.deadline = "2099-01-01T12:00";
  const initial = s.notifications.length;
  assert.ok(s.publish(draft));
  assert.equal(s.notifications.length, initial);
});

test("外部移除自己由转换 fixture 覆盖，解散由共享动作覆盖，成员事件各一次", () => {
  const f = fixture();
  const team = f.teams.teams.find((t) => t.id === "demo-8");
  const initial = f.state.notifications.length;
  // 只有外部队长才能移除当前演示用户，测试在事件边界送入对应合法结果。
  f.change(() => {
    team.members = team.members.filter((m) => m.id !== DEMO_PARTICIPANT.id);
  });
  assert.equal(f.state.notifications.length, initial + 1);
  assert.deepEqual(f.state.notifications.at(-1).target, {
    section: "teams",
    teamId: "demo-8",
  });
  f.change(() => {});
  assert.equal(f.state.notifications.length, initial + 1);
  const s = useSessionStore(createPinia());
  const before = s.notifications.length;
  s.manage("demo-7", "dissolve");
  assert.equal(s.notifications.length, before + 1);
  assert.match(s.notifications.at(-1).title, /成员关系已结束/);
  s.manage("demo-7", "dissolve");
  assert.equal(s.notifications.length, before + 1);
});
