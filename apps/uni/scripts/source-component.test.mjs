import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { after, test } from "node:test";
import { nextTick } from "vue";
import { mount, textOf } from "./component-host.mjs";
import { detail } from "./fixtures/competition-detail.mjs";

const apiModule = `data:text/javascript,${encodeURIComponent(`
  import { createCompetitionApi } from ${JSON.stringify(new URL("../src/api/competition-client.ts", import.meta.url).href)};
  import { createHttpClient } from ${JSON.stringify(new URL("../src/api/http.ts", import.meta.url).href)};
  export const competitionApi = createCompetitionApi(createHttpClient(options => globalThis.uni.request(options), () => ({baseUrl:'/api/v1', timeout:5000})));
`)}`;

const loader = registerHooks({
  resolve(name, context, next) {
    if (name.endsWith("/api/competitions.ts"))
      return { url: apiModule, shortCircuit: true };
    if (name.startsWith(".") && !extname(name)) {
      const url = new URL(`${name}.ts`, context.parentURL);
      if (existsSync(url)) return next(url.href, context);
    }
    return next(name, context);
  },
});

test("列表按需读取当前赛段真实 Notice；失败可重试，切换条目不保留旧链接", async () => {
  const original = globalThis.uni,
    oldHooks = globalThis.__formPageHooks;
  const requests = [],
    copies = [];
  globalThis.__formPageHooks = [];
  globalThis.uni = {
    request: (options) => {
      requests.push(options);
      return { abort() {} };
    },
    setClipboardData: (options) => {
      copies.push(options.data);
      options.success();
    },
  };
  const app = await mount(
    "../src/components/CompetitionSources.vue",
    { competitionId: "competition-a", stageId: "stage-a" },
    "APP-PLUS",
  );
  try {
    const button = (label) =>
      app.find(
        (node) =>
          (node.type === "button" || node.props.role === "button") &&
          textOf(node).includes(label),
      );
    assert.equal(requests.length, 0);
    button("查看官方来源").props.onClick();
    await nextTick();
    assert.match(textOf(app.container), /正在读取/);
    requests[0].fail({ errMsg: "network failure" });
    await flush();
    assert.ok(button("重试来源"));
    button("重试来源").props.onClick();
    requests[1].success({ statusCode: 200, data: detail() });
    await flush();
    // compact 来源在非 H5 端的主操作是「复制链接」，与 H5 安全外链区分。
    button("复制链接").props.onClick();
    await flush();
    assert.deepEqual(copies, [detail().notices[0].url]);
    app.render({ competitionId: "competition-b", stageId: "stage-a" });
    await nextTick();
    assert.doesNotMatch(textOf(app.container), /example.edu.cn/);
    button("查看官方来源").props.onClick();
    const latest = detail("competition-b");
    latest.notices = [];
    requests[2].success({ statusCode: 200, data: latest });
    await flush();
    assert.match(textOf(app.container), /暂无可用官方来源/);
    globalThis.__formPageHooks.forEach((fn) => fn());
    await nextTick();
    assert.ok(button("查看官方来源"));
  } finally {
    app.unmount();
    globalThis.uni = original;
    globalThis.__formPageHooks = oldHooks;
  }
});
after(() => loader.deregister());
const flush = async () => {
  await new Promise((r) => setImmediate(r));
  await nextTick();
};

