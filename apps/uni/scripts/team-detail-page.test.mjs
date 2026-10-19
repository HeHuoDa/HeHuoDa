import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { extname } from "node:path";
import { after, test } from "node:test";
import { effectScope, nextTick } from "vue";
import { compileScript, parse } from "vue/compiler-sfc";
import { createPinia, setActivePinia } from "pinia";
import { useSessionStore } from "../src/stores/session.ts";
import { useNavigationStore } from "../src/stores/navigation.ts";

// Compile the real page; only platform lifecycle and non-rendered child imports
// are substitutes. Browser rendering and real controls are verified separately.
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
const pageUrl = new URL("../src/pages/teams/detail.vue", import.meta.url);
const { descriptor } = parse(readFileSync(pageUrl, "utf8"));
const compiled = compileScript(descriptor, { id: "team-detail-page" });
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

test("真实详情页按 ID 读取共享状态，隐藏清草稿和时钟，返回交接原筛选", async (t) => {
  Object.values(hooks).forEach((list) => {
    list.length = 0;
  });
  setActivePinia(createPinia());
  const session = useSessionStore();
  const navigation = useNavigationStore();
  const originalUni = globalThis.uni;
  const originalPages = globalThis.getCurrentPages;
  const timers = new Map();
  let serial = 0;
  t.mock.method(globalThis, "setInterval", (fn) => {
    timers.set(++serial, fn);
    return serial;
  });
  t.mock.method(globalThis, "clearInterval", (id) => {
    timers.delete(id);
  });
  globalThis.uni = { switchTab() {} };
  globalThis.getCurrentPages = () => [];
  const scope = effectScope();
  const page = scope.run(() => Page.setup({}, { expose() {} }));
  try {
    hooks.load.forEach((fn) =>
      fn({ id: "demo-2", q: "课程", type: "course", page: "2" }),
    );
    hooks.show.forEach((fn) => fn());
    hooks.show.forEach((fn) => fn());
    assert.equal(timers.size, 1);
    assert.equal(page.team.value, session.teams[1]);
    page.controller.begin("accept");
    page.controller.submit();
    assert.equal(page.team.value.members.length, 3);
    assert.equal(session.teams[1].members.length, 3);
    page.controller.begin("report");
    page.state.note = "未提交草稿";
    hooks.hide.forEach((fn) => fn());
    assert.equal(timers.size, 0);
    assert.equal(page.state.action, null);
    assert.equal(page.state.note, "");
    hooks.show.forEach((fn) => fn());
    assert.equal(timers.size, 1);
    page.returnToList();
    assert.deepEqual(navigation.consumeTabQuery("teams"), {
      q: "课程",
      type: "course",
      page: "2",
    });
    session.teams[1].dissolved = true;
    await nextTick();
    assert.equal(page.team.value, undefined);
    hooks.load.forEach((fn) => fn({ id: "demo-1,demo-2" }));
    assert.ok(page.parameterError.value);
    assert.equal(page.team.value, undefined);
    hooks.load.forEach((fn) => fn({ id: "session-no-longer-present" }));
    assert.equal(page.parameterError.value, "");
    assert.equal(page.team.value, undefined);
  } finally {
    hooks.unload.forEach((fn) => fn());
    assert.equal(timers.size, 0);
    scope.stop();
    globalThis.uni = originalUni;
    globalThis.getCurrentPages = originalPages;
  }
});
