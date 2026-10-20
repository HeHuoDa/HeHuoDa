import assert from "node:assert/strict";
import { test } from "node:test";
import { reactive } from "vue";
import { detail } from "./fixtures/competition-detail.mjs";
import { RequestError } from "../src/api/http.ts";
import {
  createFavoritesController,
  initialFavoritesState,
} from "../src/stores/favorites-controller.ts";

const flush = () => new Promise((resolve) => setImmediate(resolve));
function setup(ids = []) {
  let order = ids.length;
  const records = reactive(
    ids.map((id, index) => ({ id, order: order - index })),
  );
  const calls = [];
  const state = reactive(initialFavoritesState());
  const controller = createFavoritesController(state, () => records, {
    detail(id) {
      let resolve, reject;
      const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
      const call = { id, resolve, reject, cancelled: false };
      calls.push(call);
      return {
        promise,
        cancel() {
          call.cancelled = true;
        },
      };
    },
  });
  return {
    state,
    controller,
    records,
    calls,
    add(id) {
      records.unshift({ id, order: ++order });
    },
  };
}

test("空收藏不请求，最多三个并发，同一比赛在途查询复用且保留收藏顺序", async () => {
  const s = setup();
  s.controller.start();
  assert.equal(s.calls.length, 0);
  for (const id of ["e", "d", "c", "b", "a"]) s.add(id);
  s.controller.sync();
  s.controller.sync();
  assert.deepEqual(
    s.calls.map((c) => c.id),
    ["a", "b", "c"],
  );
  s.calls[1].resolve(detail("b"));
  await flush();
  assert.deepEqual(
    s.calls.map((c) => c.id),
    ["a", "b", "c", "d"],
  );
  s.calls[0].resolve(detail("a"));
  await flush();
  assert.deepEqual(
    s.calls.map((c) => c.id),
    ["a", "b", "c", "d", "e"],
  );
  assert.deepEqual(
    s.state.rows.map((r) => r.id),
    ["a", "b", "c", "d", "e"],
  );
  s.controller.stop();
});

test("404保留可取消条目，网络、超时和5xx保留数量并可重试", async () => {
  for (const [error, status] of [
    [
      new RequestError("http", "未公开", {
        statusCode: 404,
        requestId: "req-404",
      }),
      "missing",
    ],
    [new RequestError("network", "网络失败"), "error"],
    [new RequestError("timeout", "请求超时"), "error"],
    [new RequestError("http", "服务错误", { statusCode: 503 }), "error"],
  ]) {
    const s = setup(["a"]);
    s.controller.start();
    s.calls[0].reject(error);
    await flush();
    assert.equal(s.state.rows[0].status, status);
    assert.equal(s.records.length, 1);
    assert.equal(s.state.rows[0].requestId, error.requestId);
    s.controller.retry("a");
    s.controller.retry("a");
    assert.equal(s.calls.length, 2);
    s.calls[1].resolve(detail("a"));
    await flush();
    assert.equal(s.state.rows[0].status, "ready");
    assert.equal(s.state.rows[0].error, "");
    s.records.splice(0);
    s.controller.sync();
    assert.deepEqual(s.state.rows, []);
  }
});

test("取消后重新收藏同ID，旧响应不得覆盖新记录，移除立即给排队项让位", async () => {
  const s = setup(["a", "b", "c", "d"]);
  s.controller.start();
  s.records.splice(0, 1);
  s.controller.sync();
  assert.equal(s.calls[0].cancelled, true);
  assert.equal(s.calls[3].id, "d");
  s.add("a");
  s.controller.sync();
  s.calls[0].resolve(detail("a"));
  await flush();
  assert.equal(s.state.rows[0].detail, null);
  s.calls[1].resolve(detail("b"));
  await flush();
  assert.equal(s.calls[4].id, "a");
  s.calls[4].resolve({ ...detail("a"), name: "重新收藏的最新资料" });
  await flush();
  assert.equal(s.state.rows[0].detail.name, "重新收藏的最新资料");
  s.controller.stop();
});

test("隐藏后取消在途请求并忽略迟到响应，返回重新查询当前资料", async () => {
  const s = setup(["a"]);
  s.controller.start();
  s.controller.stop();
  assert.equal(s.calls[0].cancelled, true);
  s.calls[0].resolve(detail("a"));
  await flush();
  assert.equal(s.state.rows[0].detail, null);
  s.controller.start();
  s.calls[1].resolve(detail("a"));
  await flush();
  assert.equal(s.state.rows[0].status, "ready");
  s.records.splice(0);
  s.controller.sync();
  assert.equal(s.state.rows.length, 0);
});

test("重置后同ID新收藏不接收旧响应，损坏响应进入可重试失败态", async () => {
  const s = setup(["a"]);
  s.controller.start();
  s.records.splice(0);
  s.controller.sync();
  s.add("a");
  s.controller.sync();
  s.calls[1].resolve(detail("other"));
  await flush();
  assert.equal(s.state.rows[0].status, "error");
  s.calls[0].resolve(detail("a"));
  await flush();
  assert.equal(s.state.rows[0].status, "error");
  assert.equal(s.state.rows[0].detail, null);
});
