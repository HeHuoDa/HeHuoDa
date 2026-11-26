import assert from "node:assert/strict";
import { after, test } from "node:test";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { mount, textOf } from "./component-host.mjs";
import { useSessionStore } from "../src/stores/session.ts";

/**
 * 找队友主 Tab 与旧发布/详情直达页在 M1 只显示暂缓说明：
 * 不渲染演示队伍、表单、申请/邀请与重置示例；可回首页并保留收藏入口。
 */
const loader = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && !extname(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return next(url.href, context);
    }
    return next(specifier, context);
  },
});
after(() => loader.deregister());

function platform() {
  const calls = [];
  globalThis.uni = {
    switchTab: (options) => {
      calls.push(["switchTab", options.url]);
      options.success?.();
    },
    reLaunch: (options) => calls.push(["reLaunch", options.url]),
    navigateTo: (options) => {
      calls.push(["navigateTo", options.url]);
      options.success?.();
    },
  };
  globalThis.getCurrentPages = () => [{}];
  setActivePinia(createPinia());
  return calls;
}

function button(page, label) {
  return page.find(
    (n) =>
      (n.type === "button" || n.props.role === "button") &&
      textOf(n).includes(label),
  );
}

for (const [file, label] of [
  ["../src/pages/teams/index.vue", "找队友主 Tab"],
  ["../src/pages/teams/new.vue", "旧发布招募直达页"],
  ["../src/pages/teams/detail.vue", "旧队伍详情直达页"],
]) {
  for (const target of ["H5", "MP-WEIXIN", "APP-PLUS"]) {
    test(`${label} ${target} 只说明暂缓，无展示队伍、表单与演示写操作`, async () => {
      const calls = platform();
      const session = useSessionStore();
      const page = await mount(file, {}, target);
      try {
        const text = textOf(page.container);
        assert.match(text, /暂缓|暂未开放/);
        assert.match(
          text,
          /当前版本先开放正式比赛信息浏览|只开放正式比赛信息浏览/,
        );
        assert.match(text, /仅|只在本次会话|当前会话/);
        for (const gone of [
          "发布招募",
          "演示",
          "重置示例",
          "招募截止",
          "队伍成员",
          "提交申请",
        ])
          assert.doesNotMatch(text, new RegExp(gone), gone);
        for (const node of [
          page.find((n) => n.type === "input"),
          page.find((n) => n.type === "textarea"),
          page.find((n) => n.type === "picker"),
          page.find((n) => n.props.role === "dialog"),
        ])
          assert.equal(node, undefined);
        // 不读取演示会话：暂缓页与演示队伍、申请无任何绑定。
        session.addFavorite("competition-a");
        await nextTick();
        assert.doesNotMatch(textOf(page.container), /competition-a/);
        assert.ok(button(page, "回首页浏览比赛"));
        assert.ok(button(page, "查看我的收藏"));
        button(page, "回首页浏览比赛").props.onClick();
        await nextTick();
        assert.deepEqual(calls.at(-1), ["switchTab", "/pages/index/index"]);
        button(page, "查看我的收藏").props.onClick();
        await nextTick();
        assert.deepEqual(calls.at(-1), ["navigateTo", "/pages/my/favorites"]);
      } finally {
        page.unmount();
        delete globalThis.uni;
        delete globalThis.getCurrentPages;
      }
    });
  }
}

for (const target of ["H5", "APP-PLUS"]) {
  test(`暂缓页 ${target} 在主导航失败时给出可重试提示，不静默失败`, async () => {
    globalThis.uni = {
      switchTab: (options) => options.fail?.(),
      reLaunch: (options) => options.fail?.(),
    };
    globalThis.getCurrentPages = () => [{}];
    setActivePinia(createPinia());
    const page = await mount("../src/pages/teams/index.vue", {}, target);
    try {
      button(page, "回首页浏览比赛").props.onClick();
      await new Promise((resolve) => setImmediate(resolve));
      await nextTick();
      assert.match(textOf(page.container), /暂时无法回到首页/);
    } finally {
      page.unmount();
      delete globalThis.uni;
      delete globalThis.getCurrentPages;
    }
  });
}
