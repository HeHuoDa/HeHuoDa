import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { extname } from "node:path";
import { after, test } from "node:test";
import { effectScope, nextTick, reactive } from "vue";
import { compileScript, parse } from "vue/compiler-sfc";
import { createPinia, setActivePinia } from "pinia";
import { useSessionStore } from "../src/stores/session.ts";
import { useNavigationStore } from "../src/stores/navigation.ts";
import { mount, textOf } from "./component-host.mjs";
import {
  createProfileTeamController,
  initialProfileTeamState,
} from "../src/stores/profile-team-controller.ts";

// 执行真实页面 setup，仅替换平台生命周期与不渲染的子组件。
const lifecycleUrl = `data:text/javascript,${encodeURIComponent(`
  export const hooks = { load: [], show: [], hide: [], unload: [] };
  export const onLoad = fn => hooks.load.push(fn);
  export const onShow = fn => hooks.show.push(fn);
  export const onHide = fn => hooks.hide.push(fn);
  export const onUnload = fn => hooks.unload.push(fn);
`)}`;
const loader = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@dcloudio/uni-app")
      return { url: lifecycleUrl, shortCircuit: true };
    if (specifier.endsWith(".vue"))
      return {
        url: "data:text/javascript,export default {}",
        shortCircuit: true,
      };
    if (specifier.startsWith(".") && !extname(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return next(url.href, context);
    }
    return next(specifier, context);
  },
});
after(() => loader.deregister());
const { hooks } = await import(lifecycleUrl);
const pageUrl = new URL("../src/pages/profile/index.vue", import.meta.url);
const { descriptor } = parse(readFileSync(pageUrl, "utf8"));
const compiled = compileScript(descriptor, { id: "profile-team-page" });
const source = stripTypeScriptTypes(compiled.content).replace(
  /from\s+(["'])([^"']+)\1/g,
  (_, q, specifier) => {
    const target = specifier.startsWith(".")
      ? new URL(extname(specifier) ? specifier : `${specifier}.ts`, pageUrl)
          .href
      : specifier === "@dcloudio/uni-app"
        ? specifier
        : import.meta.resolve(specifier);
    return `from ${q}${target}${q}`;
  },
);
const Page = (
  await import(`data:text/javascript,${encodeURIComponent(source)}`)
).default;

function clearHooks() {
  Object.values(hooks).forEach((list) => {
    list.length = 0;
  });
}

test("真实个人中心页：分区交接、时钟生命周期、隐藏清理与统一重置", async (t) => {
  clearHooks();
  setActivePinia(createPinia());
  const session = useSessionStore();
  const navigation = useNavigationStore();
  const timers = new Map();
  let serial = 0;
  t.mock.method(globalThis, "setInterval", (fn) => {
    timers.set(++serial, fn);
    return serial;
  });
  t.mock.method(globalThis, "clearInterval", (id) => {
    timers.delete(id);
  });
  const originalUni = globalThis.uni;
  const originalPages = globalThis.getCurrentPages;
  globalThis.uni = { switchTab() {} };
  globalThis.getCurrentPages = () => [];
  const scope = effectScope();
  const page = scope.run(() => Page.setup({}, { expose() {} }));
  try {
    hooks.load.forEach((fn) => fn({ section: "teams", keep: "x" }));
    hooks.show.forEach((fn) => fn());
    assert.equal(page.section.value, "teams");
    assert.equal(page.controller.state.section, "teams");
    assert.equal(page.routeQuery.value.keep, "x");
    assert.equal(timers.size, 1);

    page.controller.select("demo-7");
    assert.equal(page.controller.beginManage("closed"), true);
    hooks.hide.forEach((fn) => fn());
    assert.equal(timers.size, 0);
    assert.equal(page.controller.state.confirm, null);

    hooks.show.forEach((fn) => fn());
    assert.equal(timers.size, 1);
    navigation.requestProfileSection("applications");
    await nextTick();
    assert.equal(page.section.value, "applications");
    assert.equal(page.controller.state.section, "applications");
    assert.equal(page.controller.state.selectedId, "");

    page.controller.beginRespond("own-pending", "withdraw");
    session.reset();
    await nextTick();
    assert.equal(page.controller.state.confirm, null);
    assert.equal(page.controller.state.feedback, "");
  } finally {
    hooks.unload.forEach((fn) => fn());
    assert.equal(timers.size, 0);
    // 卸载后不再响应会话统一重置，避免已销毁页面写入旧状态。
    page.controller.state.feedback = "保留";
    session.reset();
    assert.equal(page.controller.state.feedback, "保留");
    scope.stop();
    globalThis.uni = originalUni;
    globalThis.getCurrentPages = originalPages;
  }
});

function installUni() {
  globalThis.uni = {
    getWindowInfo: () => ({ windowHeight: 800 }),
    onKeyboardHeightChange() {},
    onWindowResize() {},
    offWindowResize() {},
    offKeyboardHeightChange() {},
    hideTabBar() {},
    showTabBar() {},
    navigateTo() {},
    switchTab() {},
    pageScrollTo() {},
  };
  globalThis.getCurrentPages = () => [{ route: "pages/profile/index" }];
}
function removeUni() {
  delete globalThis.uni;
  delete globalThis.getCurrentPages;
}
async function mountView(file, selected) {
  setActivePinia(createPinia());
  installUni();
  const session = useSessionStore();
  const state = reactive(initialProfileTeamState());
  const controller = createProfileTeamController(state, session);
  controller.switchSection(
    file.includes("Applications") ? "applications" : "teams",
  );
  if (selected) controller.select(selected);
  const app = await mount(`../src/components/${file}.vue`, { controller });
  await nextTick();
  return { app, session, state, controller };
}
function button(app, label) {
  return app.find((n) => n.type === "button" && textOf(n).trim() === label);
}
async function click(app, label) {
  const target = button(app, label);
  assert.ok(target, `缺少按钮：${label}`);
  target.props.onClick();
  await nextTick();
}

test("队长管理视图：关闭招募后无暂停恢复入口，待处理记录失效", async () => {
  const { app, session } = await mountView("ProfileTeams", "demo-7");
  try {
    assert.match(textOf(app.container), /队长管理/);
    assert.match(textOf(app.container), /2\/5/);
    // 只有仍在邀请中的记录才提示不可确认的原因，待处理申请不显示邀请提示。
    assert.doesNotMatch(textOf(app.container), /当前邀请无法确认/);
    assert.ok(button(app, "编辑招募"));
    assert.ok(button(app, "暂停招募"));
    await click(app, "关闭招募");
    assert.match(textOf(app.container), /确认关闭招募/);
    await click(app, "确认操作");
    assert.equal(session.teams.find((t) => t.id === "demo-7").state, "closed");
    assert.equal(button(app, "暂停招募"), undefined);
    assert.equal(button(app, "恢复招募"), undefined);
    assert.match(textOf(app.container), /已失效/);
    assert.equal(
      session.records.find((a) => a.id === "incoming-1").state,
      "INVALID",
    );
  } finally {
    app.unmount();
    removeUni();
  }
});

test("普通成员视图只有退出入口，直接调用仍按角色拒绝", async () => {
  const { app, controller } = await mountView("ProfileTeams", "demo-8");
  try {
    assert.match(textOf(app.container), /成员详情/);
    assert.equal(button(app, "编辑招募"), undefined);
    assert.equal(button(app, "解散队伍"), undefined);
    assert.equal(button(app, "关闭招募"), undefined);
    assert.ok(button(app, "退出队伍"));
    assert.equal(controller.beginEdit(), false);
    assert.equal(controller.beginManage("closed"), false);
  } finally {
    app.unmount();
    removeUni();
  }
});

test("编辑招募失败保留草稿并显示字段错误，成功同步列表与详情", async () => {
  const { app, session } = await mountView("ProfileTeams", "demo-7");
  try {
    await click(app, "编辑招募");
    const title = app.find((n) => n.props.id === "profile-team-title-control");
    assert.ok(title);
    title.props.onInput({ detail: { value: "短" } });
    await nextTick();
    await click(app, "保存演示招募");
    assert.match(textOf(app.container), /标题需为 2–60 字/);
    assert.equal(
      app.find((n) => n.props.id === "profile-team-title-control").props.value,
      "短",
    );
    assert.equal(
      session.teams.find((t) => t.id === "demo-7").title,
      "植物摄影小组",
    );
    app
      .find((n) => n.props.id === "profile-team-title-control")
      .props.onInput({ detail: { value: "协作图鉴更新" } });
    await nextTick();
    await click(app, "保存演示招募");
    assert.equal(
      session.teams.find((t) => t.id === "demo-7").title,
      "协作图鉴更新",
    );
    assert.equal(
      app.find((n) => n.props.id === "profile-team-title-control"),
      undefined,
    );
    assert.match(textOf(app.container), /协作图鉴更新/);
  } finally {
    app.unmount();
    removeUni();
  }
});

test("邀请与撤销都需确认，邀请不增加成员，取消不产生变更", async () => {
  const { app, session } = await mountView("ProfileTeams", "demo-7");
  const team = () => session.teams.find((t) => t.id === "demo-7");
  const record = () => session.records.find((a) => a.id === "incoming-1");
  try {
    await click(app, "邀请");
    await click(app, "取消并关闭");
    assert.equal(record().state, "PENDING");
    await click(app, "邀请");
    await click(app, "确认操作");
    assert.equal(record().state, "INVITED");
    assert.equal(team().members.length, 2);
    assert.match(textOf(app.container), /已邀请/);
    await click(app, "撤销邀请");
    await click(app, "确认操作");
    assert.equal(record().state, "REVOKED");
    assert.match(textOf(app.container), /已撤销/);
    assert.equal(team().members.length, 2);
  } finally {
    app.unmount();
    removeUni();
  }
});

test("联系方式示例随授权与成员关系即时变化，移除后立即隐藏", async () => {
  const { app, session } = await mountView("ProfileTeams", "demo-7");
  try {
    const toggle = app.find((n) => n.props.id === "profile-team-auth-member-6");
    assert.ok(toggle);
    toggle.props.onChange({ detail: { value: true } });
    await nextTick();
    assert.equal(session.contactAuthorizations["member-6"], true);
    assert.match(textOf(app.container), /已授权可见/);
    await click(app, "移除成员");
    await click(app, "确认操作");
    assert.equal(
      session.teams.find((t) => t.id === "demo-7").members.length,
      1,
    );
    assert.equal("member-6" in session.contactAuthorizations, false);
    assert.doesNotMatch(textOf(app.container), /已授权可见/);
  } finally {
    app.unmount();
    removeUni();
  }
});

test("移交队长后同一视图降级为成员详情并失去管理入口", async () => {
  const { app, session } = await mountView("ProfileTeams", "demo-7");
  try {
    const picker = app.find(
      (n) => n.type === "picker" && n.props.id === "profile-team-successor",
    );
    assert.ok(picker);
    picker.props.onChange({ detail: { value: 1 } });
    await nextTick();
    await click(app, "移交队长");
    assert.match(textOf(app.container), /确认移交队长/);
    await click(app, "确认操作");
    assert.equal(
      session.teams
        .find((t) => t.id === "demo-7")
        .members.find((m) => m.id === "member-6").captain,
      true,
    );
    assert.match(textOf(app.container), /成员详情/);
    assert.equal(button(app, "编辑招募"), undefined);
    assert.ok(button(app, "退出队伍"));
  } finally {
    app.unmount();
    removeUni();
  }
});

test("A17 昵称与授权变更即时反映在成员行，单独重置资料保留队伍与申请", async () => {
  const { app, session } = await mountView("ProfileTeams", "demo-7");
  try {
    session.saveProfile({ ...session.profile, nickname: "新伙伴" });
    await nextTick();
    assert.match(textOf(app.container), /新伙伴 · 队长/);
    assert.doesNotMatch(textOf(app.container), /已授权可见/);
    session.contactShared = true;
    await nextTick();
    assert.match(textOf(app.container), /已授权可见/);
    session.contactShared = false;
    await nextTick();
    assert.doesNotMatch(textOf(app.container), /已授权可见/);
    session.resetProfile();
    await nextTick();
    assert.equal(session.profile.nickname, "禾小苗");
    assert.ok(
      session.teams
        .find((t) => t.id === "demo-7")
        .members.some((m) => m.id === "demo-student"),
    );
    assert.ok(session.records.length > 0);
  } finally {
    app.unmount();
    removeUni();
  }
});

test("申请与邀请视图：确认入队只增员一次，满员时保留原因且不加人", async () => {
  const { app, session } = await mountView("ProfileApplications", null);
  const team = () => session.teams.find((t) => t.id === "demo-2");
  try {
    assert.match(textOf(app.container), /已邀请/);
    await click(app, "确认入队");
    await click(app, "确认操作");
    assert.equal(team().members.length, 3);
    assert.equal(
      session.records.find((a) => a.id === "history-0").state,
      "ACCEPTED",
    );
    assert.match(textOf(app.container), /已入队/);
    assert.equal(button(app, "确认入队"), undefined);
  } finally {
    app.unmount();
    removeUni();
  }
});

test("申请与邀请视图：满员时入口不可用并显示原因", async () => {
  const { app, session } = await mountView("ProfileApplications", null);
  try {
    const team = session.teams.find((t) => t.id === "demo-2");
    team.capacity = team.members.length;
    await nextTick();
    assert.match(textOf(app.container), /已满员/);
    const accept = button(app, "确认入队");
    assert.ok(accept);
    accept.props.onClick();
    await nextTick();
    // 现场校验失败时不打开确认弹层，只保留原因说明。
    assert.equal(
      app.find((n) => n.props.role === "dialog"),
      undefined,
    );
    assert.equal(team.members.length, 2);
  } finally {
    app.unmount();
    removeUni();
  }
});
