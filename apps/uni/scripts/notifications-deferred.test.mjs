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
 * 站内通知依赖真实的组队进展与平台投递，两者随组队一并暂缓（ADR 0011 方案 B）。
 * M1 页面只说明开放范围，不再展示会话内演示通知，也不提供标记已读等伪交互。
 */
const loader = registerHooks({
  resolve(specifier, context, next) {
    if (
      specifier === "@dcloudio/uni-app" ||
      specifier.endsWith("/lifecycle/use-page-lifecycle")
    )
      return {
        url: `data:text/javascript,${encodeURIComponent("export const usePageLifecycle = () => {};")}`,
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

function platform() {
  const calls = [];
  globalThis.uni = {
    switchTab: (options) => {
      calls.push(["switchTab", options.url]);
      options.success?.();
    },
    reLaunch: (options) => calls.push(["reLaunch", options.url]),
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

for (const target of ["H5", "MP-WEIXIN"]) {
  test(`站内通知页 ${target} 只说明暂缓，不展示演示通知与已读交互`, async () => {
    const calls = platform();
    const session = useSessionStore();
    const page = await mount(
      "../src/pages/notifications/index.vue",
      {},
      target,
    );
    try {
      const text = textOf(page.container);
      assert.match(text, /暂缓开放/);
      assert.match(text, /当前版本先开放正式比赛信息浏览/);
      assert.match(text, /组队进展|平台投递/);
      assert.match(text, /只在本次会话内保留|本次会话/);
      for (const gone of [
        "全部已读",
        "标为已读",
        "阅读全文",
        "查看关联记录",
        "未读",
        "当前会话演示",
        "全部类型",
      ])
        assert.doesNotMatch(text, new RegExp(gone), gone);
      // 演示通知不会渲染到页面上，即使会话里仍有种子数据。
      for (const item of session.notifications)
        assert.doesNotMatch(text, new RegExp(item.title), item.title);
      assert.equal(
        page.find((n) => n.props["data-notification"] !== undefined),
        undefined,
      );
      assert.ok(button(page, "回首页浏览比赛"));
      assert.ok(button(page, "返回个人中心"));
      button(page, "返回个人中心").props.onClick();
      await nextTick();
      assert.deepEqual(calls.at(-1), ["switchTab", "/pages/profile/index"]);
      button(page, "回首页浏览比赛").props.onClick();
      await nextTick();
      assert.deepEqual(calls.at(-1), ["switchTab", "/pages/index/index"]);
    } finally {
      page.unmount();
      delete globalThis.uni;
      delete globalThis.getCurrentPages;
    }
  });
}

test("站内通知暂缓页在主导航失败时给出可重试提示", async () => {
  globalThis.uni = {
    switchTab: (options) => options.fail?.(),
    reLaunch: (options) => options.fail?.(),
  };
  globalThis.getCurrentPages = () => [{}];
  setActivePinia(createPinia());
  const page = await mount("../src/pages/notifications/index.vue", {}, "H5");
  try {
    button(page, "返回个人中心").props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    await nextTick();
    assert.match(textOf(page.container), /暂时无法回到个人中心/);
  } finally {
    page.unmount();
    delete globalThis.uni;
    delete globalThis.getCurrentPages;
  }
});
