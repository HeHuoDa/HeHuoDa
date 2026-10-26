import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryHistory, createRouter } from "vue-router";
import {
  installH5Router,
  prepareH5PageAddress,
  replaceH5TabQuery,
} from "../src/navigation/h5-router.ts";
import { routeRegistry } from "../src/navigation/routes.ts";

globalThis.location = { origin: "https://example.test" };
globalThis.document = { title: "" };

function router() {
  const instance = createRouter({
    history: createMemoryHistory(),
    routes: [
      ...Object.values(routeRegistry).map(({ path }) => ({
        path,
        component: {},
      })),
      { path: "/:pathMatch(.*)*", component: {} },
    ],
  });
  installH5Router(instance);
  return instance;
}

test(
  "显式 uni 跳转修正再次编码，仍新增历史项且后退保留列表条件",
  { timeout: 3000 },
  async () => {
    const instance = router();
    await instance.push("/pages/teams/index?q=%E8%AF%BE%E7%A8%8B");
    prepareH5PageAddress(
      "/pages/teams/detail?id=demo-2&q=%E8%AF%BE%E7%A8%8B&utm=%252F",
    );
    await instance.push(
      "/pages/teams/detail?id=demo-2&q=%25E8%25AF%25BE%25E7%25A8%258B&utm=%25252F",
    );
    assert.equal(instance.currentRoute.value.query.q, "课程");
    assert.equal(instance.currentRoute.value.query.utm, "%2F");
    await new Promise((resolve) => {
      const stop = instance.afterEach(() => {
        stop();
        resolve();
      });
      instance.back();
    });
    assert.equal(instance.currentRoute.value.path, "/pages/teams/index");
    assert.equal(instance.currentRoute.value.query.q, "课程");
  },
);

test("原生深链不额外解码，未知页面与未知业务 ID 分别交给路由和页面", async () => {
  const instance = router();
  await instance.push("/pages/teams/detail?id=unknown&utm=%252F");
  assert.equal(instance.currentRoute.value.path, "/pages/teams/detail");
  assert.equal(instance.currentRoute.value.query.utm, "%2F");
  await instance.push("/bad-page");
  assert.equal(instance.currentRoute.value.path, "/pages/not-found/index");
});

test("失败的显式跳转清理地址意图，后续深链不会被旧参数覆盖", async () => {
  const instance = router();
  const complete = prepareH5PageAddress("/pages/teams/detail?id=old");
  complete();
  await instance.push("/pages/teams/detail?id=new");
  assert.equal(instance.currentRoute.value.query.id, "new");
});

test("从其他 tab 切回首页：根路径转成首页而不是 404", async () => {
  const instance = router();
  await instance.push("/pages/teams/index");
  // uni H5 的 tabBar 把入口页归一化成 `/` 提交，不是 `/pages/index/index`。
  await instance.push("/");
  assert.equal(instance.currentRoute.value.path, "/pages/index/index");
  assert.equal(instance.currentRoute.value.query.hosts, "all");
});

test("tab 交接保留通知稳定 ID 及重复附加参数，标题沿注册表", async () => {
  const instance = router();
  await instance.push("/pages/profile/index");
  replaceH5TabQuery("profile", {
    section: "applications",
    recordId: "history-0",
    revision: "0",
    utm: ["a", "b"],
  });
  await new Promise((resolve) => {
    const stop = instance.afterEach(() => {
      stop();
      resolve();
    });
  });
  assert.equal(instance.currentRoute.value.query.recordId, "history-0");
  assert.deepEqual(instance.currentRoute.value.query.utm, ["a", "b"]);
  assert.equal(globalThis.document.title, "个人中心 · 禾伙搭");
});