test("App-Plus 来源组件操作当前 Notice，失败保留可选择地址；切换与卸载清理迟到反馈", async () => {
  const original = globalThis.uni;
  const calls = [];
  const navigations = [];
  let failNextNavigation = false;
  globalThis.uni = {
    setClipboardData: (options) => calls.push(options),
    navigateTo: (options) => {
      navigations.push(options);
      if (failNextNavigation) options.fail?.({ errMsg: "navigateTo:fail" });
      else options.success?.();
    },
  };
  const notice = detail().notices[0];
  const app = await mount(
    "../src/components/CompetitionSourceAction.vue",
    { notice, compact: true },
    "APP-PLUS",
  );
  try {
    const copyButton = () =>
      app.find(
        (node) =>
          (node.type === "button" || node.props.role === "button") &&
          textOf(node).includes("复制链接"),
      );
    copyButton().props.onClick();
    await flush();
    assert.equal(calls[0].data, notice.url);
    assert.doesNotMatch(textOf(app.container), /已复制/);
    const next = {
      ...notice,
      id: "notice-b",
      url: "https://news.example.edu.cn/new",
    };
    app.render({ notice: next, compact: true });
    await nextTick();
    calls[0].success();
    await flush();
    assert.doesNotMatch(textOf(app.container), /已复制/);
    copyButton().props.onClick();
    await flush();
    assert.equal(calls[1].data, next.url);
    calls[1].fail({ errMsg: "privacy denied" });
    await flush();
    assert.match(textOf(app.container), /手动复制/);
    assert.match(textOf(app.container), /https:\/\/news.example.edu.cn\/new/);
    assert.ok(
      app.find((node) => node.type === "text" && node.props.selectable),
    );
    // 非 H5 端的「原文」入口走本地来源直达页，而不是内嵌承载。
    const openButton = () =>
      app.find(
        (node) =>
          (node.type === "button" || node.props.role === "button") &&
          textOf(node).includes("原文"),
      );
    openButton().props.onClick();
    await flush();
    assert.equal(navigations.length, 1);
    assert.equal(
      navigations[0].url,
      `/pages/source/index?url=${encodeURIComponent(next.url)}&title=${encodeURIComponent(next.title)}`,
    );
    // 导航失败必须落到可取选地址的手动回退，不留空白或死链。
    failNextNavigation = true;
    openButton().props.onClick();
    await flush();
    assert.equal(navigations.length, 2);
    assert.match(textOf(app.container), /暂时无法打开原文页面/);
    assert.match(
      textOf(app.container),
      /https:\/\/news\.example\.edu\.cn\/new/,
    );
    failNextNavigation = false;
    copyButton().props.onClick();
    app.unmount();
    calls[2]?.success();
    await flush();
  } finally {
    app.unmount();
    globalThis.uni = original;
  }
});

test("App-Plus 迟到导航失败不得覆盖新的复制成功反馈", async () => {
  const original = globalThis.uni;
  const calls = [];
  const navigations = [];
  globalThis.uni = {
    setClipboardData: (options) => calls.push(options),
    // 截留导航回调，模拟失败结果在复制成功之后才交付。
    navigateTo: (options) => navigations.push(options),
  };
  const notice = detail().notices[0];
  const app = await mount(
    "../src/components/CompetitionSourceAction.vue",
    { notice, compact: true },
    "APP-PLUS",
  );
  try {
    const button = (label) =>
      app.find(
        (node) =>
          (node.type === "button" || node.props.role === "button") &&
          textOf(node).includes(label),
      );
    button("原文").props.onClick();
    await flush();
    assert.equal(navigations.length, 1);
    assert.equal(
      navigations[0].url,
      `/pages/source/index?url=${encodeURIComponent(notice.url)}&title=${encodeURIComponent(notice.title)}`,
    );
    button("复制链接").props.onClick();
    await flush();
    assert.deepEqual(
      calls.map((call) => call.data),
      [notice.url],
    );
    calls[0].success();
    await flush();
    assert.match(textOf(app.container), /官方链接已复制/);
    navigations[0].fail({ errMsg: "navigateTo:fail" });
    await flush();
    assert.match(textOf(app.container), /官方链接已复制/);
    assert.doesNotMatch(textOf(app.container), /暂时无法打开原文页面/);
  } finally {
    app.unmount();
    globalThis.uni = original;
  }
});

test("App-Plus 迟到导航失败不得把旧地址挂到切换后的 Notice 下", async () => {
  const original = globalThis.uni;
  const navigations = [];
  globalThis.uni = {
    setClipboardData: () => {},
    // 截留导航回调，模拟同一条 Notice 换地址之后才交付旧失败。
    navigateTo: (options) => navigations.push(options),
  };
  const notice = detail().notices[0];
  const app = await mount(
    "../src/components/CompetitionSourceAction.vue",
    { notice, compact: true },
    "APP-PLUS",
  );
  try {
    app
      .find(
        (node) =>
          (node.type === "button" || node.props.role === "button") &&
          textOf(node).includes("原文"),
      )
      .props.onClick();
    await flush();
    assert.equal(navigations.length, 1);
    assert.equal(
      navigations[0].url,
      `/pages/source/index?url=${encodeURIComponent(notice.url)}&title=${encodeURIComponent(notice.title)}`,
    );
    app.render({
      notice: { ...notice, url: "https://news.example.edu.cn/new" },
      compact: true,
    });
    await nextTick();
    navigations[0].fail({ errMsg: "navigateTo:fail" });
    await flush();
    assert.doesNotMatch(textOf(app.container), /example\.edu\.cn\/news/);
    assert.doesNotMatch(textOf(app.container), /暂时无法打开原文页面/);
  } finally {
    app.unmount();
    globalThis.uni = original;
  }
});

