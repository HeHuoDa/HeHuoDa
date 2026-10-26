import assert from "node:assert/strict";
import { after, test } from "node:test";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { mount, textOf } from "./component-host.mjs";

/**
 * 个人中心账号下拉：图标形态、开合、条目跳转、真实昵称与退出。
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
    getWindowInfo: () => ({ windowHeight: 800 }),
    onKeyboardHeightChange() {},
    onWindowResize() {},
    offWindowResize() {},
    offKeyboardHeightChange() {},
    hideTabBar() {},
    showTabBar() {},
    getStorageSync: (key) => storage.get(key) ?? "",
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    navigateTo(options) {
      calls.navigateTo.push(options.url);
      options.success?.();
    },
    switchTab() {},
    reLaunch() {},
    redirectTo() {},
    navigateBack() {},
  };
  globalThis.getCurrentPages = () => [{ route: "pages/profile/index" }];
  return { requests, storage, calls };
}

async function mountOverview() {
  const app = await mount("../src/components/ProfileOverview.vue");
  const text = () => textOf(app.container);
  const trigger = () =>
    app.find(
      (node) =>
        node.props.role === "button" && node.props["aria-haspopup"] === "menu",
    );
  const openMenu = async () => {
    const node = trigger();
    assert.ok(node, "账号入口应存在");
    node.props.onClick();
    await nextTick();
  };
  const menuItem = (label) =>
    app.find(
      (n) =>
        n.props.role === "menuitem" &&
        n.props.onClick &&
        textOf(n).includes(label),
    );
  const clickItem = async (label) => {
    const node = menuItem(label);
    assert.ok(node, `找不到下拉条目：${label}`);
    node.props.onClick();
    await nextTick();
  };
  const clickButton = async (label) => {
    const node = app.find(
      (n) => n.type === "button" && textOf(n).includes(label),
    );
    assert.ok(node, `找不到按钮：${label}`);
    node.props.onClick();
    await nextTick();
  };
  return { app, text, trigger, openMenu, menuItem, clickItem, clickButton };
}

async function loginAs(auth, platform, campusStatus = "unverified") {
  const logging = auth.login();
  await tick();
  platform.requests[0].success({ statusCode: 200, data: credential });
  await tick();
  const data = profile();
  data.campus.status = campusStatus;
  platform.requests[1].success({ statusCode: 200, data });
  await logging;
}

test("未登录：图标为线框人像，下拉五项，微信登录跳登录页", async () => {
  const platform = installPlatform();
  setActivePinia(createPinia());
  const view = await mountOverview();
  try {
    assert.equal(view.trigger().props["aria-expanded"], false);
    // 未登录没有昵称首字，只有图标字形。
    assert.doesNotMatch(view.text(), /微信用户/);

    await view.openMenu();
    assert.equal(view.trigger().props["aria-expanded"], true);
    for (const label of ["微信登录", "编辑资料", "关于我们", "重置示例"])
      assert.ok(view.menuItem(label), label);
    assert.match(view.text(), /联系方式授权/);
    assert.ok(
      view.app.find((n) => n.type === "switch"),
      "联系方式授权以开关呈现",
    );
    assert.equal(view.menuItem("退出登录"), undefined);

    await view.clickItem("微信登录");
    assert.deepEqual(platform.calls.navigateTo, ["/pages/auth/login"]);
    assert.equal(view.menuItem("编辑资料"), undefined, "点击条目后关闭");
  } finally {
    view.app.unmount();
  }
});

test("点遮罩或再点图标都能关闭下拉", async () => {
  installPlatform();
  setActivePinia(createPinia());
  const view = await mountOverview();
  try {
    await view.openMenu();
    const mask = view.app.find((n) => n.props.class === "profile-menu__mask");
    assert.ok(mask, "应有透明遮罩");
    mask.props.onClick();
    await nextTick();
    assert.equal(view.menuItem("编辑资料"), undefined);
    assert.equal(view.trigger().props["aria-expanded"], false);

    await view.openMenu();
    assert.ok(view.menuItem("编辑资料"));
    view.trigger().props.onClick();
    await nextTick();
    assert.equal(view.menuItem("编辑资料"), undefined);
  } finally {
    view.app.unmount();
  }
});

test("真实资格状态只显示认证结论，不宣称学生或在读", async () => {
  for (const [status, label] of [
    ["valid", "已认证"],
    ["expired", "认证已过期"],
    ["revoked", "认证已撤销"],
  ]) {
    const platform = installPlatform();
    setActivePinia(createPinia());
    const { useAuthStore } = await import("../src/stores/auth.ts");
    await loginAs(useAuthStore(), platform, status);
    const view = await mountOverview();
    try {
      await view.openMenu();
      assert.ok(view.text().includes(label));
      assert.doesNotMatch(view.text(), /学生身份已|当前在读|校园身份已核验/);
    } finally {
      view.app.unmount();
    }
  }
});

test("已登录：图标显示首字，下拉显示昵称与账号状态，退出后回到未登录", async () => {
  const platform = installPlatform();
  setActivePinia(createPinia());
  const { useAuthStore } = await import("../src/stores/auth.ts");
  const auth = useAuthStore();
  await loginAs(auth, platform);
  const view = await mountOverview();
  try {
    assert.match(view.text(), /微/, "图标显示昵称首字");
    assert.match(view.text(), /微信用户/);
    await view.openMenu();
    assert.match(view.text(), /账号正常 · 未认证/);
    assert.ok(view.menuItem("退出登录"));

    view.menuItem("退出登录").props.onClick();
    await tick();
    await nextTick();
    const logout = platform.requests.at(-1);
    assert.equal(logout.url, "/api/v1/auth/logout");
    logout.success({ statusCode: 204, data: "" });
    await tick();
    await nextTick();
    assert.equal(auth.authenticated, false);
    assert.equal(platform.storage.size, 0);
    assert.match(view.text(), /已退出登录/);
    assert.ok(view.menuItem("微信登录"), "退出后回到未登录条目");
  } finally {
    view.app.unmount();
  }
});

test("已登录：下拉内改真实昵称写 /auth/me 并立即生效", async () => {
  const platform = installPlatform();
  setActivePinia(createPinia());
  const { useAuthStore } = await import("../src/stores/auth.ts");
  const auth = useAuthStore();
  await loginAs(auth, platform);
  const view = await mountOverview();
  try {
    await view.openMenu();
    await view.clickItem("编辑资料");
    view.app
      .find((n) => n.type === "input" && n.props.id === "profile-nickname")
      .props.onInput({ detail: { value: "  禾小苗  " } });
    await nextTick();
    await view.clickButton("保存资料");
    await tick();
    const save = platform.requests.at(-1);
    assert.equal(save.method, "POST");
    assert.equal(save.url, "/api/v1/auth/me");
    assert.deepEqual(save.data, { nickname: "禾小苗" });
    save.success({ statusCode: 200, data: profile("禾小苗") });
    await tick();
    await nextTick();
    assert.equal(auth.nickname, "禾小苗");
    assert.match(view.text(), /禾小苗/);
    assert.match(view.text(), /昵称已保存到账号/);
  } finally {
    view.app.unmount();
  }
});

test("昵称超过 20 字不提交请求，弹窗保持打开", async () => {
  const platform = installPlatform();
  setActivePinia(createPinia());
  const { useAuthStore } = await import("../src/stores/auth.ts");
  const auth = useAuthStore();
  await loginAs(auth, platform);
  const before = platform.requests.length;
  const view = await mountOverview();
  try {
    await view.openMenu();
    await view.clickItem("编辑资料");
    view.app
      .find((n) => n.type === "input" && n.props.id === "profile-nickname")
      .props.onInput({ detail: { value: "字".repeat(21) } });
    await nextTick();
    await view.clickButton("保存资料");
    await tick();
    assert.equal(platform.requests.length, before, "超长昵称不发请求");
    assert.match(view.text(), /最多 20 个字/);
    assert.ok(
      view.app.find((n) => n.props.id === "profile-nickname"),
      "弹窗保持打开",
    );
  } finally {
    view.app.unmount();
  }
});

test("登录后演示队伍里的本人显示真实昵称", async () => {
  const platform = installPlatform();
  setActivePinia(createPinia());
  const { useAuthStore } = await import("../src/stores/auth.ts");
  const { useSessionStore } = await import("../src/stores/session.ts");
  const auth = useAuthStore();
  const session = useSessionStore();
  const { DEMO_PARTICIPANT } = await import("@hehuoda/client-domain/team");
  assert.equal(session.memberNickname(DEMO_PARTICIPANT.id, "旧"), "禾小苗");
  await loginAs(auth, platform);
  assert.equal(
    session.memberNickname(DEMO_PARTICIPANT.id, "旧"),
    "微信用户",
    "登录后本人用账号昵称",
  );
  const loggingOut = auth.logout();
  await tick();
  platform.requests.at(-1).success({ statusCode: 204, data: "" });
  await loggingOut;
  assert.equal(session.memberNickname(DEMO_PARTICIPANT.id, "旧"), "禾小苗");
});

test("已登录：退出时远端未确认，下拉内如实提示且本地已清除", async () => {
  const platform = installPlatform();
  setActivePinia(createPinia());
  const { useAuthStore } = await import("../src/stores/auth.ts");
  const auth = useAuthStore();
  await loginAs(auth, platform);
  const view = await mountOverview();
  try {
    await view.openMenu();
    view.menuItem("退出登录").props.onClick();
    await tick();
    const logout = platform.requests.at(-1);
    assert.equal(logout.url, "/api/v1/auth/logout");
    logout.fail({ errMsg: "request:fail timeout" });
    await tick();
    await nextTick();

    assert.equal(auth.authenticated, false, "本地状态已退出");
    assert.equal(platform.storage.size, 0, "本地凭据已清除");
    assert.match(view.text(), /远端会话未能确认撤销/, "如实说明远端状态");
    assert.doesNotMatch(view.text(), /已退出登录/, "不伪称远端成功");
    assert.ok(view.menuItem("微信登录"), "下拉回到未登录形态");
  } finally {
    view.app.unmount();
  }
});

test("已登录：账号受限时下拉显示受限状态", async () => {
  const platform = installPlatform();
  setActivePinia(createPinia());
  const { useAuthStore } = await import("../src/stores/auth.ts");
  const auth = useAuthStore();
  const restricted = { id: "u1", nickname: "微信用户", status: "restricted" };
  const logging = auth.login();
  await tick();
  platform.requests[0].success({
    statusCode: 200,
    data: { ...credential, user: restricted },
  });
  await tick();
  platform.requests[1].success({
    statusCode: 200,
    data: { ...profile(), user: restricted },
  });
  await logging;

  const view = await mountOverview();
  try {
    assert.equal(auth.authenticated, true);
    assert.equal(auth.accountStatus, "restricted");
    await view.openMenu();
    assert.match(view.text(), /账号受限 · 未认证/);
    assert.doesNotMatch(view.text(), /账号正常/);
  } finally {
    view.app.unmount();
  }
});
