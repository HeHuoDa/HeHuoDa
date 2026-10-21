import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { after, test } from "node:test";
import { nextTick } from "vue";
import { mount, textOf } from "./component-host.mjs";

// 仅核准环境配置用替身；页面、策略、导航和剪贴板包装器均运行真实源码。
const config = `data:text/javascript,export const approvedWebViewHosts = Object.freeze(['news.example.edu.cn']);`;
const loader = registerHooks({
  resolve(name, context, next) {
    if (
      name.endsWith("/config.ts") &&
      context.parentURL?.endsWith("/source/policy.ts")
    )
      return { url: config, shortCircuit: true };
    if (name.startsWith(".") && !extname(name)) {
      const url = new URL(`${name}.ts`, context.parentURL);
      if (existsSync(url)) return next(url.href, context);
    }
    return next(name, context);
  },
});
after(() => loader.deregister());

test("核准地址进入真实 web-view；加载失效后卸载控件并复制，不重开失败原文", async () => {
  const original = globalThis.uni,
    oldHooks = globalThis.__pageLoadHooks;
  globalThis.__pageLoadHooks = [];
  const navigations = [],
    copies = [];
  globalThis.uni = {
    navigateTo: (options) => {
      navigations.push(options.url);
      options.success();
    },
    setClipboardData: (options) => {
      copies.push(options.data);
      options.success();
    },
  };
  const app = await mount("../src/pages/source/index.vue");
  try {
    globalThis.__pageLoadHooks[0]({
      url: "https://news.example.edu.cn/a",
      title: "通知",
    });
    await nextTick();
    const webview = app.find((node) => node.type === "web-view");
    assert.equal(webview.props.src, "https://news.example.edu.cn/a");
    webview.props.onError({ detail: { errMsg: "domain invalid" } });
    await nextTick();
    assert.equal(
      app.find((node) => node.type === "web-view"),
      undefined,
    );
    assert.match(textOf(app.container), /加载失败/);
    app.find((node) => node.type === "button").props.onClick();
    await new Promise((r) => setImmediate(r));
    await nextTick();
    assert.deepEqual(navigations, []);
    assert.deepEqual(copies, ["https://news.example.edu.cn/a"]);
  } finally {
    app.unmount();
    globalThis.uni = original;
    globalThis.__pageLoadHooks = oldHooks;
  }
});