test("App-Plus 复制在途时点原文，剪贴板返回后复制按钮恢复可点", async () => {
  const original = globalThis.uni;
  const calls = [];
  const navigations = [];
  globalThis.uni = {
    // 截留剪贴板回调，模拟复制与导航交错。
    setClipboardData: (options) => calls.push(options),
    navigateTo: (options) => navigations.push(options),
  };
  const notice = detail().notices[0];
  const app = await mount(
    "../src/components/CompetitionSourceAction.vue",
    { notice, compact: true },
    "APP-PLUS",
  );
  try {
    const button = (label) =>
      app.find(
        (node) =>
          (node.type === "button" || node.props.role === "button") &&
          textOf(node).includes(label),
      );
    button("复制链接").props.onClick();
    await flush();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].data, notice.url);
    // 宿主节点的 loading 是组件 prop，不进 DOM；按 FormButton 的可达性属性断言。
    assert.equal(button("复制链接").props["aria-busy"], true);
    assert.equal(button("复制链接").props.tabindex, -1);
    // 复制未决时仍可点原文；导航占了反馈代次，但不得锁死复制按钮。
    button("原文").props.onClick();
    await flush();
    assert.equal(navigations.length, 1);
    assert.equal(button("原文").props["aria-busy"], true);
    calls[0].success();
    await flush();
    assert.ok(!button("复制链接").props["aria-busy"]);
    assert.notEqual(button("复制链接").props.tabindex, -1);
    // 旧复制结果不得写进已被导航占据的 feedback。
    assert.doesNotMatch(textOf(app.container), /官方链接已复制/);
    // 复制动作也不得影响导航自身的在途状态。
    assert.equal(button("原文").props["aria-busy"], true);
    button("复制链接").props.onClick();
    await flush();
    assert.equal(calls.length, 2);
    assert.equal(calls[1].data, notice.url);
    calls[1].success();
    await flush();
  } finally {
    app.unmount();
    globalThis.uni = original;
  }
});

test("App-Plus 旧导航迟到成功不得清掉新导航的 opening", async () => {
  const original = globalThis.uni;
  const navigations = [];
  globalThis.uni = {
    setClipboardData: () => {},
    navigateTo: (options) => navigations.push(options),
  };
  const notice = detail().notices[0];
  const app = await mount(
    "../src/components/CompetitionSourceAction.vue",
    { notice, compact: true },
    "APP-PLUS",
  );
  try {
    const openButton = () =>
      app.find(
        (node) =>
          (node.type === "button" || node.props.role === "button") &&
          textOf(node).includes("原文"),
      );
    openButton().props.onClick();
    await flush();
    assert.equal(navigations.length, 1);
    app.render({
      notice: {
        ...notice,
        id: "notice-b",
        url: "https://news.example.edu.cn/new",
      },
      compact: true,
    });
    await nextTick();
    openButton().props.onClick();
    await flush();
    assert.equal(navigations.length, 2);
    assert.equal(openButton().props["aria-busy"], true);
    // 旧导航的迟到成功不得提前结束新导航的在途状态，否则防重入失效。
    navigations[0].success();
    await flush();
    assert.equal(openButton().props["aria-busy"], true);
    navigations[1].success();
    await flush();
    assert.ok(!openButton().props["aria-busy"]);
  } finally {
    app.unmount();
    globalThis.uni = original;
  }
});

