import assert from "node:assert/strict";
import { after, test } from "node:test";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { mount, textOf } from "./component-host.mjs";
import { resolveReturnTarget } from "../src/navigation/return-target.ts";

/**
 * 登录面板测试：用平台替身替换请求传输与微信登录，验证用户可见行为。
 * client.ts 在 Vite 构建时读取 import.meta.env，Node 测试下没有该对象，
 * 因此这里把共享客户端替换成固定配置的等价实现，其余链路保持真实。
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
const profile = {
  user: { id: "u1", nickname: "微信用户", status: "active" },
  campus: {
    status: "unverified",
    termId: null,
    verifiedAt: null,
    validUntil: null,
  },
  availability: { teaming: false },
};

/** 平台替身：记录请求、模拟微信登录结果与小程序存储。 */
function installPlatform({ login = "ok", platform = "mp-weixin" } = {}) {
  const requests = [];
  const storage = new Map();
  const calls = { login: 0, switchTab: 0, redirect: 0 };
  globalThis.__uniRequest = (options) => {
    requests.push(options);
    return { abort() {} };
  };
  globalThis.uni = {
    getSystemInfoSync: () => ({ uniPlatform: platform }),
    login(options) {
      calls.login += 1;
      if (login === "ok") options.success({ code: "wx-code" });
      else if (login === "cancel")
        options.fail({ errMsg: "login:fail cancel" });
      else options.fail({ errMsg: "login:fail system error" });
    },
    getStorageSync: (key) => storage.get(key) ?? "",
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    switchTab() {
      calls.switchTab += 1;
    },
    reLaunch() {},
    navigateTo() {},
    redirectTo() {
      calls.redirect += 1;
    },
    navigateBack() {},
  };
  globalThis.getCurrentPages = () => [{ route: "pages/auth/login" }];
  return { requests, storage, calls };
}

async function openPanel(props = {}) {
  setActivePinia(createPinia());
  const app = await mount("../src/components/WechatLoginPanel.vue", props);
  const text = () => textOf(app.container);
  const button = (label) => {
    const node = app.find(
      (n) => n.type === "button" && textOf(n).includes(label),
    );
    assert.ok(node, `找不到按钮：${label}`);
    return node;
  };
  const consent = () =>
    app.find((node) => node.props.role === "checkbox") ??
    assert.fail("找不到协议勾选");
  return { app, text, button, consent };
}

test("未勾选协议时登录按钮不可用，勾选后才允许发起微信登录", async () => {
  const platform = installPlatform();
  const panel = await openPanel();
  assert.equal(panel.button("微信一键登录").props.disabled, true);
  assert.match(panel.text(), /勾选同意后可登录/);
  assert.equal(platform.calls.login, 0);

  panel.consent().props.onClick();
  await nextTick();
  assert.equal(panel.button("微信一键登录").props.disabled, false);
  assert.equal(platform.calls.login, 0);
  assert.equal(platform.requests.length, 0);
});

test("登录成功只保存刷新凭据并显示真实账号昵称", async () => {
  const platform = installPlatform();
  const panel = await openPanel();
  panel.consent().props.onClick();
  await nextTick();
  panel.button("微信一键登录").props.onClick();
  await tick();

  assert.equal(platform.calls.login, 1);
  assert.equal(platform.requests.length, 1);
  assert.equal(platform.requests[0].method, "POST");
  assert.equal(platform.requests[0].url, "/api/v1/auth/wechat/login");
  assert.deepEqual(platform.requests[0].data, {
    code: "wx-code",
    consentVersion: 1,
  });

  platform.requests[0].success({ statusCode: 200, data: credential });
  await tick();
  assert.equal(platform.requests[1].method, "GET");
  assert.equal(platform.requests[1].url, "/api/v1/auth/me");
  platform.requests[1].success({ statusCode: 200, data: profile });
  await tick();
  await nextTick();

  assert.equal(platform.storage.get("hehuoda.auth.refresh"), "rt-1");
  assert.equal([...platform.storage.keys()].length, 1, "只保存刷新凭据");
  assert.match(panel.text(), /已登录：微信用户/);
  // 返回上一页：登录页是栈底时回首页，不跳到任意地址。
  assert.equal(platform.calls.switchTab, 1);
});

test("连点只发一次登录请求，进行中按钮不可再次触发", async () => {
  const platform = installPlatform();
  const panel = await openPanel();
  panel.consent().props.onClick();
  await nextTick();
  const submit = panel.button("微信一键登录");
  submit.props.onClick();
  submit.props.onClick();
  await tick();
  assert.equal(platform.calls.login, 1);
  assert.equal(platform.requests.length, 1);
});

test("取消微信授权给出真实状态且不发起请求", async () => {
  const platform = installPlatform({ login: "cancel" });
  const panel = await openPanel();
  panel.consent().props.onClick();
  await nextTick();
  panel.button("微信一键登录").props.onClick();
  await tick();
  assert.equal(platform.requests.length, 0);
  assert.match(panel.text(), /已取消微信登录/);
});

test("限流与服务关闭按公开错误码反馈，不假装成功", async () => {
  const limited = installPlatform();
  const panel = await openPanel();
  panel.consent().props.onClick();
  await nextTick();
  panel.button("微信一键登录").props.onClick();
  await tick();
  limited.requests[0].success({
    statusCode: 429,
    data: {
      code: "TOO_MANY_REQUESTS",
      message: "请求过于频繁",
      details: { retryAfterSeconds: 30 },
    },
  });
  await tick();
  await nextTick();
  assert.match(panel.text(), /请求过于频繁，请 30 秒后再试/);

  const closed = installPlatform();
  const second = await openPanel();
  second.consent().props.onClick();
  await nextTick();
  second.button("微信一键登录").props.onClick();
  await tick();
  closed.requests[0].success({
    statusCode: 503,
    data: { code: "WECHAT_LOGIN_UNAVAILABLE", message: "未开放" },
  });
  await tick();
  await nextTick();
  assert.match(second.text(), /微信登录暂未开放/);
  assert.equal(closed.storage.size, 0);
});

test("只有微信小程序分支保存刷新凭据，H5 使用空存储", async () => {
  const { platformAuthStorage } =
    await import("../src/auth/platform-storage.ts");
  const writes = [];
  const install = (platform) => {
    globalThis.uni = {
      getSystemInfoSync: () => ({ uniPlatform: platform }),
      getStorageSync: () => "",
      setStorageSync: (key, value) => writes.push([platform, key, value]),
      removeStorageSync: () => {},
    };
  };

  install("web");
  const h5 = platformAuthStorage();
  h5.write("rt-1");
  assert.equal(h5.read(), null);
  assert.equal(writes.length, 0, "H5 不写小程序刷新凭据");

  install("mp-weixin");
  const weixin = platformAuthStorage();
  weixin.write("rt-2");
  assert.deepEqual(writes, [["mp-weixin", "hehuoda.auth.refresh", "rt-2"]]);
});

test("返回目标只接受注册表内的平台页面", () => {
  assert.equal(resolveReturnTarget("team-new"), "team-new");
  assert.equal(resolveReturnTarget("/pages/teams/new"), "team-new");
  assert.equal(
    resolveReturnTarget("/pages/teams/detail?id=abc"),
    "team-detail",
  );
  for (const raw of [
    "https://evil.example.com",
    "//evil.example.com",
    "weixin://dl/business",
    "javascript:alert(1)",
    "login",
    "register",
    "not-found",
    "profile",
    "pages/unknown/index",
    "",
    null,
    42,
  ])
    assert.equal(resolveReturnTarget(raw), null, String(raw));
});
