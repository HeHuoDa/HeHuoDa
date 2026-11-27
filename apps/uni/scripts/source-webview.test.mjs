import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { after, test } from "node:test";
import { nextTick } from "vue";
import { mount, textOf } from "./component-host.mjs";

// 页面、策略、导航与剪贴板包装器均运行真实源码。
const loader = registerHooks({
  resolve(name, context, next) {
    if (name.startsWith(".") && !extname(name)) {
      const url = new URL(`${name}.ts`, context.parentURL);
      if (existsSync(url)) return next(url.href, context);
    }
    return next(name, context);
  },
});
after(() => loader.deregister());

test("旧核准域名直达地址落到可操作回退：不再加载 web-view，只保留复制与系统浏览器路径", async () => {
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
  const app = await mount("../src/pages/source/index.vue", {}, "APP-PLUS");
  try {
    globalThis.__pageLoadHooks[0]({
      url: "https://news.example.edu.cn/a",
      title: "通知",
    });
    await nextTick();
    // web-view 内嵌承载已按 ADR 0011 退役：页面必须没有任何 web-view 节点。
    assert.equal(
      app.find((node) => node.type === "web-view"),
      undefined,
    );
    assert.match(textOf(app.container), /不在应用内嵌入打开/);
    app
      .find(
        (node) =>
          (node.type === "button" || node.props.role === "button") &&
          textOf(node).includes("复制官方链接"),
      )
      .props.onClick();
    await new Promise((r) => setImmediate(r));
    await nextTick();
    // 直达页自身只提供复制，不再向下一个承载页跳转。
    assert.deepEqual(navigations, []);
    assert.deepEqual(copies, ["https://news.example.edu.cn/a"]);
  } finally {
    app.unmount();
    globalThis.uni = original;
    globalThis.__pageLoadHooks = oldHooks;
  }
});