test("App-Plus 旧导航迟到失败不得清掉新导航的 opening", async () => {
  const original = globalThis.uni;
  const navigations = [];
  globalThis.uni = {
    setClipboardData: () => {},
    navigateTo: (options) => navigations.push(options),
  };
  const notice = detail().notices[0];
  const app = await mount(
    "../src/components/CompetitionSourceAction.vue",
    { notice, compact: true },
    "APP-PLUS",
  );
  try {
    const openButton = () =>
      app.find(
        (node) =>
          (node.type === "button" || node.props.role === "button") &&
          textOf(node).includes("原文"),
      );
    openButton().props.onClick();
    await flush();
    assert.equal(navigations.length, 1);
    app.render({
      notice: {
        ...notice,
        id: "notice-b",
        url: "https://news.example.edu.cn/new",
      },
      compact: true,
    });
    await nextTick();
    openButton().props.onClick();
    await flush();
    assert.equal(navigations.length, 2);
    assert.equal(openButton().props["aria-busy"], true);
    navigations[0].fail({ errMsg: "navigateTo:fail" });
    await flush();
    assert.equal(openButton().props["aria-busy"], true);
    // 旧导航的迟到失败也不得把旧地址挂到切换后的 Notice 下。
    assert.doesNotMatch(textOf(app.container), /暂时无法打开原文页面/);
    assert.doesNotMatch(textOf(app.container), /example\.edu\.cn\/news/);
    // 当前代次的导航失败仍须给出可取选地址的手动回退。
    navigations[1].fail({ errMsg: "navigateTo:fail" });
    await flush();
    assert.ok(!openButton().props["aria-busy"]);
    assert.match(textOf(app.container), /暂时无法打开原文页面/);
    assert.match(textOf(app.container), /news\.example\.edu\.cn\/new/);
  } finally {
    app.unmount();
    globalThis.uni = original;
  }
});

test("H5 完整和 compact 来源使用安全原生链接，危险地址没有可点击链接", async () => {
  const notice = detail().notices[0];
  for (const compact of [false, true]) {
    const app = await mount(
      "../src/components/CompetitionSourceAction.vue",
      { notice, compact },
      "H5",
    );
    try {
      const anchor = app.find((node) => node.type === "a");
      assert.equal(anchor.props.href, notice.url);
      assert.equal(anchor.props.target, "_blank");
      assert.equal(anchor.props.rel, "noopener noreferrer");
      const currentNotice = {
        ...notice,
        id: "notice-current",
        url: "https://news.example.edu.cn/current",
      };
      app.render({ notice: currentNotice, compact });
      await nextTick();
      assert.equal(
        app.find((node) => node.type === "a").props.href,
        currentNotice.url,
      );
      app.render({
        notice: { ...notice, url: "javascript:alert(1)" },
        compact,
      });
      await nextTick();
      assert.equal(
        app.find((node) => node.type === "a"),
        undefined,
      );
      assert.match(textOf(app.container), /地址无效/);
    } finally {
      app.unmount();
    }
  }
});

test("来源直达页不使用路由参数绕过校验，仍提供当前链接和可操作回退", async () => {
  const original = globalThis.uni;
  const originalHooks = globalThis.__pageLoadHooks;
  globalThis.__pageLoadHooks = [];
  let copied;
  globalThis.uni = {
    setClipboardData: (options) => {
      copied = options.data;
      options.fail();
    },
    navigateTo: (options) => options.success?.(),
  };
  const app = await mount("../src/pages/source/index.vue", {}, "APP-PLUS");
  try {
    const load = globalThis.__pageLoadHooks[0];
    load({ url: "https://news.example.edu.cn/a", title: "真实通知标题" });
    await nextTick();
    assert.match(textOf(app.container), /真实通知标题/);
    app
      .find(
        (node) =>
          (node.type === "button" || node.props.role === "button") &&
          textOf(node).includes("复制官方链接"),
      )
      .props.onClick();
    await flush();
    assert.equal(copied, "https://news.example.edu.cn/a");
    assert.match(textOf(app.container), /手动复制/);
    for (const url of [
      "javascript:alert(1)",
      ["https://news.example.edu.cn/a", "https://evil.test"],
    ]) {
      load({ url });
      await nextTick();
      assert.equal(
        app.find(
          (node) =>
            (node.type === "button" || node.props.role === "button") &&
            textOf(node).includes("复制官方链接"),
        ),
        undefined,
      );
      assert.match(textOf(app.container), /地址无效/);
    }
  } finally {
    app.unmount();
    globalThis.uni = original;
    globalThis.__pageLoadHooks = originalHooks;
  }
});
