import assert from "node:assert/strict";
import { test } from "node:test";
import { createPinia } from "pinia";
import { useSessionStore } from "../src/stores/session.ts";
import {
  resolveNotificationTarget,
  profileNotificationTarget,
} from "../src/navigation/notification-target.ts";

test("自己的终态申请仍可定位，队长申请进入 teams，越权/失效返回具体错误", () => {
  const s = useSessionStore(createPinia());
  const own = resolveNotificationTarget(s, {
    section: "applications",
    teamId: "demo-3",
    recordId: "own-pending",
  });
  assert.equal(own.error, undefined);
  s.records.find((r) => r.id === "own-pending").state = "REJECTED";
  assert.equal(resolveNotificationTarget(s, own.target).error, undefined);
  const incoming = resolveNotificationTarget(s, {
    section: "teams",
    teamId: "demo-7",
    recordId: "incoming-1",
  });
  assert.equal(incoming.error, undefined);
  assert.match(
    resolveNotificationTarget(s, {
      section: "applications",
      teamId: "demo-7",
      recordId: "incoming-1",
    }).error,
    /不属于/,
  );
  s.manage("demo-8", "leave");
  assert.match(
    resolveNotificationTarget(s, { section: "teams", teamId: "demo-8" }).error,
    /成员/,
  );
  s.manage("demo-7", "dissolve");
  assert.match(resolveNotificationTarget(s, incoming.target).error, /解散/);
});

test("邀请撤销、失效、暂不可用均拒绝跳转，确认完成的历史记录仍可读", () => {
  const s = useSessionStore(createPinia());
  const r = s.records.find((r) => r.id === "history-0");
  const t = s.teams.find((t) => t.id === r.teamId);
  t.state = "open";
  t.capacity = 20;
  t.roles = [r.role];
  t.deadline = "2099-01-01T00:00:00Z";
  const target = {
    section: "applications",
    teamId: t.id,
    recordId: r.id,
    invitationId: "inv-history-0",
  };
  assert.equal(resolveNotificationTarget(s, target).error, undefined);
  t.state = "paused";
  assert.match(resolveNotificationTarget(s, target).error, /暂停/);
  t.state = "open";
  s.respond(r.id, "accept");
  assert.equal(resolveNotificationTarget(s, target).error, undefined);
  r.state = "REVOKED";
  assert.match(resolveNotificationTarget(s, target).error, /撤销/);
});

test("参数必须有效且归属匹配；旧会话意图不能定位新示例", () => {
  const s = useSessionStore(createPinia());
  assert.equal(
    profileNotificationTarget(s, "applications", { recordId: "own-pending" })
      .target.teamId,
    "demo-3",
  );
  assert.match(
    profileNotificationTarget(s, "applications", {
      recordId: ["own-pending", "incoming-1"],
    }).error,
    /参数/,
  );
  assert.match(
    profileNotificationTarget(s, "teams", {
      teamId: "demo-7",
      recordId: "own-pending",
    }).error,
    /归属/,
  );
  const query = {
    recordId: "own-pending",
    revision: String(s.sessionRevision),
  };
  s.reset();
  assert.match(
    profileNotificationTarget(s, "applications", query).error,
    /重置/,
  );
});
