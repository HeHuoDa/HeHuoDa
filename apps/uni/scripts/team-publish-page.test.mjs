import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { extname } from "node:path";
import { after, test } from "node:test";
import { effectScope, nextTick } from "vue";
import { compileScript, parse } from "vue/compiler-sfc";
import { createPinia, setActivePinia } from "pinia";
import { useSessionStore } from "../src/stores/session.ts";
import { mount, textOf } from "./component-host.mjs";

// 运行真实页面 setup；仅替换平台生命周期与不渲染的子组件。
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
const pageUrl = new URL("../src/pages/teams/new.vue", import.meta.url);
const { descriptor } = parse(readFileSync(pageUrl, "utf8"));
const compiled = compileScript(descriptor, { id: "team-publish-page" });
const source = stripTypeScriptTypes(compiled.content).replace(
  /from\s+(["'])([^"']+)\1/g,
  (_, q, name) => {
    const target = name.startsWith(".")
      ? new URL(extname(name) ? name : `${name}.ts`, pageUrl).href
      : name === "@dcloudio/uni-app"
        ? name
        : import.meta.resolve(name);
    return `from ${q}${target}${q}`;
  },
);
const Page = (
  await import(`data:text/javascript,${encodeURIComponent(source)}`)
).default;

test("发布页首错定位、草稿保留、成功跳转携带筛选、防重、会话重置与卸载清理", async () => {
  Object.values(hooks).forEach((list) => {
    list.length = 0;
  });
  setActivePinia(createPinia());
  const session = useSessionStore();
  const originalUni = globalThis.uni;
  const calls = [];
  globalThis.uni = {
    pageScrollTo: (v) => calls.push(v),
    redirectTo: (v) => calls.push(v),
  };
  const scope = effectScope();
  const page = scope.run(() => Page.setup({}, { expose() {} }));
  try {
    hooks.load.forEach((fn) => fn({ q: "植物", page: "2" }));
    await page.submit();
    assert.equal(page.focusField.value, "type");
    assert.equal(calls.at(-1).selector, "#publish-type");
    page.state.draft.title = "保留草稿";
    await page.submit();
    assert.equal(page.state.draft.title, "保留草稿");
    page.toggleRole("编程");
    page.toggleRole("设计");
    page.toggleRole("编程");
    assert.deepEqual(page.state.draft.roles, ["设计"]);
    Object.assign(page.state.draft, {
      type: "course",
      goal: "这是一个用于验收的课程项目。",
      mode: "online",
      deadline: "2099-12-20T18:30",
    });
    await Promise.all([page.submit(), page.submit()]);
    assert.equal(session.teams.length, 9);
    assert.match(
      calls.find((c) => c.url)?.url,
      /\/pages\/teams\/detail\?q=%E6%A4%8D%E7%89%A9&page=2&id=session-1/,
    );
    assert.equal(page.state.publishedId, "session-1");
    session.reset();
    assert.equal(page.state.draft.title, "");
    assert.equal(page.state.publishedId, "");
    assert.equal(session.teams.length, 8);
    hooks.unload.forEach((fn) => fn());
    page.state.draft.title = "已离开页面";
    session.reset();
    assert.equal(page.state.draft.title, "已离开页面");
  } finally {
    scope.stop();
    globalThis.uni = originalUni;
  }
});

test("我的队伍真实组件从单一会话派生数量；发布、人数变化与重置即时同步", async () => {
  setActivePinia(createPinia());
  const session = useSessionStore();
  const originalUni = globalThis.uni;
  const urls = [];
  globalThis.uni = { navigateTo: (v) => urls.push(v.url) };
  const app = await mount("../src/components/ProfileTeamsReadOnly.vue");
  try {
    assert.match(textOf(app.container), /共 2 支 · 带领 1 支 · 加入 1 支/);
    assert.doesNotMatch(textOf(app.container), /发布招募|重置会话演示/);
    const team = session.publish({
      title: "只读列表验收",
      type: "other",
      goal: "可在列表、详情和我的队伍读取相同数据。",
      roles: ["调研"],
      mode: "online",
      location: "",
      progress: "",
      skills: "",
      capacity: "2",
      deadline: "2099-12-20T18:30",
      trackId: "",
    });
    await nextTick();
    assert.match(textOf(app.container), /共 3 支 · 带领 2 支 · 加入 1 支/);
    assert.match(textOf(app.container), /1\/2 人/);
    const card = app.find(
      (n) => n.type === "view" && n.props.class === "hhr-panel team-card",
    );
    function button(node) {
      return node.type === "button"
        ? node
        : node.children.map(button).find(Boolean);
    }
    button(card).props.onClick();
    assert.equal(urls[0], `/pages/teams/detail?id=${team.id}`);
    session.teams
      .find((value) => value.id === team.id)
      .members.push({
        id: "another",
        nickname: "成员",
        role: "调研",
        captain: false,
      });
    await nextTick();
    assert.match(textOf(app.container), /2\/2 人/);
    session.reset();
    await nextTick();
    assert.doesNotMatch(textOf(app.container), /只读列表验收/);
    session.teams = [];
    await nextTick();
    assert.match(textOf(app.container), /暂时没有加入或带领的队伍/);
  } finally {
    app.unmount();
    globalThis.uni = originalUni;
  }
});
