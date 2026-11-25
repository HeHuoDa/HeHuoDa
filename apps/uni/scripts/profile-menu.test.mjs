import assert from "node:assert/strict";
import { after, test } from "node:test";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { mount, textOf } from "./component-host.mjs";

const CLIENT_DOUBLE = `
import { createHttpClient } from "./http.ts";
const transport = (options) => {
  globalThis.__profileRequests = globalThis.__profileRequests ?? [];
  globalThis.__profileRequests.push(options);
  return { abort() {} };
};
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

const { useAuthStore } = await import("../src/stores/auth.ts");
const { useSessionStore } = await import("../src/stores/session.ts");

const tick = () => new Promise((resolve) => setImmediate(resolve));

function installPlatform(uniPlatform = "web") {
  globalThis.__profileRequests = [];
  globalThis.uni = {
    getSystemInfoSync: () => ({ uniPlatform }),
    getWindowInfo: () => ({ windowHeight: 800 }),
    onKeyboardHeightChange() {},
    onWindowResize() {},
    offWindowResize() {},
    offKeyboardHeightChange() {},
    hideTabBar() {},
    showTabBar() {},
  };
  globalThis.getCurrentPages = () => [{ route: "pages/profile/index" }];
  return () => globalThis.__profileRequests;
}

async function mountOverview(platform = "H5") {
  const app = await mount(
    "../src/components/ProfileOverview.vue",
    {},
    platform,
  );
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
      (n) =>
        (n.type === "button" || n.props.role === "button") &&
        n.props.onClick &&
        textOf(n).includes(label),
    );
    assert.ok(node, `找不到按钮：${label}`);
    node.props.onClick();
    await nextTick();
  };
  const input = async (id, value) => {
    const node = app.find((n) => n.type === "input" && n.props.id === id);
    assert.ok(node, `找不到输入框：${id}`);
    if (platform === "H5") node.props.onInput({ target: { value } });
    else node.props.onInput({ detail: { value } });
    await nextTick();
  };
  return {
    app,
    text,
    trigger,
    openMenu,
    menuItem,
    clickItem,
    clickButton,
    input,
  };
}

for (const platform of ["MP-WEIXIN", "H5"]) {
  test(`${platform} 游客态区分游客与学校账号，无微信登录与联系方式授权`, async () => {
    installPlatform(platform === "H5" ? "web" : "mp-weixin");
    setActivePinia(createPinia());
    const view = await mountOverview(platform);
    try {
      assert.equal(view.trigger().props["aria-expanded"], false);
      assert.match(view.text(), /游客浏览/);
      await view.openMenu();
      assert.equal(view.trigger().props["aria-expanded"], true);
      for (const label of ["使用学校账号登录", "编辑示例资料", "关于我们"])
        assert.ok(view.menuItem(label), label);
      for (const gone of ["微信登录", "退出登录", "重置示例", "联系方式授权"]) {
        assert.equal(view.menuItem(gone), undefined, gone);
        assert.doesNotMatch(view.text(), new RegExp(gone));
      }
      assert.equal(
        view.app.find((n) => n.type === "switch"),
        undefined,
      );
      assert.equal(
        view.app.find((n) => n.props.role === "dialog"),
        undefined,
      );
    } finally {
      view.app.unmount();
      delete globalThis.uni;
      delete globalThis.getCurrentPages;
    }
  });
}

test("使用学校账号登录入口跳到登录页，导航失败给出提示且可重试", async () => {
  installPlatform("web");
  setActivePinia(createPinia());
  const navigations = [];
  let fail = true;
  globalThis.uni = {
    ...globalThis.uni,
    navigateTo: (options) =>
      fail ? options.fail?.() : navigations.push(options.url),
  };
  const view = await mountOverview("H5");
  try {
    await view.openMenu();
    await view.clickItem("使用学校账号登录");
    assert.match(textOf(view.app.container), /暂时无法打开登录页/);
    fail = false;
    await view.openMenu();
    await view.clickItem("使用学校账号登录");
    assert.deepEqual(navigations, ["/pages/auth/login"]);
    assert.doesNotMatch(textOf(view.app.container), /暂时无法打开登录页/);
  } finally {
    view.app.unmount();
    delete globalThis.uni;
    delete globalThis.getCurrentPages;
  }
});

test("H5 登录态展示服务端账号与昵称，支持 PATCH 改昵称与退出重试，并保留临时收藏", async () => {
  const getReqs = installPlatform("web");
  setActivePinia(createPinia());
  const auth = useAuthStore();
  const session = useSessionStore();
  session.addFavorite("comp-101");

  const loginPending = auth.applySchoolLogin({
    kind: "active",
    user: { id: "u-1", nickname: "禾伙搭用户", status: "active" },
    accessToken: "at-1",
    accessExpiresAt: "2099-01-01T00:15:00.000Z",
    sessionExpiresAt: "2099-02-01T00:00:00.000Z",
  });
  await tick();
  assert.equal(getReqs().at(-1).url, "/api/v1/auth/me");
  getReqs()
    .at(-1)
    .success({
      statusCode: 200,
      data: {
        user: { id: "u-1", nickname: "禾伙搭用户", status: "active" },
        campus: {
          status: "valid",
          termId: "2026-fall",
          verifiedAt: "2026-10-25T10:00:00.000Z",
          validUntil: "2027-01-31T16:00:00.000Z",
          maskedAccountNumber: "••••56",
        },
        availability: { teaming: false },
      },
    });
  await loginPending;

  const view = await mountOverview("H5");
  try {
    assert.match(view.text(), /禾伙搭用户/);
    assert.match(view.text(), /校园身份已验证/);
    assert.match(view.text(), /校园账号 ••••56/);
    assert.equal(session.favoriteCount, 1);

    // 打开修改昵称弹窗并保存
    await view.clickButton("修改昵称");
    await view.input("account-nickname", "  向阳花  ");
    await view.clickButton("保存昵称");
    await tick();

    const patchReq = getReqs().at(-1);
    assert.equal(patchReq.method, "PATCH");
    assert.equal(patchReq.url, "/api/v1/auth/me");
    assert.equal(patchReq.header.Authorization, "Bearer at-1");
    assert.deepEqual(patchReq.data, { nickname: "向阳花" });

    patchReq.success({
      statusCode: 200,
      data: {
        user: { id: "u-1", nickname: "向阳花", status: "active" },
        campus: {
          status: "valid",
          termId: "2026-fall",
          verifiedAt: "2026-10-25T10:00:00.000Z",
          validUntil: "2027-01-31T16:00:00.000Z",
        },
        availability: { teaming: false },
      },
    });
    await tick();
    await nextTick();
    assert.equal(auth.nickname, "向阳花");
    assert.match(view.text(), /账号昵称已更新/);

    // 退出失败保留远端未确认提示与重试按钮，同时保留临时收藏
    await view.clickButton("退出登录");
    await tick();
    const logoutReq = getReqs().at(-1);
    assert.equal(logoutReq.url, "/api/v1/auth/logout");
    assert.equal(logoutReq.withCredentials, true);
    assert.equal(logoutReq.header["X-Refresh-CSRF"], "1");
    assert.equal(logoutReq.header.Authorization, undefined);
    logoutReq.fail({ errMsg: "request:fail" });
    await tick();
    await nextTick();

    assert.equal(auth.authenticated, false);
    assert.equal(auth.logoutRemoteUnconfirmed, true);
    assert.equal(session.favoriteCount, 1, "退出不得清空游客临时收藏");
    assert.match(view.text(), /远端会话未能确认撤销/);

    await view.clickButton("重试撤销远端会话");
    await tick();
    getReqs().at(-1).success({ statusCode: 204, data: "" });
    await tick();
    await nextTick();
    assert.equal(auth.logoutRemoteUnconfirmed, false);
    assert.equal(session.favoriteCount, 1);
  } finally {
    view.app.unmount();
    delete globalThis.uni;
    delete globalThis.getCurrentPages;
  }
});

test("示例资料保存只影响当前会话，昵称保持只读且不写账号", async () => {
  installPlatform("mp-weixin");
  setActivePinia(createPinia());
  const session = useSessionStore();
  const view = await mountOverview("MP-WEIXIN");
  try {
    assert.doesNotMatch(textOf(view.app.container), /待接入|微信用户/);
    assert.match(textOf(view.app.container), /收藏比赛/);
    await view.openMenu();
    await view.clickItem("编辑示例资料");
    const nickname = view.app.find((n) => n.props.id === "profile-nickname");
    assert.equal(nickname.props.disabled, true);
    assert.equal(nickname.props.value, session.profile.nickname);
    await view.input("profile-skills", " 编程,设计、编程 ");
    await view.clickButton("保存资料");
    assert.equal(session.profile.skills, "编程、设计");
    assert.match(textOf(view.app.container), /仅保留在当前会话内/);
    assert.match(textOf(view.app.container), /刷新恢复初始示例/);
  } finally {
    view.app.unmount();
    delete globalThis.uni;
    delete globalThis.getCurrentPages;
  }
});

test("个人中心快捷入口只剩收藏与通知，不再通往暂缓的队伍与申请", async () => {
  installPlatform("web");
  setActivePinia(createPinia());
  const view = await mountOverview("H5");
  try {
    const labels = view.app.container.children
      .flatMap((node) => node.children ?? [])
      .map(textOf)
      .join("\n");
    assert.match(labels, /我的收藏/);
    assert.match(labels, /站内通知/);
    assert.doesNotMatch(labels, /我的队伍|申请与邀请/);
  } finally {
    view.app.unmount();
    delete globalThis.uni;
    delete globalThis.getCurrentPages;
  }
});

test("H5 会话 401 失效退回游客时保留临时收藏且不强制跳转", async () => {
  const navigations = [];
  const getReqs = installPlatform("web");
  globalThis.uni = {
    ...globalThis.uni,
    switchTab: (o) => navigations.push(o.url),
    navigateTo: (o) => navigations.push(o.url),
    redirectTo: (o) => navigations.push(o.url),
    reLaunch: (o) => navigations.push(o.url),
  };
  setActivePinia(createPinia());
  const auth = useAuthStore();
  const session = useSessionStore();
  session.addFavorite("comp-guest-1");

  let loginError = null;
  const loginPending = auth
    .applySchoolLogin({
      kind: "active",
      user: { id: "u-1", nickname: "禾伙搭用户", status: "active" },
      accessToken: "at-expired",
      accessExpiresAt: "2099-01-01T00:15:00.000Z",
      sessionExpiresAt: "2099-02-01T00:00:00.000Z",
    })
    .catch((error) => {
      loginError = error;
    });
  await tick();
  getReqs()
    .at(-1)
    .success({
      statusCode: 401,
      data: { code: "UNAUTHORIZED", message: "expired" },
    });
  await tick();
  const last = getReqs().at(-1);
  if (last && last.url === "/api/v1/auth/refresh") {
    last.success({
      statusCode: 401,
      data: { code: "INVALID_REFRESH_TOKEN", message: "invalid" },
    });
  }
  await loginPending;
  assert.ok(loginError);
  assert.equal(auth.authenticated, false);
  assert.equal(auth.phase, "anonymous");
  assert.equal(session.favoriteCount, 1);
  assert.deepEqual(
    session.favorites.map((item) => item.id),
    ["comp-guest-1"],
  );
  assert.deepEqual(navigations, []);

  delete globalThis.uni;
  delete globalThis.getCurrentPages;
});
