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
 * 学校唯一登录面板组件测试（H5）：用平台替身替换底层传输，验证表单交互、
 * Cookie+CSRF 提交、内存凭据、告知版本变化与平台存储隔离。
 */
const CLIENT_DOUBLE = `
import { createHttpClient } from "./http.ts";
const transport = (options) => globalThis.__uniRequest(options);
const readConfig = () => ({ baseUrl: "/api/v1", timeout: 5000 });
export const http = createHttpClient(transport, readConfig);
export const authedHttp = createHttpClient(transport, readConfig, {
  accessToken: () => globalThis.__authAccessToken?.() ?? null,
  refresh: () => globalThis.__authRefresh?.(),
  generation: () => globalThis.__authGeneration?.() ?? 0,
});
export function bindAuthSession(session) {
  globalThis.__authAccessToken = session.accessToken;
  globalThis.__authRefresh = session.refresh;
  globalThis.__authGeneration = session.generation;
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

const h5Credential = {
  kind: "active",
  user: { id: "u1", nickname: "禾伙搭用户", status: "active" },
  accessToken: "at-school-1",
  accessExpiresAt: "2099-01-01T00:15:00.000Z",
  sessionExpiresAt: "2099-02-01T00:00:00.000Z",
};
const profile = {
  user: { id: "u1", nickname: "禾伙搭用户", status: "active" },
  campus: {
    status: "valid",
    termId: "2026-fall",
    verifiedAt: "2026-10-25T10:00:00.000Z",
    validUntil: "2027-01-31T16:00:00.000Z",
  },
  availability: { teaming: false },
};
const challengePayload = (version = "c1") => ({
  id: "tx-1",
  status: "waiting",
  expiresAt: "2099-01-01T00:10:00.000Z",
  reason: null,
  holderToken: "ht-1",
  challenge: {
    version,
    imageDataUrl: "data:image/png;base64,AA==",
    expiresAt: "2099-01-01T00:05:00.000Z",
  },
});

function installPlatform({ platform = "web" } = {}) {
  const requests = [];
  const storage = new Map();
  const calls = { switchTab: 0, redirect: 0 };
  globalThis.__uniRequest = (options) => {
    requests.push(options);
    return { abort() {} };
  };
  globalThis.uni = {
    getSystemInfoSync: () => ({ uniPlatform: platform }),
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

async function openPanel(props = {}, platform = installPlatform()) {
  setActivePinia(createPinia());
  const app = await mount(
    "../src/components/SchoolLoginPanel.vue",
    props,
    "H5",
  );
  await tick();
  // policy + challenge
  assert.equal(platform.requests[0].url, "/api/v1/campus-verification/policy");
  platform.requests[0].success({
    statusCode: 200,
    data: { version: 2, content: "学校统一身份认证隐私说明" },
  });
  await tick();
  assert.equal(platform.requests[1].url, "/api/v1/auth/school/challenges");
  platform.requests[1].success({
    statusCode: 201,
    data: challengePayload("c1"),
  });
  await tick();
  await nextTick();

  const text = () => textOf(app.container);
  const button = (label) => {
    const node = app.find(
      (n) =>
        (n.type === "button" || n.props.role === "button") &&
        textOf(n).includes(label),
    );
    assert.ok(node, `找不到按钮：${label}`);
    return node;
  };
  const consent = () =>
    app.find((node) => node.props.role === "checkbox") ??
    assert.fail("找不到说明勾选框");
  const input = async (id, value) => {
    const node = app.find((n) => n.type === "input" && n.props.id === id);
    assert.ok(node, `找不到输入框：${id}`);
    node.props.onInput({ target: { value } });
    await nextTick();
  };
  return { app, text, button, consent, input, platform };
}

test("缺字段或未勾选说明时禁止提交，补齐且勾选后才允许提交", async () => {
  const panel = await openPanel();
  try {
    const submitBtn = panel.button("学校账号登录");
    assert.equal(submitBtn.props["aria-disabled"], true);

    await panel.input("school-name", " 张三 ");
    await panel.input("school-account", " 20240001 ");
    await panel.input("school-password", "pw-123");
    await panel.input("school-captcha", "abcd");
    assert.equal(
      panel.button("学校账号登录").props["aria-disabled"],
      true,
      "未勾选仍禁用",
    );

    panel.consent().props.onClick();
    await nextTick();
    assert.equal(panel.button("学校账号登录").props["aria-disabled"], false);
  } finally {
    panel.app.unmount();
  }
});

test("H5 学校登录带 withCredentials+CSRF、密码不写入存储并刷新资料后回跳", async () => {
  const panel = await openPanel();
  try {
    await panel.input("school-name", " 张三 ");
    await panel.input("school-account", " 20240001 ");
    await panel.input("school-password", "  pw-secret  ");
    await panel.input("school-captcha", "1234");
    panel.consent().props.onClick();
    await nextTick();

    panel.button("学校账号登录").props.onClick();
    await tick();
    await nextTick();

    // 提交后页面密码与验证码立即清空
    assert.equal(
      panel.app.find((n) => n.props.id === "school-password")?.props.value ??
        "",
      "",
    );
    assert.equal(
      panel.app.find((n) => n.props.id === "school-captcha")?.props.value ?? "",
      "",
    );

    const submitReq = panel.platform.requests[2];
    assert.equal(submitReq.method, "POST");
    assert.equal(
      submitReq.url,
      "/api/v1/auth/school/challenges/tx-1/submit/h5",
    );
    assert.equal(submitReq.withCredentials, true);
    assert.equal(submitReq.header["X-Refresh-CSRF"], "1");
    assert.equal(submitReq.header.Authorization, undefined);
    assert.deepEqual(submitReq.data, {
      holderToken: "ht-1",
      name: "张三",
      account: "20240001",
      password: "  pw-secret  ",
      captcha: "1234",
      challengeVersion: "c1",
      consentVersion: 2,
    });

    submitReq.success({
      statusCode: 200,
      data: {
        id: "tx-1",
        status: "succeeded",
        expiresAt: "2099-01-01T00:10:00.000Z",
        reason: null,
        credential: h5Credential,
      },
    });
    await tick();

    const meReq = panel.platform.requests[3];
    assert.equal(meReq.method, "GET");
    assert.equal(meReq.url, "/api/v1/auth/me");
    assert.equal(meReq.header.Authorization, "Bearer at-school-1");
    meReq.success({ statusCode: 200, data: profile });
    await tick();
    await nextTick();

    assert.equal(panel.platform.storage.size, 0, "H5 不向本地存储写任何凭据");
    assert.match(panel.text(), /已登录：禾伙搭用户/);
    assert.equal(panel.platform.calls.switchTab, 1);
  } finally {
    panel.app.unmount();
  }
});

test("点击换一张刷新验证码并清除旧验证码输入", async () => {
  const panel = await openPanel();
  try {
    await panel.input("school-captcha", "old1");
    panel.button("换一张").props.onClick();
    await tick();
    await nextTick();

    assert.equal(
      panel.app.find((n) => n.props.id === "school-captcha").props.value,
      "",
    );
    const refreshReq = panel.platform.requests[2];
    assert.equal(refreshReq.url, "/api/v1/auth/school/challenges/tx-1/captcha");
    refreshReq.success({ statusCode: 200, data: challengePayload("c2") });
    await tick();
  } finally {
    panel.app.unmount();
  }
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
