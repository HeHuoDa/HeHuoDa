import assert from "node:assert/strict";
import { test } from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { useSessionStore } from "../src/stores/session.ts";
import {
  createTeamDetailController,
  initialTeamDetailState,
} from "../src/stores/team-detail-controller.ts";

function fixture(id = "demo-1") {
  setActivePinia(createPinia());
  const session = useSessionStore();
  const now = Date.now();
  const state = initialTeamDetailState();
  const controller = createTeamDetailController(state, session, () => now);
  controller.load(id);
  return { session, state, controller };
}

test("队伍不再需要任何角色时，详情不提供可用的申请入口", () => {
  const { session, controller, state } = fixture();
  session.teams[0].roles = [];
  assert.equal(controller.view().status.available, false);
  controller.begin("apply");
  assert.equal(state.action, null);
});

test("详情申请只新增一条待处理记录，重复提交与撤回都不增员", () => {
  const { session, controller, state } = fixture();
  controller.begin("apply");
  state.note = "希望一起观察校园植物";
  controller.submit();
  controller.submit();
  assert.equal(controller.view().record.state, "PENDING");
  assert.equal(session.records.filter((a) => a.teamId === "demo-1").length, 1);
  assert.equal(controller.view().team.members.length, 2);
  controller.begin("withdraw");
  controller.submit();
  assert.equal(controller.view().record.state, "WITHDRAWN");
  assert.equal(controller.view().team.members.length, 2);
  assert.equal(controller.view().status.available, true);
});

test("待邀请不占名额，确认后列表与详情的同一队伍只增加一次成员", () => {
  const { session, controller } = fixture("demo-2");
  const listTeam = session.teams.find((t) => t.id === "demo-2");
  assert.equal(controller.view().team.members.length, 2);
  controller.begin("accept");
  controller.submit();
  controller.submit();
  assert.equal(controller.view().team, listTeam);
  assert.equal(listTeam.members.length, 3);
  assert.equal(controller.view().record.state, "ACCEPTED");
  assert.equal(controller.view().invited, false);
  assert.equal(controller.view().status.available, false);
});

for (const [name, change] of [
  [
    "最后一个名额被占",
    (s, t) => {
      t.capacity = t.members.length;
    },
  ],
  [
    "已截止",
    (s, t) => {
      t.deadline = new Date(0).toISOString();
    },
  ],
  [
    "已暂停",
    (s, t) => {
      t.state = "paused";
    },
  ],
  [
    "已关闭",
    (s, t) => {
      t.state = "closed";
    },
  ],
  [
    "已解散",
    (s, t) => {
      t.dissolved = true;
    },
  ],
  [
    "角色被移除",
    (s, t) => {
      t.roles = ["建模"];
    },
  ],
  [
    "邀请被撤销",
    (s) => {
      s.invitations.find((i) => i.applicationId === "history-0").state =
        "REVOKED";
    },
  ],
]) {
  test(`打开确认后${name}，提交失败且不增加成员`, () => {
    const { session, controller, state } = fixture("demo-2");
    controller.begin("accept");
    change(session, controller.view().team);
    controller.submit();
    assert.equal(
      session.teams.find((t) => t.id === "demo-2").members.length,
      2,
    );
    assert.notEqual(
      session.records.find((a) => a.id === "history-0").state,
      "ACCEPTED",
    );
    assert.match(state.feedback, /操作失败/);
  });
}

test("拒绝邀请保留终态且不增加成员", () => {
  const { controller } = fixture("demo-2");
  controller.begin("decline");
  controller.submit();
  assert.equal(controller.view().record.state, "DECLINED");
  assert.equal(controller.view().team.members.length, 2);
});

test("他人的邀请不能成为当前参与者的接受入口", () => {
  const { controller, state } = fixture("demo-7");
  assert.equal(controller.view().invited, false);
  controller.begin("accept");
  assert.equal(state.action, null);
});

test("会话重置后，旧确认不能接受恢复出来的同 ID 邀请", () => {
  const { session, controller, state } = fixture("demo-2");
  controller.begin("accept");
  session.reset();
  controller.submit();
  assert.equal(controller.view().record.state, "INVITED");
  assert.equal(controller.view().team.members.length, 2);
  assert.match(state.feedback, /操作失败/);
});

test("同 ID 申请被替换后，旧确认不能改动新记录", () => {
  const { session, controller, state } = fixture("demo-2");
  controller.begin("accept");
  const index = session.records.findIndex((a) => a.id === "history-0");
  session.records[index] = { ...session.records[index] };
  controller.submit();
  assert.equal(controller.view().record.state, "INVITED");
  assert.equal(controller.view().team.members.length, 2);
  assert.match(state.feedback, /申请记录已变化/);
});

test("申请校验 500 字边界与失效角色，错误保留草稿并定位对应字段", () => {
  const { session, controller, state } = fixture();
  controller.begin("apply");
  state.note = "字".repeat(501);
  controller.submit();
  assert.equal(controller.view().record, undefined);
  assert.equal(state.errorTarget, "team-action-note-field");
  assert.equal(state.action, "apply");
  state.note = "字".repeat(500);
  session.teams[0].roles = ["编程"];
  controller.submit();
  assert.equal(state.errorTarget, "team-action-role-field");
  state.role = "编程";
  controller.submit();
  assert.equal(controller.view().record.note.length, 500);
});

test("举报仅给演示反馈，取消或换队伍丢弃草稿，不修改申请及成员", () => {
  const { session, controller, state } = fixture();
  const before = JSON.stringify({
    teams: session.teams,
    records: session.records,
  });
  controller.begin("report");
  controller.submit();
  assert.ok(state.error);
  state.role = "信息不实";
  controller.submit();
  assert.match(state.feedback, /没有实际进入审核/);
  assert.equal(
    JSON.stringify({ teams: session.teams, records: session.records }),
    before,
  );
  controller.begin("report");
  state.note = "未提交草稿";
  controller.cancel();
  assert.equal(state.note, "");
  controller.load("session-missing");
  assert.equal(controller.view().team, undefined);
  assert.equal(state.action, null);
});
