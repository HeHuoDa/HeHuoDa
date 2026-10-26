import assert from "node:assert/strict";
import { after, test } from "node:test";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { mount, textOf } from "./component-host.mjs";

const hooksSource = `export const onShow=fn=>globalThis.__campusShow?.push(fn);export const onHide=fn=>globalThis.__campusHide?.push(fn);export const onUnload=fn=>globalThis.__campusUnload?.push(fn);`;
const clientSource = `import {createHttpClient} from './http.ts';let session=null;const transport=o=>globalThis.__campusRequest(o);const config=()=>({baseUrl:'/api/v1',timeout:5000});export const http=createHttpClient(transport,config);export const authedHttp=createHttpClient(transport,config,{accessToken:()=>session?.accessToken()??null,refresh:()=>session.refresh()});export const bindAuthSession=s=>{session=s};`;
const loader = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@dcloudio/uni-app")
      return {
        url: `data:text/javascript,${encodeURIComponent(hooksSource)}`,
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
const qualification = {
  status: "unverified",
  termId: null,
  verifiedAt: null,
  validUntil: null,
  source: null,
  available: true,
  currentTerm: {
    id: "test-term",
    startAt: "2026-09-01T00:00:00Z",
    endAt: "2027-02-01T00:00:00Z",
  },
  policyVersion: 1,
};
const verified = {
  ...qualification,
  status: "valid",
  termId: "test-term",
  verifiedAt: "2026-10-26T00:00:00Z",
  validUntil: "2027-02-01T00:00:00Z",
  source: "sicau-eauth",
};
const profile = {
  profile: {
    accountNumber: "00123456",
    name: "合成姓名",
    source: "sicau-eauth",
    updatedAt: "2026-10-26T00:00:00Z",
  },
};
const tx = {
  id: "test-tx",
  status: "waiting",
  expiresAt: "2099-01-01T00:00:00Z",
  reason: null,
  challenge: {
    version: "v1",
    imageDataUrl: "data:image/png;base64,aGVsbG8=",
    expiresAt: "2099-01-01T00:00:00Z",
  },
};
function platform() {
  const requests = [];
  globalThis.__campusShow = [];
  globalThis.__campusHide = [];
  globalThis.__campusUnload = [];
  globalThis.__pageLoadHooks = [];
  globalThis.__formPageHooks = [];
  globalThis.__campusRequest = (o) => {
    const call = { ...o, aborted: false };
    requests.push(call);
    return {
      abort() {
        call.aborted = true;
      },
    };
  };
  const storage = new Map();
  globalThis.uni = {
    getSystemInfoSync: () => ({ uniPlatform: "mp-weixin" }),
    login: (o) => o.success({ code: "synthetic-code" }),
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    switchTab() {},
    navigateTo() {},
    redirectTo() {},
  };
  globalThis.getCurrentPages = () => [{ route: "pages/campus/index" }];
  setActivePinia(createPinia());
  const last = (suffix) =>
    requests.filter((r) => r.url.endsWith(suffix)).at(-1);
  const reply = (suffix, data) => {
    const request = last(suffix);
    assert.ok(request, suffix);
    request.success({ statusCode: 200, data });
  };
  const count = (suffix) =>
    requests.filter((r) => r.url.endsWith(suffix)).length;
  return { requests, last, reply, count };
}
async function loggedIn(p) {
  const { useAuthStore } = await import("../src/stores/auth.ts");
  const auth = useAuthStore();
  const login = auth.login();
  await tick();
  p.reply("/auth/wechat/login", {
    kind: "active",
    user: { id: "synthetic-user", nickname: "微信用户", status: "active" },
    accessToken: "synthetic-access",
    refreshToken: "synthetic-refresh",
    accessExpiresAt: "2099-01-01T00:00:00Z",
    sessionExpiresAt: "2099-01-01T00:00:00Z",
  });
  await tick();
  p.reply("/auth/me", {
    user: { id: "synthetic-user", nickname: "微信用户", status: "active" },
    campus: {
      status: "unverified",
      termId: null,
      verifiedAt: null,
      validUntil: null,
    },
    availability: { teaming: false },
  });
  await login;
  return auth;
}
/** 进入页面：读取资格、告知与资料；未认证时立即自动取码。 */
async function readyPage(
  p,
  {
    qualification: state = qualification,
    profile: saved = { profile: null },
  } = {},
) {
  const page = await mount("../src/pages/campus/index.vue");
  for (const fn of globalThis.__pageLoadHooks)
    fn({ returnTo: "https://evil.test" });
  for (const fn of globalThis.__campusShow) fn();
  p.reply("/campus-verification", state);
  p.reply("/policy", { version: 1, content: "认证说明" });
  p.reply("/profile", saved);
  await tick();
  if (p.last("/transactions")) p.reply("/transactions", tx);
  await tick();
  return page;
}
const field = (page, id) =>
  page.find((n) => n.type === "input" && n.props.id === id);
const button = (page, label) =>
  page.find((n) => n.type === "button" && textOf(n).trim() === label);
function type(page, id, value) {
  field(page, id).props.onInput({ detail: { value } });
}

test("进入即见认证表单并只取一次验证码，字段只有框内提示且无框上标签", async () => {
  const p = platform();
  await loggedIn(p);
  const page = await readyPage(p);
  try {
    assert.equal(p.count("/transactions"), 1);
    assert.equal(field(page, "campus-name").props.placeholder, "姓名");
    assert.equal(field(page, "campus-name").props["aria-label"], "姓名");
    assert.equal(field(page, "campus-account").props["aria-label"], "学号");
    assert.equal(
      field(page, "campus-password").props["aria-label"],
      "统一身份认证密码",
    );
    assert.equal(field(page, "campus-captcha").props["aria-label"], "验证码");
    assert.equal(
      page.find((n) => n.type === "label"),
      undefined,
    );
    assert.equal(
      page.find((n) => n.props.role === "checkbox").props["aria-checked"],
      false,
    );
    assert.match(textOf(page.container), /我已阅读并同意上述认证说明/);
    assert.match(textOf(page.container), /密码、验证码仅用于本次认证/);
    assert.equal(button(page, "认证").props.disabled, true);
    assert.doesNotMatch(textOf(page.container), /获取验证码/);
  } finally {
    page.unmount();
  }
});

test("眼睛图标切换密码明文，不丢输入也不触发提交", async () => {
  const p = platform();
  await loggedIn(p);
  const page = await readyPage(p);
  try {
    type(page, "campus-password", "synthetic-secret");
    await nextTick();
    assert.equal(field(page, "campus-password").props.password, true);
    const reveal = page.find(
      (n) => n.props["aria-label"] === "显示密码" && n.type === "button",
    );
    assert.ok(reveal);
    assert.equal(reveal.props["aria-pressed"], false);
    reveal.props.onClick();
    await nextTick();
    assert.equal(field(page, "campus-password").props.password, false);
    assert.equal(
      field(page, "campus-password").props.value,
      "synthetic-secret",
    );
    assert.equal(
      page.find((n) => n.props["aria-label"] === "隐藏密码").props[
        "aria-pressed"
      ],
      true,
    );
    assert.equal(p.count("/submit"), 0);
  } finally {
    page.unmount();
  }
});

test("点击验证码图片换一张并清空旧答案；刷新提示可发现", async () => {
  const p = platform();
  await loggedIn(p);
  const page = await readyPage(p);
  try {
    assert.match(textOf(page.container), /看不清？点击图片换一张/);
    type(page, "campus-captcha", "OLD");
    await nextTick();
    const image = page.find(
      (n) =>
        n.props.role === "button" &&
        n.props["aria-label"] === "换一张验证码图片",
    );
    assert.ok(image);
    image.props.onClick();
    assert.equal(p.last("/captcha").method, "POST");
    p.reply("/captcha", {
      ...tx,
      challenge: { ...tx.challenge, version: "v2" },
    });
    await tick();
    assert.equal(field(page, "campus-captcha").props.value, "");
  } finally {
    page.unmount();
  }
});

test("填写后提交携带姓名与告知版本，成功显示资料卡与返回原页面", async () => {
  const p = platform();
  await loggedIn(p);
  const page = await readyPage(p);
  try {
    type(page, "campus-name", " 合成姓名 ");
    type(page, "campus-account", " 00123456 ");
    type(page, "campus-password", "synthetic-secret");
    type(page, "campus-captcha", "ABCD");
    page.find((n) => n.props.role === "checkbox").props.onClick();
    await nextTick();
    assert.equal(button(page, "认证").props.disabled, false);
    button(page, "认证").props.onClick();
    const submit = p.last("/submit");
    assert.deepEqual(submit.data, {
      name: "合成姓名",
      account: "00123456",
      password: "synthetic-secret",
      captcha: "ABCD",
      challengeVersion: "v1",
      consentVersion: 1,
    });
    submit.success({
      statusCode: 200,
      data: { ...tx, status: "succeeded", challenge: undefined },
    });
    await tick();
    p.reply("/campus-verification", verified);
    p.reply("/policy", { version: 1, content: "认证说明" });
    p.reply("/profile", profile);
    await tick();
    assert.match(textOf(page.container), /认证成功/);
    assert.match(textOf(page.container), /合成姓名/);
    assert.match(textOf(page.container), /00123456/);
    assert.match(textOf(page.container), /2027-02-01/);
    assert.ok(button(page, "返回原页面"));
  } finally {
    page.unmount();
  }
});

test("已有有效资格先看资料卡，不自动创建；点重新认证才创建事务", async () => {
  const p = platform();
  await loggedIn(p);
  const page = await readyPage(p, { qualification: verified, profile });
  try {
    assert.equal(p.count("/transactions"), 0);
    assert.match(textOf(page.container), /已认证/);
    assert.match(textOf(page.container), /合成姓名/);
    assert.equal(
      page.find((n) => n.type === "input"),
      undefined,
    );
    button(page, "重新认证").props.onClick();
    assert.equal(p.last("/transactions").method, "POST");
    p.reply("/transactions", tx);
    await tick();
    assert.ok(field(page, "campus-name"));
    assert.equal(p.count("/transactions"), 1);
  } finally {
    page.unmount();
  }
});

test("身份不匹配完整显示，重新认证保留姓名学号并要求重填密码", async () => {
  const p = platform();
  await loggedIn(p);
  const page = await readyPage(p);
  try {
    type(page, "campus-name", "合成姓名");
    type(page, "campus-account", "00123456");
    type(page, "campus-password", "synthetic-secret");
    type(page, "campus-captcha", "ABCD");
    page.find((n) => n.props.role === "checkbox").props.onClick();
    await nextTick();
    button(page, "认证").props.onClick();
    p.last("/submit").success({
      statusCode: 200,
      data: { ...tx, status: "failed", reason: "identity_mismatch" },
    });
    await tick();
    assert.match(textOf(page.container), /验证失败，姓名与学号不匹配/);
    button(page, "重新认证").props.onClick();
    p.reply("/transactions", { ...tx, id: "test-tx-2" });
    await tick();
    assert.equal(field(page, "campus-name").props.value, "合成姓名");
    assert.equal(field(page, "campus-account").props.value, "00123456");
    assert.equal(field(page, "campus-password").props.value, "");
  } finally {
    page.unmount();
  }
});

test("未开放时只提示，不创建事务", async () => {
  const p = platform();
  await loggedIn(p);
  const page = await readyPage(p, {
    qualification: { ...qualification, available: false },
  });
  try {
    assert.equal(p.count("/transactions"), 0);
    assert.match(textOf(page.container), /暂未开放/);
  } finally {
    page.unmount();
  }
});

test("真实页面切后台清密、恢复只查询；退出同步清空私人页面", async () => {
  const p = platform();
  const auth = await loggedIn(p);
  const page = await readyPage(p);
  try {
    type(page, "campus-password", "synthetic-secret");
    type(page, "campus-captcha", "ABCD");
    await nextTick();
    assert.equal(
      field(page, "campus-password").props.value,
      "synthetic-secret",
    );
    const { useAppLifecycleStore } =
      await import("../src/stores/app-lifecycle.ts");
    const app = useAppLifecycleStore();
    app.hide();
    await tick();
    assert.equal(field(page, "campus-password"), undefined);
    app.show();
    const query = p.last("/transactions/test-tx");
    assert.equal(query.method, "GET");
    query.success({ statusCode: 200, data: { ...tx, challenge: undefined } });
    await tick();
    assert.match(textOf(page.container), /重新认证/);
    assert.equal(p.count("/submit"), 0);
    assert.equal(p.count("/transactions"), 1);
    const logout = auth.logout();
    await nextTick();
    assert.match(textOf(page.container), /请先微信登录/);
    assert.doesNotMatch(
      textOf(page.container),
      /test-tx|认证说明|synthetic-secret/,
    );
    p.reply("/auth/logout", undefined);
    await logout;
  } finally {
    page.unmount();
  }
});

test("真实页面离开即取消；H5 说明页没有密码表单和认证请求", async () => {
  const p = platform();
  await loggedIn(p);
  const page = await readyPage(p);
  for (const fn of globalThis.__campusHide) fn();
  await tick();
  const cancel = p.last("/transactions/test-tx");
  assert.equal(cancel.method, "DELETE");
  cancel.success({
    statusCode: 200,
    data: { ...tx, status: "cancelled", challenge: undefined },
  });
  page.unmount();
  const before = p.requests.length;
  const h5 = await mount("../src/pages/campus/index.vue", {}, "H5");
  try {
    assert.match(textOf(h5.container), /仅在微信小程序提供/);
    assert.equal(
      h5.find((n) => n.type === "input"),
      undefined,
    );
    assert.equal(p.requests.length, before);
  } finally {
    h5.unmount();
  }
});
