import assert from "node:assert/strict";
import { after, test } from "node:test";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { mount, textOf } from "./component-host.mjs";

/**
 * 统一身份认证页在 M1 只做说明：两端都不渲染表单、不读取凭据、
 * 不发送认证请求。真实认证由 M2（#221）接入。
 */
const clientSource = `import {createHttpClient} from './http.ts';const transport=o=>{globalThis.__campusRequestCount=(globalThis.__campusRequestCount??0)+1;return {abort(){}}};const config=()=>({baseUrl:'/api/v1',timeout:5000});export const http=createHttpClient(transport,config);export const authedHttp=http;export const bindAuthSession=()=>{};`;
const loader = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@dcloudio/uni-app")
      return {
        url: `data:text/javascript,${encodeURIComponent("export const onShow=()=>{};export const onHide=()=>{};export const onUnload=()=>{};export const onLoad=()=>{};")}`,
        shortCircuit: true,
      };
    if (specifier.startsWith(".") && !extname(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return next(url.href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith("/src/api/client.ts"))
      return { format: "module", shortCircuit: true, source: clientSource };
    return next(url, context);
  },
});
after(() => loader.deregister());

function platform() {
  globalThis.__campusRequestCount = 0;
  const calls = [];
  globalThis.uni = {
    switchTab: (options) => calls.push(options.url),
    navigateTo: (options) => calls.push(options.url),
    redirectTo: (options) => calls.push(options.url),
  };
  globalThis.getCurrentPages = () => [{ route: "pages/campus/index" }];
  setActivePinia(createPinia());
  return { calls, count: () => globalThis.__campusRequestCount ?? 0 };
}

for (const target of ["H5", "MP-WEIXIN"]) {
  test(`${target} 认证页只说明尚未开放，不渲染凭据表单也不发请求`, async () => {
    const p = platform();
    const page = await mount("../src/pages/campus/index.vue", {}, target);
    try {
      const text = textOf(page.container);
      assert.match(text, /统一身份认证尚未开放/);
      assert.match(text, /免登录|不需要登录/);
      assert.match(text, /姓名、学号、统一身份认证密码或验证码/);
      assert.doesNotMatch(text, /微信登录|小程序提供|仅在小程序/);
      for (const node of [
        page.find((n) => n.type === "input"),
        page.find((n) => n.props.type === "password"),
        page.find((n) => n.type === "image"),
        page.find((n) => n.props.role === "checkbox"),
      ])
        assert.equal(node, undefined);
      assert.equal(p.count(), 0, "M1 认证页不发送认证请求");
    } finally {
      page.unmount();
    }
  });

  test(`${target} 返回个人中心按钮走主导航并可重复点击`, async () => {
    const p = platform();
    const page = await mount("../src/pages/campus/index.vue", {}, target);
    try {
      const button = page.find(
        (n) =>
          (n.type === "button" || n.props.role === "button") &&
          textOf(n).includes("返回个人中心"),
      );
      assert.ok(button);
      button.props.onClick();
      await nextTick();
      button.props.onClick();
      await nextTick();
      assert.deepEqual(p.calls, [
        "/pages/profile/index",
        "/pages/profile/index",
      ]);
    } finally {
      page.unmount();
    }
  });
}

test("认证相关旧模块仍可被其它任务复用，但页面不再引用密码控件", async () => {
  // 页面结构保留给 M2 接线：controller 与面板组件仍在仓库内，且自身不偷偷发请求。
  const { initialCampusState } = await import("../src/campus/controller.ts");
  const state = initialCampusState();
  assert.equal(state.transaction, null);
  assert.equal(state.password, "");
});
