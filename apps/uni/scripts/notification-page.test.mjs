import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { extname } from "node:path";
import { after, test } from "node:test";
import { effectScope } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { compileScript, parse } from "vue/compiler-sfc";
import { useSessionStore } from "../src/stores/session.ts";
import { useNavigationStore } from "../src/stores/navigation.ts";

const lifecycle = `data:text/javascript,${encodeURIComponent(`
  export const hooks = { show: [], hide: [], unload: [] };
  export const onShow = fn => hooks.show.push(fn);
  export const onHide = fn => hooks.hide.push(fn);
  export const onUnload = fn => hooks.unload.push(fn);
`)}`;
const { hooks } = await import(lifecycle);
const loader = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@dcloudio/uni-app")
      return { url: lifecycle, shortCircuit: true };
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
const pageUrl = new URL(
  "../src/pages/notifications/index.vue",
  import.meta.url,
);
const { descriptor } = parse(readFileSync(pageUrl, "utf8"));
const compiled = compileScript(descriptor, { id: "notification-page" });
const source = stripTypeScriptTypes(compiled.content).replace(
  /from\s+(["'])([^"']+)\1/g,
  (_, quote, specifier) => {
    const target = specifier.startsWith(".")
      ? new URL(extname(specifier) ? specifier : `${specifier}.ts`, pageUrl)
          .href
      : specifier === "@dcloudio/uni-app"
        ? specifier
        : import.meta.resolve(specifier);
    return `from ${quote}${target}${quote}`;
  },
);
const Page = (
  await import(`data:text/javascript,${encodeURIComponent(source)}`)
).default;

test("真实通知页前台时钟幂等/停止，跳转双重权限检查与导航失败反馈", () => {
  setActivePinia(createPinia());
  const session = useSessionStore();
  const timers = new Map();
  const original = {
    uni: globalThis.uni,
    set: globalThis.setInterval,
    clear: globalThis.clearInterval,
  };
  const calls = [];
  globalThis.setInterval = (fn) => {
    const id = timers.size + 1;
    timers.set(id, fn);
    return id;
  };
  globalThis.clearInterval = (id) => timers.delete(id);
  globalThis.uni = { switchTab: ({ url }) => calls.push(url) };
  const scope = effectScope();
  try {
    const page = scope.run(() => Page.setup({}, { expose() {} }));
    hooks.show.forEach((fn) => fn());
    hooks.show.forEach((fn) => fn());
    assert.equal(timers.size, 1);
    session.manage("demo-8", "leave");
    const exited = session.notifications.at(-1);
    const unread = session.unreadNotificationCount;
    page.open(exited);
    assert.equal(calls.length, 0);
    assert.match(page.feedback.value, /成员/);
    assert.equal(session.unreadNotificationCount, unread);
    // 用实际确认入队动作生成可跳转的成员进展。
    const record = session.records.find((r) => r.id === "history-0");
    const team = session.teams.find((t) => t.id === record.teamId);
    team.state = "open";
    team.capacity = 20;
    team.roles = [record.role];
    team.deadline = "2099-01-01T00:00:00Z";
    session.respond(record.id, "accept");
    const joined = session.notifications.at(-1);
    page.open(joined);
    assert.deepEqual(calls, ["/pages/profile/index"]);
    assert.equal(
      useNavigationStore().consumeProfileNavigation().query.teamId,
      team.id,
    );
    globalThis.uni = {
      switchTab: ({ fail }) => fail(),
      reLaunch: ({ fail }) => fail(),
    };
    page.open(joined);
    assert.match(page.feedback.value, /暂时无法打开/);
    assert.equal(useNavigationStore().pendingProfileNavigation, null);
    hooks.hide.forEach((fn) => fn());
    assert.equal(timers.size, 0);
    hooks.show.forEach((fn) => fn());
    assert.equal(timers.size, 1);
    hooks.unload.forEach((fn) => fn());
    assert.equal(timers.size, 0);
    session.reset();
    page.open(joined);
    assert.match(page.feedback.value, /重置/);
  } finally {
    scope.stop();
    globalThis.uni = original.uni;
    globalThis.setInterval = original.set;
    globalThis.clearInterval = original.clear;
  }
});
