import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { createPinia } from "pinia";
import { computed, effectScope, nextTick, version } from "vue";
import { useSessionStore } from "../src/stores/session.ts";
import { colleges } from "../src/data/colleges.ts";
import { colleges as pureColleges } from "@hehuoda/client-domain/colleges";
import { DEMO_PARTICIPANT } from "@hehuoda/client-domain/team";
import { useNavigationStore } from "../src/stores/navigation.ts";

test("统一重置先失效旧操作再恢复示例，并清除所有一次性导航", () => {
  const pinia = createPinia();
  const store = useSessionStore(pinia);
  const navigation = useNavigationStore(pinia);
  const oldTeam = store.teams[0];
  store.addFavorite("old");
  navigation.requestTabQuery("teams", { competition: "old" });
  navigation.requestProfileSection("applications", { recordId: "history-0" });
  store.registerReset("pending-operation", () => {
    assert.equal(store.sessionRevision, 1);
    assert.equal(store.teams[0], oldTeam, "旧控制器清理时尚未恢复同 ID 示例");
  });
  store.reset();
  assert.notEqual(store.teams[0], oldTeam);
  assert.equal(store.favoriteCount, 0);
  assert.equal(navigation.consumeTabQuery("teams"), null);
  assert.equal(navigation.consumeProfileNavigation(), null);
});

test("个人资料昵称跨页展示，既有与新建队伍均按当前资料读取，不改变其他成员", () => {
  const store = useSessionStore(createPinia());
  store.saveProfile({ ...store.profile, nickname: "新的伙伴" });
  assert.equal(store.memberNickname(DEMO_PARTICIPANT.id, "旧昵称"), "新的伙伴");
  assert.equal(store.memberNickname("someone-else", "其他成员"), "其他成员");
  store.resetProfile();
  assert.equal(store.memberNickname(DEMO_PARTICIPANT.id, "旧昵称"), "禾小苗");
});

test("联系方式须授权且双方有效同队，邀请未确认、退出、移除和解散立即失效", () => {
  const store = useSessionStore(createPinia());
  const invitation = store.records.find((a) => a.id === "history-0");
  const invitedTeam = store.teams.find((t) => t.id === invitation.teamId);
  const peer = invitedTeam.members[0].id;
  assert.equal(
    store.canViewContact(invitedTeam.id, DEMO_PARTICIPANT.id, peer),
    false,
  );
  store.contactShared = true;
  assert.equal(
    store.canViewContact(invitedTeam.id, DEMO_PARTICIPANT.id, peer),
    false,
  );
  store.respond("history-0", "accept");
  assert.equal(
    store.canViewContact(invitedTeam.id, DEMO_PARTICIPANT.id, peer),
    true,
  );
  store.contactShared = false;
  assert.equal(
    store.canViewContact(invitedTeam.id, DEMO_PARTICIPANT.id, peer),
    false,
  );
  store.contactShared = true;
  store.manage(invitedTeam.id, "leave");
  assert.equal(
    store.canViewContact(invitedTeam.id, DEMO_PARTICIPANT.id, peer),
    false,
  );
  const ledTeam = store.teams.find((t) =>
    t.members.some((m) => m.id === DEMO_PARTICIPANT.id && m.captain),
  );
  const member = ledTeam.members.find((m) => m.id !== DEMO_PARTICIPANT.id);
  assert.equal(
    store.canViewContact(ledTeam.id, DEMO_PARTICIPANT.id, member.id),
    true,
  );
  store.manage(ledTeam.id, "remove", member.id);
  assert.equal(
    store.canViewContact(ledTeam.id, DEMO_PARTICIPANT.id, member.id),
    false,
  );
  store.manage(ledTeam.id, "dissolve");
  assert.equal(
    store.canViewContact(ledTeam.id, DEMO_PARTICIPANT.id, DEMO_PARTICIPANT.id),
    false,
  );
  store.reset();
  assert.equal(store.contactShared, false);
});

test("uni 资源目录与共享规则学院 ID、名称及顺序一致", () => {
  assert.deepEqual(
    colleges.map(({ id, name }) => ({ id, name })),
    pureColleges,
  );
});

