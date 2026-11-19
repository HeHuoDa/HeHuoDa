import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { extname } from "node:path";
import { createPinia, setActivePinia } from "pinia";
import { effectScope, nextTick } from "vue";
import { compileScript, parse } from "vue/compiler-sfc";
import { useNavigationStore } from "../src/stores/navigation.ts";
import { resolveSourceAddress } from "../src/navigation/routes.ts";
import { useSessionStore } from "../src/stores/session.ts";

/**
 * 个人中心导航：M1 只保留资料区，旧分区地址安全落到资料区并显示暂缓说明。
 * 执行真实页面 setup，仅替换平台生命周期与不渲染的子组件。
 */
const lifecycleUrl = `data:text/javascript,${encodeURIComponent(`
  export const hooks = { load: [], show: [], hide: [], unload: [] };
  export const onLoad = callback => hooks.load.push(callback);
  export const onShow = callback => hooks.show.push(callback);
  export const onHide = callback => hooks.hide.push(callback);
  export const onUnload = callback => hooks.unload.push(callback);
`)}`;
const { hooks } = await import(lifecycleUrl);
const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@dcloudio/uni-app")
      return { url: lifecycleUrl, shortCircuit: true };
    if (specifier.endsWith(".vue"))
      return {
        url: "data:text/javascript,export default {}",
        shortCircuit: true,
      };
    if (specifier.startsWith(".") && !extname(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return nextResolve(url.href, context);
    }
    return nextResolve(specifier, context);
  },
});
after(() => loader.deregister());
const pageUrl = new URL("../src/pages/profile/index.vue", import.meta.url);
const { descriptor } = parse(readFileSync(pageUrl, "utf8"));
const compiled = compileScript(descriptor, { id: "profile-navigation-test" });
const source = stripTypeScriptTypes(compiled.content).replace(
  /from\s+(["'])([^"']+)\1/g,
  (_, quote, specifier) => {
    const url = specifier.startsWith(".")
      ? new URL(extname(specifier) ? specifier : `${specifier}.ts`, pageUrl)
          .href
      : specifier === "@dcloudio/uni-app"
        ? specifier
        : import.meta.resolve(specifier);
    return `from ${quote}${url}${quote}`;
  },
);
const { default: Profile } = await import(
  `data:text/javascript,${encodeURIComponent(source)}`
);
const {
  openProfileSection,
  backOrHome,
  openTab,
  returnToCompetitions,
  withQuery,
} = await import("../src/navigation/navigate.ts");

afterEach(() => {
  delete globalThis.uni;
  delete globalThis.getCurrentPages;
});

function mountProfile(query = {}) {
  hooks.load.length = 0;
  hooks.show.length = 0;
  hooks.hide.length = 0;
  hooks.unload.length = 0;
  const scope = effectScope();
  const page = scope.run(() => Profile.setup({}, { expose() {} }));
  hooks.load.forEach((callback) => callback(query));
  hooks.show.forEach((callback) => callback());
  return {
    page,
    stop: () => {
      hooks.hide.forEach((callback) => callback());
      hooks.unload.forEach((callback) => callback());
      scope.stop();
    },
  };
}

test("重置后的迟到导航失败不重新跳转或清除新会话定位", () => {
  setActivePinia(createPinia());
  const session = useSessionStore();
  const navigation = useNavigationStore();
  const requests = [];
  let relaunches = 0,
    failures = 0;
  globalThis.uni = {
    switchTab: (options) => requests.push(options),
    reLaunch: () => relaunches++,
  };
  openProfileSection(
    "applications",
    { recordId: "history-0" },
    () => failures++,
  );
  session.reset();
  navigation.requestProfileSection("teams", { teamId: "demo-1" });
  requests[0].fail();
  assert.equal(relaunches, 0);
  assert.equal(failures, 0);
  assert.equal(navigation.pendingProfileNavigation.query.teamId, "demo-1");
});

test("重置后的迟到 tab 成功回调不恢复旧地址意图", () => {
  setActivePinia(createPinia());
  const session = useSessionStore();
  const requests = [];
  let completed = 0;
  globalThis.uni = { switchTab: (options) => requests.push(options) };
  openTab("teams", undefined, () => completed++);
  session.reset();
  requests[0].success();
  assert.equal(completed, 0);
});

test("比赛返回复用首页栈，空栈交接筛选；交接只消费一次", () => {
  setActivePinia(createPinia());
  const calls = [];
  globalThis.uni = {
    switchTab: ({ url }) => calls.push(url),
    navigateBack: () => calls.push("back"),
  };
  globalThis.getCurrentPages = () => [{ route: "pages/index/index" }, {}];
  returnToCompetitions({ hosts: "all", q: "创新", page: "2" });
  assert.deepEqual(calls, ["back"]);
  globalThis.getCurrentPages = () => [{}];
  returnToCompetitions({ hosts: "", q: "创新", page: "2" });
  const navigation = useNavigationStore();
  assert.deepEqual(navigation.consumeTabQuery("home"), {
    hosts: "",
    q: "创新",
    page: "2",
  });
  assert.equal(navigation.consumeTabQuery("home"), null);
  assert.equal(
    withQuery("/detail", { hosts: "", id: "a" }),
    "/detail?hosts=&id=a",
  );
});

test("个人中心加载直接显示资料区，不再恢复演示队伍或申请分区", () => {
  setActivePinia(createPinia());
  globalThis.uni = { switchTab() {} };
  const mounted = mountProfile();
  try {
    assert.equal(mounted.page.pending.value, "");
  } finally {
    mounted.stop();
  }
});

test("旧 /my/teams、/my/applications 地址落到资料区并说明暂缓", () => {
  setActivePinia(createPinia());
  globalThis.uni = { switchTab() {} };
  for (const [path, label] of [
    ["/my/teams", "我的队伍"],
    ["/my/applications", "申请与邀请"],
  ]) {
    const resolved = resolveSourceAddress(path, { keep: "x" });
    assert.equal(resolved.name, "profile");
    assert.equal(
      resolved.section,
      label === "我的队伍" ? "teams" : "applications",
    );
    const mounted = mountProfile({
      ...resolved.query,
      section: resolved.section,
    });
    try {
      assert.equal(mounted.page.pending.value, label);
      assert.equal(mounted.page.legacySection.value, resolved.section);
    } finally {
      mounted.stop();
    }
  }
  // 未知分区参数回落到资料区，不显示遗留提示。
  const bogus = mountProfile({ section: "bogus" });
  try {
    assert.equal(bogus.page.pending.value, "");
  } finally {
    bogus.stop();
  }
});

test("可控平台分支：主导航失败回退，无历史回首页，有历史正常返回", () => {
  const calls = [];
  globalThis.uni = {
    switchTab: ({ url, fail }) => {
      calls.push(["switchTab", url]);
      fail();
    },
    reLaunch: ({ url }) => calls.push(["reLaunch", url]),
    navigateBack: ({ delta }) => calls.push(["navigateBack", delta]),
  };
  openTab("teams");
  globalThis.getCurrentPages = () => [{}];
  backOrHome();
  globalThis.getCurrentPages = () => [{}, {}];
  backOrHome();
  assert.deepEqual(calls, [
    ["switchTab", "/pages/teams/index"],
    ["reLaunch", "/pages/teams/index"],
    ["switchTab", "/pages/index/index"],
    ["reLaunch", "/pages/index/index"],
    ["navigateBack", 1],
  ]);
});

test("已位于个人中心时交接个人资料分区不会重复 switchTab", async () => {
  setActivePinia(createPinia());
  let switches = 0;
  globalThis.getCurrentPages = () => [{ route: "pages/profile/index" }];
  globalThis.uni = { switchTab: () => switches++ };
  const mounted = mountProfile();
  try {
    openProfileSection("teams", { teamId: "demo-7" });
    await nextTick();
    openProfileSection("profile");
    await nextTick();
    assert.equal(switches, 0);
    assert.equal(useNavigationStore().pendingProfileNavigation, null);
  } finally {
    mounted.stop();
  }
});
