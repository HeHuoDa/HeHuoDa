import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  createRequire,
  registerHooks,
  stripTypeScriptTypes,
} from "node:module";
import { extname } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { createPinia, setActivePinia } from "pinia";
import { effectScope, nextTick } from "vue";
import { compileScript, parse } from "vue/compiler-sfc";
import { useNavigationStore } from "../src/stores/navigation.ts";
import { resolveSourceAddress } from "../src/navigation/routes.ts";

// 执行真实页面 setup，再按平台顺序触发生命周期；子组件不参与导航状态测试。
const lifecycleUrl = `data:text/javascript,${encodeURIComponent(`
  export const hooks = { load: [], show: [] };
  export const onLoad = callback => hooks.load.push(callback);
  export const onShow = callback => hooks.show.push(callback);
`)}`;
const { hooks } = await import(lifecycleUrl);
const require = createRequire(import.meta.url);
const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@dcloudio/uni-app") {
      return { url: lifecycleUrl, shortCircuit: true };
    }
    if (specifier.endsWith(".vue")) {
      return {
        url: "data:text/javascript,export default {}",
        shortCircuit: true,
      };
    }
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
      : specifier === "vue"
        ? pathToFileURL(require.resolve("vue")).href
        : specifier;
    return `from ${quote}${url}${quote}`;
  },
);
const { default: Profile } = await import(
  `data:text/javascript,${encodeURIComponent(source)}`
);
const { openProfileSection, backOrHome, openTab } =
  await import("../src/navigation/navigate.ts");

function mountProfile(query = {}) {
  hooks.load.length = 0;
  hooks.show.length = 0;
  const scope = effectScope();
  const page = scope.run(() => Profile.setup({}, { expose() {} }));
  hooks.load.forEach((callback) => callback(query));
  hooks.show.forEach((callback) => callback());
  return { page, stop: () => scope.stop() };
}

test("首次进入个人中心：页面加载不会覆盖交接分区，意图只消费一次", () => {
  setActivePinia(createPinia());
  useNavigationStore().requestProfileSection("teams");
  const first = mountProfile();
  try {
    assert.equal(first.page.current.value.title, "我的队伍");
  } finally {
    first.stop();
  }
  const second = mountProfile();
  try {
    assert.equal(second.page.current.value.title, "个人中心");
  } finally {
    second.stop();
  }
});

test("停留在个人中心时可再次切分区，非法深链仍显示反馈", async () => {
  setActivePinia(createPinia());
  const mounted = mountProfile({ section: "bogus" });
  try {
    assert.match(mounted.page.notice.value, /分区参数无效/);
    useNavigationStore().requestProfileSection("applications");
    await nextTick();
    assert.equal(mounted.page.current.value.title, "申请与邀请");
    assert.equal(mounted.page.notice.value, "");
  } finally {
    mounted.stop();
  }
});

test("旧地址映射经主导航交接到页面时保留附加参数，再次同分区也能更新", async () => {
  const previousUni = globalThis.uni;
  globalThis.uni = {
    switchTab: ({ url }) => assert.equal(url, "/pages/profile/index"),
  };
  try {
    for (const path of ["/my/teams", "/my/applications"]) {
      setActivePinia(createPinia());
      const resolved = resolveSourceAddress(path, {
        section: "bogus",
        keep: "x",
        page: "2",
        tag: ["a", "b"],
        nested: { ignored: true },
      });
      openProfileSection(resolved.section, resolved.query);
      resolved.query.tag.push("changed-after-dispatch");
      const mounted = mountProfile();
      try {
        assert.equal(mounted.page.section.value, resolved.section);
        assert.deepEqual(mounted.page.routeQuery.value, {
          keep: "x",
          page: "2",
          tag: ["a", "b"],
        });
        openProfileSection(resolved.section, { page: "3" });
        await nextTick();
        assert.deepEqual(mounted.page.routeQuery.value, { page: "3" });
      } finally {
        mounted.stop();
      }
      const next = mountProfile();
      try {
        assert.deepEqual(next.page.routeQuery.value, {});
      } finally {
        next.stop();
      }
    }
  } finally {
    if (previousUni === undefined) delete globalThis.uni;
    else globalThis.uni = previousUni;
  }
});

test("直接进入个人中心保留附加参数，冲突分区仍反馈错误", () => {
  setActivePinia(createPinia());
  const mounted = mountProfile({ section: "teams,applications", keep: "x" });
  try {
    assert.equal(mounted.page.current.value.title, "个人中心");
    assert.deepEqual(mounted.page.routeQuery.value, { keep: "x" });
    assert.match(mounted.page.notice.value, /分区参数重复/);
  } finally {
    mounted.stop();
  }
});

test("可控平台分支：主导航失败回退，无历史回首页，有历史正常返回", () => {
  const previousUni = globalThis.uni;
  const previousPages = globalThis.getCurrentPages;
  const calls = [];
  globalThis.uni = {
    switchTab: ({ url, fail }) => {
      calls.push(["switchTab", url]);
      fail();
    },
    reLaunch: ({ url }) => calls.push(["reLaunch", url]),
    navigateBack: ({ delta }) => calls.push(["navigateBack", delta]),
  };
  try {
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
  } finally {
    if (previousUni === undefined) delete globalThis.uni;
    else globalThis.uni = previousUni;
    if (previousPages === undefined) delete globalThis.getCurrentPages;
    else globalThis.getCurrentPages = previousPages;
  }
});
