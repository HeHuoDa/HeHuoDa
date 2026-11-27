import assert from "node:assert/strict";
import { after, test } from "node:test";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { mount, textOf } from "./component-host.mjs";

const clientSource = `
import { createHttpClient } from './http.ts';
const transport = (o) => {
  globalThis.__campusRequests = globalThis.__campusRequests ?? [];
  globalThis.__campusRequests.push(o);
  return { abort() {} };
};
const config = () => ({ baseUrl: '/api/v1', timeout: 5000 });
export const http = createHttpClient(transport, config);
export const authedHttp = createHttpClient(transport, config, {
  accessToken: () => globalThis.__campusToken?.() ?? null,
  refresh: () => Promise.reject(new Error('no refresh')),
});
export const bindAuthSession = (s) => { globalThis.__campusToken = s.accessToken; };
`;
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

const tick = () => new Promise((resolve) => setImmediate(resolve));

function platform(uniPlatform = "app") {
  globalThis.__campusRequests = [];
  const calls = [];
  globalThis.uni = {
    getSystemInfoSync: () => ({ uniPlatform }),
    switchTab: (options) => calls.push(options.url),
    navigateTo: (options) => calls.push(options.url),
    redirectTo: (options) => calls.push(options.url),
  };
  globalThis.getCurrentPages = () => [{ route: "pages/campus/index" }];
  setActivePinia(createPinia());
  return { calls, requests: () => globalThis.__campusRequests };
}

test("H5 校园认证入口接入统一学校登录流程，读取公开说明并请求匿名建码", async () => {
  const p = platform("web");
  const page = await mount("../src/pages/campus/index.vue", {}, "H5");
  try {
    await tick();
    const reqs = p.requests();
    assert.equal(reqs[0].url, "/api/v1/campus-verification/policy");
    reqs[0].success({
      statusCode: 200,
      data: { version: 1, content: "校园身份核验与登录说明" },
    });
    await tick();
    assert.equal(reqs[1].url, "/api/v1/auth/school/challenges");
    reqs[1].success({
      statusCode: 201,
      data: {
        id: "tx-campus",
        status: "waiting",
        expiresAt: "2099-01-01T00:10:00.000Z",
        reason: null,
        holderToken: "ht-campus",
        challenge: {
          version: "v1",
          imageDataUrl: "data:image/png;base64,AA==",
          expiresAt: "2099-01-01T00:05:00.000Z",
        },
      },
    });
    await tick();
    await nextTick();
    const text = textOf(page.container);
    assert.match(text, /统一身份认证/);
    assert.match(text, /校园身份核验与登录说明/);
    assert.ok(page.find((n) => n.props.id === "school-name"));
    assert.ok(page.find((n) => n.props.id === "school-account"));
    assert.ok(page.find((n) => n.props.id === "school-password"));
    assert.ok(page.find((n) => n.props.id === "school-captcha"));
  } finally {
    page.unmount();
  }
});

test("非 H5（Android App-Plus）认证页保持暂缓说明且不渲染凭据表单也不发请求", async () => {
  const p = platform("app");
  const page = await mount("../src/pages/campus/index.vue", {}, "APP-PLUS");
  try {
    const text = textOf(page.container);
    assert.match(text, /统一身份认证尚未开放/);
    assert.match(text, /免登录|不需要登录/);
    for (const node of [
      page.find((n) => n.type === "input"),
      page.find((n) => n.props.role === "checkbox"),
    ])
      assert.equal(node, undefined);
    assert.equal(p.requests().length, 0);

    const button = page.find(
      (n) =>
        (n.type === "button" || n.props.role === "button") &&
        textOf(n).includes("返回个人中心"),
    );
    assert.ok(button);
    button.props.onClick();
    await nextTick();
    assert.deepEqual(p.calls, ["/pages/profile/index"]);
  } finally {
    page.unmount();
  }
});

test("旧校园控制器模块保持可用，初始状态不预填密码或事务", async () => {
  const { initialCampusState } = await import("../src/campus/controller.ts");
  const state = initialCampusState();
  assert.equal(state.transaction, null);
  assert.equal(state.password, "");
});
