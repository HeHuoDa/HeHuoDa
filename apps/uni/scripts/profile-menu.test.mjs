import assert from "node:assert/strict";
import { after, test } from "node:test";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { mount, textOf } from "./component-host.mjs";
import { useSessionStore } from "../src/stores/session.ts";

/**
 * 个人中心在 M1 的收口行为：账号下拉只说明登录未开放，联系方式授权与
 * 重置示例入口已移除；示例资料编辑仍只影响当前会话。
 */
const loader = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && !extname(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return next(url.href, context);
    }
    return next(specifier, context);
  },
});
after(() => loader.deregister());

function installPlatform() {
  globalThis.uni = {
    getWindowInfo: () => ({ windowHeight: 800 }),
    onKeyboardHeightChange() {},
    onWindowResize() {},
    offWindowResize() {},
    offKeyboardHeightChange() {},
    hideTabBar() {},
    showTabBar() {},
  };
  globalThis.getCurrentPages = () => [{ route: "pages/profile/index" }];
}

async function mountOverview(platform = "MP-WEIXIN") {
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
      (n) => n.type === "button" && textOf(n).includes(label),
    );
    assert.ok(node, `找不到按钮：${label}`);
    node.props.onClick();
    await nextTick();
  };
  const input = async (id, value) => {
    app
      .find((n) => n.type === "input" && n.props.id === id)
      .props.onInput({ detail: { value } });
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
  test(`${platform} 账号下拉只说明认证未开放，无微信登录、联系方式授权与重置示例`, async () => {
    installPlatform();
    setActivePinia(createPinia());
    const view = await mountOverview(platform);
    try {
      assert.equal(view.trigger().props["aria-expanded"], false);
      await view.openMenu();
      assert.equal(view.trigger().props["aria-expanded"], true);
      assert.match(view.text(), /免登录浏览/);
      assert.match(view.text(), /统一身份认证登录即将开放/);
      for (const label of ["登录说明", "编辑资料", "关于我们"])
        assert.ok(view.menuItem(label), label);
      for (const gone of ["微信登录", "退出登录", "重置示例", "联系方式授权"]) {
        assert.equal(view.menuItem(gone), undefined, gone);
        assert.doesNotMatch(view.text(), new RegExp(gone));
      }
      assert.equal(
        view.app.find((n) => n.type === "switch"),
        undefined,
        "不提供联系方式演示授权开关",
      );
      assert.equal(
        view.app.find((n) => n.props.role === "dialog"),
        undefined,
        "重置示例入口与确认弹窗一并移除",
      );
    } finally {
      view.app.unmount();
      delete globalThis.uni;
      delete globalThis.getCurrentPages;
    }
  });
}

test("登录说明入口跳到登录页，导航失败给出提示", async () => {
  installPlatform();
  setActivePinia(createPinia());
  const navigations = [];
  let fail = true;
  globalThis.uni = {
    ...globalThis.uni,
    navigateTo: (options) =>
      fail ? options.fail?.() : navigations.push(options.url),
  };
  const view = await mountOverview();
  try {
    await view.openMenu();
    await view.clickItem("登录说明");
    assert.match(textOf(view.app.container), /暂时无法打开登录页/);
    fail = false;
    await view.openMenu();
    await view.clickItem("登录说明");
    assert.deepEqual(navigations, ["/pages/auth/login"]);
    assert.doesNotMatch(textOf(view.app.container), /暂时无法打开登录页/);
  } finally {
    view.app.unmount();
    delete globalThis.uni;
    delete globalThis.getCurrentPages;
  }
});

test("示例资料保存只影响当前会话，昵称保持只读且不写账号", async () => {
  installPlatform();
  setActivePinia(createPinia());
  const session = useSessionStore();
  const view = await mountOverview();
  try {
    assert.doesNotMatch(textOf(view.app.container), /待接入|微信用户/);
    assert.match(textOf(view.app.container), /收藏比赛/);
    await view.openMenu();
    await view.clickItem("编辑资料");
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
  installPlatform();
  setActivePinia(createPinia());
  const view = await mountOverview();
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