test("两个页面消费者共用应用内唯一会话，成员与申请/邀请派生数据同步", async () => {
  const pinia = createPinia();
  const scope = effectScope();
  try {
    const [teamPage, profilePage] = scope.run(() => {
      const team = useSessionStore(pinia);
      const profile = useSessionStore(pinia);
      return [
        { session: team, count: computed(() => team.teams[1].members.length) },
        {
          session: profile,
          state: computed(
            () => profile.records.find((a) => a.id === "history-0").state,
          ),
          count: computed(() => profile.teams[1].members.length),
        },
      ];
    });
    assert.equal(teamPage.session, profilePage.session);
    assert.equal(teamPage.count.value, 2);
    assert.equal(profilePage.state.value, "INVITED");
    teamPage.session.respond("history-0", "accept");
    await nextTick();
    assert.equal(profilePage.state.value, "ACCEPTED");
    assert.equal(profilePage.count.value, 3);
    assert.equal(teamPage.count.value, 3);
    profilePage.session.reset();
    await nextTick();
    assert.equal(teamPage.count.value, 2);
    assert.equal(profilePage.state.value, "INVITED");
  } finally {
    scope.stop();
  }
});

test("Pinia 按应用隔离，重建应用不会继承上一会话资料与授权", () => {
  const first = useSessionStore(createPinia());
  first.saveProfile({ ...first.profile, nickname: "上一会话" });
  first.contactShared = true;
  first.apply("demo-1", "调研", "上一会话申请");
  const second = useSessionStore(createPinia());
  assert.equal(second.profile.nickname, "禾小苗");
  assert.equal(second.contactShared, false);
  assert.equal(second.applications["demo-1"], undefined);
  assert.equal(first.profile.nickname, "上一会话");
});

test("会话 reset 复原所有拥有者、关闭授权，资料单独 reset 不覆盖队伍", () => {
  const store = useSessionStore(createPinia());
  store.contactShared = true;
  store.contactAuthorizations["member-0"] = true;
  store.apply("demo-1", "调研", "申请");
  store.resetProfile();
  assert.equal(store.contactShared, false);
  assert.ok(store.applications["demo-1"]);
  store.reset();
  assert.equal(store.applications["demo-1"], undefined);
  assert.deepEqual(store.contactAuthorizations, {});
  assert.equal(store.records.length, 10);
});

test("收藏/通知可以注册重置入口并撤销，不引入反向 store 依赖", () => {
  const store = useSessionStore(createPinia());
  let count = 0;
  const oldCleanup = store.registerReset("favorites", () => {
    count += 100;
  });
  const cleanup = store.registerReset("favorites", () => {
    count++;
  });
  oldCleanup();
  store.reset();
  assert.equal(count, 1);
  cleanup();
  store.reset();
  assert.equal(count, 1);
});

test("动作在无浏览器、网络或存储对象的环境中运行", () => {
  for (const key of [
    "uni",
    "window",
    "document",
    "localStorage",
    "sessionStorage",
  ])
    assert.equal(typeof globalThis[key], "undefined");
  const store = useSessionStore(createPinia());
  assert.equal(store.apply("demo-1", "调研", "纯会话"), true);
  assert.match(store.respond("history-0", "accept"), /已确认/);
  store.saveProfile({ ...store.profile, nickname: "仅内存" });
  store.reset();
  assert.equal(store.profile.nickname, "禾小苗");
});

test("运行时使用目标 Vue 与 Pinia，纯规则依赖图不包含框架和旧 Web", () => {
  assert.equal(version, "3.5.42");
  assert.equal(
    JSON.parse(
      readFileSync(
        new URL("../node_modules/pinia/package.json", import.meta.url),
      ),
    ).version,
    "3.0.4",
  );
  const directory = new URL(
    "../../../packages/client-domain/src/",
    import.meta.url,
  );
  for (const filename of readdirSync(directory)) {
    const source = readFileSync(new URL(filename, directory), "utf8");
    assert.doesNotMatch(
      source,
      /from\s+["'](?:vue|pinia|vue-router|axios|.*apps\/web)/,
    );
    assert.doesNotMatch(
      source,
      /\b(?:window|document|setInterval|setTimeout|localStorage|sessionStorage)\s*[.(]/,
    );
  }
  const application = new URL("../src/", import.meta.url);
  for (const filename of readdirSync(application, { recursive: true })) {
    if (!/\.(?:ts|vue)$/.test(filename)) continue;
    const source = readFileSync(
      new URL(filename.replaceAll("\\", "/"), application),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /(?:from\s*|import\s*\()["'][^"']*(?:apps\/web|@hehuoda\/web)/,
    );
  }
  const manifest = JSON.parse(
    readFileSync(
      new URL("../../../packages/client-domain/package.json", import.meta.url),
    ),
  );
  assert.deepEqual(Object.keys(manifest.dependencies), ["@hehuoda/api-types"]);
});
