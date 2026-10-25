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
  return { requests, last, reply };
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
async function readyPage(p) {
  const page = await mount("../src/pages/campus/index.vue");
  for (const fn of globalThis.__pageLoadHooks)
    fn({ returnTo: "https://evil.test" });
  for (const fn of globalThis.__campusShow) fn();
  p.reply("/campus-verification", qualification);
  p.reply("/policy", { version: 1, content: "独立核验告知" });
  p.reply("/profile", { profile: null });
  await tick();
  page.find((n) => n.props.role === "checkbox").props.onClick();
  await nextTick();
  page
    .find((n) => n.type === "button" && textOf(n).includes("同意并获取验证码"))
    .props.onClick();
  p.reply("/transactions", tx);
  await tick();
  return page;
}

test("真实页面切后台清密、恢复只查询；退出同步清空私人页面", async () => {
  const p = platform();
  const auth = await loggedIn(p);
  const page = await readyPage(p);
  try {
    const input = (id) =>
      page.find((n) => n.type === "input" && n.props.id === id);
    input("campus-password").props.onInput({
      detail: { value: "synthetic-secret" },
    });
    input("campus-captcha").props.onInput({ detail: { value: "ABCD" } });
    await nextTick();
    assert.equal(input("campus-password").props.value, "synthetic-secret");
    const { useAppLifecycleStore } =
      await import("../src/stores/app-lifecycle.ts");
    const app = useAppLifecycleStore();
    app.hide();
    await tick();
    assert.equal(input("campus-password"), undefined);
    app.show();
    const query = p.last("/transactions/test-tx");
    assert.equal(query.method, "GET");
    query.success({ statusCode: 200, data: { ...tx, challenge: undefined } });
    await tick();
    assert.match(textOf(page.container), /旧输入已清空/);
    assert.equal(p.requests.filter((r) => r.url.endsWith("/submit")).length, 0);
    const logout = auth.logout();
    await nextTick();
    assert.match(textOf(page.container), /请先微信登录/);
    assert.doesNotMatch(
      textOf(page.container),
      /test-tx|独立核验告知|synthetic-secret/,
    );
    p.reply("/auth/logout", undefined);
    await logout;
  } finally {
    page.unmount();
  }
});

test("真实页面离开即取消；H5 说明页没有密码表单和核验请求", async () => {
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
