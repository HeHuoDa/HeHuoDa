import assert from "node:assert/strict";
import { test } from "node:test";
import { colleges } from "@hehuoda/client-domain/colleges";
import {
  createDiscoveryController,
  initialDiscoveryState,
} from "../src/stores/discovery-controller.ts";

const directory = colleges.map((c, order) => ({
  id: c.id,
  name: c.name,
  order,
}));
const empty = {
  items: [],
  page: 1,
  pageSize: 4,
  hasMore: false,
  totalStages: 0,
  totalCompetitions: 0,
  totalPages: 1,
  evaluatedAt: "2026-10-19T00:00:00Z",
};
function pending() {
  let resolve, reject;
  const request = {
    promise: new Promise((a, b) => {
      resolve = a;
      reject = b;
    }),
    cancelCount: 0,
    cancel() {
      this.cancelCount++;
    },
  };
  return { request, resolve, reject };
}
function setup() {
  const state = initialDiscoveryState();
  const dirs = [],
    lists = [];
  const controller = createDiscoveryController(state, {
    colleges() {
      const p = pending();
      dirs.push(p);
      return p.request;
    },
    list(filters) {
      const p = pending();
      lists.push({ ...p, filters });
      return p.request;
    },
  });
  return { state, dirs, lists, controller };
}
const flush = () => new Promise((r) => setImmediate(r));

test("目录核对后才查询，筛选请求取消与迟到响应隔离，目录在页面内复用", async () => {
  const { state, dirs, lists, controller } = setup();
  const first = controller.load();
  assert.equal(state.directoryStatus, "loading");
  assert.equal(state.response, null);
  assert.equal(lists.length, 0);
  dirs[0].resolve(directory);
  await flush();
  assert.equal(lists.length, 1);
  const second = controller.update({ q: "B", page: 8 });
  assert.equal(state.filters.page, 1);
  assert.equal(lists[0].request.cancelCount, 1);
  lists[1].resolve({ ...empty, evaluatedAt: "2026-10-19T01:00:00Z" });
  await second;
  lists[0].resolve(empty);
  await first;
  assert.equal(state.response.evaluatedAt, "2026-10-19T01:00:00Z");
  assert.equal(dirs.length, 1);
});

test("目录失败与不一致均阻止比赛请求，重试成功后查询", async () => {
  const { state, dirs, lists, controller } = setup();
  const first = controller.load();
  dirs[0].resolve(directory.slice(1));
  await first;
  assert.equal(state.directoryStatus, "error");
  assert.match(state.error, /学院目录与页面资源不一致/);
  assert.equal(lists.length, 0);
  const second = controller.load();
  dirs[1].reject(new Error("测试目录断网"));
  await second;
  assert.equal(state.directoryStatus, "error");
  assert.equal(state.response, null);
  const retry = controller.load();
  dirs[2].resolve(directory);
  await flush();
  lists[0].resolve(empty);
  await retry;
  assert.equal(state.status, "ready");
});

test("未选学院不会回退全部，查询失败不伪造空列表；翻页服从服务端纠正", async () => {
  const { state, dirs, lists, controller } = setup();
  const first = controller.update({ hosts: [] });
  dirs[0].resolve(directory);
  await flush();
  assert.deepEqual(lists[0].filters.hosts, []);
  lists[0].reject(new Error("测试比赛断网"));
  await first;
  assert.equal(state.status, "error");
  assert.equal(state.response, null);
  const retry = controller.page(99);
  assert.equal(lists[1].filters.page, 99);
  lists[1].resolve(empty);
  await retry;
  assert.equal(state.filters.page, 1);
  assert.deepEqual(state.filters.hosts, []);
});

test("离页使旧请求失效，返回保持关键词与页码，已完成结果无需重复请求", async () => {
  const { state, dirs, lists, controller } = setup();
  const initial = controller.update({ q: "校园" });
  dirs[0].resolve(directory);
  await flush();
  controller.cancel();
  const resumed = controller.resume();
  lists[1].resolve(empty);
  await resumed;
  lists[0].reject(new Error("迟到失败"));
  await initial;
  assert.equal(state.status, "ready");
  assert.equal(state.filters.q, "校园");
  controller.cancel();
  await controller.resume();
  assert.equal(lists.length, 2);
  const page = controller.page(4);
  controller.cancel();
  const returned = controller.resume();
  assert.equal(lists[3].filters.page, 4);
  lists[3].resolve({ ...empty, page: 2 });
  await returned;
  lists[2].resolve(empty);
  await page;
  assert.equal(state.filters.page, 2);
});

test("目录加载中换筛选或离页，旧目录无法触发查询或覆盖状态", async () => {
  const { state, dirs, lists, controller } = setup();
  const first = controller.load();
  const second = controller.update({ status: "closed" });
  assert.equal(dirs[0].request.cancelCount, 1);
  dirs[0].resolve(directory);
  await first;
  assert.equal(lists.length, 0);
  controller.cancel();
  dirs[1].resolve(directory);
  await second;
  assert.equal(state.status, "idle");
  assert.equal(state.directoryStatus, "idle");
});
