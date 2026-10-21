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
  const app = await mount("../src/components/CompetitionSources.vue", {
    competitionId: "competition-a",
    stageId: "stage-a",
  });
  try {
    const button = (label) =>
      app.find(
        (node) => node.type === "button" && textOf(node).includes(label),
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
    button("复制官方链接").props.onClick();
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

test("微信来源组件操作当前 Notice，失败保留可选择地址；切换与卸载清理迟到反馈", async () => {
  const original = globalThis.uni;
  const calls = [];
  globalThis.uni = { setClipboardData: (options) => calls.push(options) };
  const notice = detail().notices[0];
  const app = await mount("../src/components/CompetitionSourceAction.vue", {
    notice,
    compact: true,
  });
  try {
    const click = () =>
      app.find((node) => node.type === "button").props.onClick();
    click();
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
    click();
    assert.equal(calls[1].data, next.url);
    calls[1].fail({ errMsg: "privacy denied" });
    await flush();
    assert.match(textOf(app.container), /手动复制/);
    assert.match(textOf(app.container), /https:\/\/news.example.edu.cn\/new/);
    assert.ok(
      app.find((node) => node.type === "text" && node.props.selectable),
    );
    click();
    app.unmount();
    calls[2].success();
    await flush();
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

test("承载页直达不能用路由参数绕过空允许列表，仍提供当前链接和可操作回退", async () => {
  const original = globalThis.uni;
  const originalHooks = globalThis.__pageLoadHooks;
  globalThis.__pageLoadHooks = [];
  let copied;
  globalThis.uni = {
    setClipboardData: (options) => {
      copied = options.data;
      options.fail();
    },
  };
  const app = await mount("../src/pages/source/index.vue");
  try {
    const load = globalThis.__pageLoadHooks[0];
    load({ url: "https://news.example.edu.cn/a", title: "真实通知标题" });
    await nextTick();
    assert.equal(
      app.find((node) => node.type === "web-view"),
      undefined,
    );
    assert.match(textOf(app.container), /真实通知标题/);
    app.find((node) => node.type === "button").props.onClick();
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
        app.find((node) => node.type === "web-view"),
        undefined,
      );
      assert.equal(
        app.find((node) => node.type === "button"),
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
