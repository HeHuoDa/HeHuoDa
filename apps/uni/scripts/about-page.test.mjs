import assert from "node:assert/strict";
import { after, test } from "node:test";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { mount, textOf } from "./component-host.mjs";
import { useNavigationStore } from "../src/stores/navigation.ts";

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

test("关于页公开展示真实查询、会话演示和未开放服务，Logo 失败仍可阅读", async () => {
  setActivePinia(createPinia());
  const app = await mount("../src/pages/about/index.vue");
  try {
    const content = textOf(app.container);
    for (const expected of [
      /一起成长，各有所长。/,
      /四川农业大学校园比赛与项目组队平台/,
      /承办学院.*参赛资格/s,
      /官方报名/,
      /真实公开查询/,
      /会话演示/,
      /刷新.*统一重置/s,
      /站内通知.*官方来源通知/s,
      /默认不共享/,
      /同队有效成员.*所有者授权/s,
      /不收集.*真实联系方式/s,
      /账号.*验证码.*尚未开放/s,
    ])
      assert.match(content, expected);
    assert.doesNotMatch(content, /@|版本号|官方运营|立即注册/);
    const image = app.find(
      (node) => node.props.src === "/static/hehuoda-logo.png",
    );
    assert.ok(image);
    assert.equal(image.props.mode, "aspectFit");
    image.props.onError();
    await nextTick();
    assert.equal(
      app.find((node) => node.props.src === "/static/hehuoda-logo.png"),
      undefined,
    );
    assert.match(textOf(app.container), /禾伙搭.*返回个人中心/s);
  } finally {
    app.unmount();
  }
});

for (const platform of ["H5", "MP-WEIXIN"]) {
  test(`${platform} 关于页有栈/空栈均返回个人资料，双重导航失败可重试且不残留意图`, async () => {
    setActivePinia(createPinia());
    const originalUni = globalThis.uni;
    const originalPages = globalThis.getCurrentPages;
    const destinations = [];
    globalThis.uni = { switchTab: ({ url }) => destinations.push(url) };
    const app = await mount("../src/pages/about/index.vue", {}, platform);
    const clickReturn = async () => {
      app
        .find((node) => textOf(node) === "返回个人中心" && node.props.onClick)
        .props.onClick();
      await nextTick();
    };
    try {
      for (const stack of [
        [{ route: "pages/about/index" }],
        [{ route: "pages/profile/index" }, { route: "pages/about/index" }],
      ]) {
        globalThis.getCurrentPages = () => stack;
        await clickReturn();
        assert.equal(destinations.at(-1), "/pages/profile/index");
        assert.deepEqual(useNavigationStore().consumeProfileNavigation(), {
          section: "profile",
          query: {},
        });
        assert.equal(useNavigationStore().consumeProfileNavigation(), null);
      }
      globalThis.uni = {
        switchTab: ({ fail }) => fail(),
        reLaunch: ({ fail }) => fail(),
      };
      await clickReturn();
      assert.match(textOf(app.container), /暂时无法打开个人中心，请重试/);
      assert.equal(useNavigationStore().pendingProfileNavigation, null);
      globalThis.uni = { switchTab: ({ url }) => destinations.push(url) };
      await clickReturn();
      assert.doesNotMatch(textOf(app.container), /暂时无法/);
    } finally {
      app.unmount();
      globalThis.uni = originalUni;
      globalThis.getCurrentPages = originalPages;
    }
  });

  test(`${platform} 个人中心关于入口可操作，导航失败有提示且可重试`, async () => {
    setActivePinia(createPinia());
    const originalUni = globalThis.uni;
    const originalPages = globalThis.getCurrentPages;
    const destinations = [];
    globalThis.getCurrentPages = () => [{ route: "pages/profile/index" }];
    globalThis.uni = { navigateTo: ({ fail }) => fail() };
    const app = await mount(
      "../src/components/ProfileOverview.vue",
      {},
      platform,
    );
    const activate = async () => {
      const button = app.find(
        (node) => node.props.onClick && textOf(node).includes("关于禾伙搭"),
      );
      assert.ok(button, "关于入口应可操作");
      button.props.onClick();
      await nextTick();
    };
    try {
      await activate();
      assert.match(textOf(app.container), /暂时无法打开关于页面，请重试/);
      globalThis.uni = { navigateTo: ({ url }) => destinations.push(url) };
      await activate();
      assert.deepEqual(destinations, ["/pages/about/index"]);
      assert.doesNotMatch(textOf(app.container), /暂时无法打开关于页面/);
    } finally {
      app.unmount();
      globalThis.uni = originalUni;
      globalThis.getCurrentPages = originalPages;
    }
  });
}
