import assert from "node:assert/strict";
import { after, test } from "node:test";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { mount, textOf } from "./component-host.mjs";

/**
 * 真实账号面板：验证它与示例资料分离、昵称走平台接口、退出清理本地凭据。
 * client.ts 在构建时读取 import.meta.env，Node 下没有该对象，
 * 因此替换成固定配置的等价实现，请求仍走真实 http 客户端与平台替身。
 */
const CLIENT_DOUBLE = `
import { createHttpClient } from "./http.ts";
const transport = (options) => globalThis.__uniRequest(options);
const readConfig = () => ({ baseUrl: "/api/v1", timeout: 5000 });
export const http = createHttpClient(transport, readConfig);
export const authedHttp = createHttpClient(transport, readConfig, {
  accessToken: () => globalThis.__authAccessToken?.() ?? null,
  refresh: () => globalThis.__authRefresh?.(),
});
export function bindAuthSession(session) {
  globalThis.__authAccessToken = session.accessToken;
  globalThis.__authRefresh = session.refresh;
}
`;

const loader = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && !extname(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return next(url.href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith("/src/api/client.ts"))
      return { format: "module", shortCircuit: true, source: CLIENT_DOUBLE };
    return next(url, context);
  },
});
after(() => loader.deregister());

const tick = () => new Promise((resolve) => setImmediate(resolve));

const credential = {
  kind: "active",
  user: { id: "u1", nickname: "微信用户", status: "active" },
  accessToken: "at-1",
  refreshToken: "rt-1",
  accessExpiresAt: "2026-10-25T12:15:00.000Z",
  sessionExpiresAt: "2026-11-24T12:00:00.000Z",
};
const profile = (nickname = "微信用户") => ({
  user: { id: "u1", nickname, status: "active" },
  campus: {
    status: "unverified",
    termId: null,
    verifiedAt: null,
    validUntil: null,
  },
  availability: { teaming: false },
});

function installPlatform() {
  const requests = [];
  const storage = new Map();
  const calls = { navigateTo: [] };
  globalThis.__uniRequest = (options) => {
    requests.push(options);
    return { abort() {} };
  };
  globalThis.uni = {
    getSystemInfoSync: () => ({ uniPlatform: "mp-weixin" }),
    login(options) {
      options.success({ code: "wx-code" });
    },
    getStorageSync: (key) => storage.get(key) ?? "",
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    navigateTo(options) {
      calls.navigateTo.push(options.url);
    },
    switchTab() {},
    reLaunch() {},
    redirectTo() {},
    navigateBack() {},
  };
  globalThis.getCurrentPages = () => [{ route: "pages/profile/index" }];
  return { requests, storage, calls };
}

async function mountPanel() {
  const app = await mount("../src/components/ProfileAccountPanel.vue");
  const text = () => textOf(app.container);
  const button = (label) => {
    const node = app.find(
      (n) => n.type === "button" && textOf(n).includes(label),
    );
    assert.ok(node, `找不到按钮：${label}`);
    return node;
  };
  return { app, text, button };
}

test("未登录时说明账号与示例资料独立，并只跳转平台登录页", async () => {
  const platform = installPlatform();
  setActivePinia(createPinia());
  const panel = await mountPanel();
  assert.match(panel.text(), /真实账号/);
  assert.match(panel.text(), /示例资料/);
  assert.match(panel.text(), /不会写入账号/);

  panel.button("微信登录").props.onClick();
  assert.deepEqual(platform.calls.navigateTo, ["/pages/auth/login"]);
});

test("登录后显示真实昵称与校园状态，修改昵称走平台接口", async () => {
  const platform = installPlatform();
  setActivePinia(createPinia());
  const { useAuthStore } = await import("../src/stores/auth.ts");
  const auth = useAuthStore();
  const logging = auth.login();
  await tick();
  platform.requests[0].success({ statusCode: 200, data: credential });
  await tick();
  platform.requests[1].success({ statusCode: 200, data: profile() });
  await logging;

  const panel = await mountPanel();
  assert.match(panel.text(), /微信用户/);
  assert.match(panel.text(), /账号正常/);
  assert.match(panel.text(), /校园身份未核验/);
  assert.match(panel.text(), /组队能力暂未开放/);

  panel.button("修改昵称").props.onClick();
  await nextTick();
  panel.app
    .find((n) => n.type === "input" && n.props.id === "account-nickname")
    .props.onInput({ detail: { value: "  禾小苗  " } });
  await nextTick();
  panel.button("保存昵称").props.onClick();
  await tick();

  const save = platform.requests.at(-1);
  assert.equal(save.method, "POST");
  assert.equal(save.url, "/api/v1/auth/me");
  assert.deepEqual(save.data, { nickname: "禾小苗" });
  assert.equal(save.header.Authorization, "Bearer at-1");
  save.success({ statusCode: 200, data: profile("禾小苗") });
  await tick();
  await nextTick();
  assert.match(panel.text(), /禾小苗/);
  assert.match(panel.text(), /昵称已保存/);
});

test("昵称超长不提交请求；退出登录清理本地凭据并说明远端结果", async () => {
  const platform = installPlatform();
  setActivePinia(createPinia());
  const { useAuthStore } = await import("../src/stores/auth.ts");
  const auth = useAuthStore();
  const logging = auth.login();
  await tick();
  platform.requests[0].success({ statusCode: 200, data: credential });
  await tick();
  platform.requests[1].success({ statusCode: 200, data: profile() });
  await logging;

  const panel = await mountPanel();
  panel.button("修改昵称").props.onClick();
  await nextTick();
  panel.app
    .find((n) => n.type === "input" && n.props.id === "account-nickname")
    .props.onInput({ detail: { value: "字".repeat(21) } });
  await nextTick();
  panel.button("保存昵称").props.onClick();
  await tick();
  assert.equal(platform.requests.length, 2, "超长昵称不发起请求");
  assert.match(panel.text(), /最多 20 个字/);

  panel.button("取消").props.onClick();
  await nextTick();
  panel.button("退出登录").props.onClick();
  await tick();
  const logout = platform.requests.at(-1);
  assert.equal(logout.method, "POST");
  assert.equal(logout.url, "/api/v1/auth/logout");
  logout.success({ statusCode: 204, data: "" });
  await tick();
  await nextTick();
  assert.equal(platform.storage.size, 0, "退出后不保留刷新凭据");
  assert.equal(auth.authenticated, false);
  assert.match(panel.text(), /已退出登录/);
  assert.match(panel.text(), /不会写入账号/);
});

test("退出时远端失败也清理本地，并如实说明状态不明", async () => {
  const platform = installPlatform();
  setActivePinia(createPinia());
  const { useAuthStore } = await import("../src/stores/auth.ts");
  const auth = useAuthStore();
  const logging = auth.login();
  await tick();
  platform.requests[0].success({ statusCode: 200, data: credential });
  await tick();
  platform.requests[1].success({ statusCode: 200, data: profile() });
  await logging;

  const panel = await mountPanel();
  panel.button("退出登录").props.onClick();
  await tick();
  platform.requests.at(-1).fail({ errMsg: "request:fail network error" });
  await tick();
  await nextTick();
  assert.equal(platform.storage.size, 0);
  assert.equal(auth.authenticated, false);
  assert.match(panel.text(), /远端会话未能确认撤销/);
});
