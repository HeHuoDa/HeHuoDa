import assert from "node:assert/strict";
import { test } from "node:test";
import { createCompetitionApi } from "../src/api/competition-client.ts";
import { createHttpClient, RequestError } from "../src/api/http.ts";
import { detail } from "./fixtures/competition-detail.mjs";
import {
  createDetailController,
  initialDetailState,
} from "../src/stores/detail-controller.ts";
import { resolveStageTarget } from "../src/navigation/competition-detail.ts";

test("只定位当前详情的稳定赛段 ID，无效或重复冲突定位保留完整详情", () => {
  assert.deepEqual(resolveStageTarget(detail(), "stage-a"), {
    selector: "#competition-stage-0",
    message: "",
  });
  assert.equal(resolveStageTarget(detail(), undefined).message, "");
  for (const value of ["stage-old", "stage-a,stage-b", "<script>"]) {
    assert.match(resolveStageTarget(detail(), value).message, /赛段/);
    assert.equal(resolveStageTarget(detail(), value).selector, null);
  }
});

test("切换比赛立即清空旧内容，迟到响应和卸载后的响应不得改变当前详情", async () => {
  const requests = [];
  const state = initialDetailState();
  const controller = createDetailController(state, {
    detail(id) {
      let resolve;
      const promise = new Promise((r) => {
        resolve = r;
      });
      requests.push({ id, resolve });
      return { promise, cancel() {} };
    },
  });
  const a = controller.load("a");
  const b = controller.load("b");
  assert.equal(state.detail, null);
  requests[1].resolve(detail("b"));
  await b;
  requests[0].resolve(detail("a"));
  await a;
  assert.equal(state.detail.id, "b");
  const c = controller.load("c");
  assert.equal(state.detail, null);
  controller.cancel();
  requests[2].resolve(detail("c"));
  await c;
  assert.equal(state.detail, null);
});

test("详情通过独立真实契约请求，拒绝损坏赛段而非用列表对象替代", async () => {
  let call;
  const api = createCompetitionApi(
    createHttpClient(
      (options) => {
        call = options;
        return { abort() {} };
      },
      () => ({ baseUrl: "/api/v1", timeout: 5000 }),
    ),
  );
  const first = api.detail("competition-a");
  assert.equal(call.url, "/api/v1/competitions/competition-a");
  call.success({ statusCode: 200, data: detail() });
  assert.equal((await first.promise).stages[0].conflict, true);
  const broken = api.detail("competition-a");
  call.success({ statusCode: 200, data: { ...detail(), stages: [{}] } });
  await assert.rejects(
    broken.promise,
    (e) => e instanceof RequestError && e.kind === "invalid-response",
  );
});

test("404 与网络、超时、5xx 分开，重试恢复且不保留上一比赛", async () => {
  let failure = new RequestError("http", "不存在", { statusCode: 404 });
  const state = initialDetailState();
  const controller = createDetailController(state, {
    detail() {
      return {
        promise: failure
          ? Promise.reject(failure)
          : Promise.resolve(detail("a")),
        cancel() {},
      };
    },
  });
  await controller.load("a");
  assert.equal(state.status, "missing");
  for (const error of [
    new RequestError("network", "网络失败"),
    new RequestError("timeout", "超时"),
    new RequestError("http", "服务错误", {
      statusCode: 503,
      requestId: "req-503",
    }),
  ]) {
    failure = error;
    await controller.load("a");
    assert.equal(state.status, "error");
    assert.equal(state.detail, null);
  }
  assert.equal(state.requestId, "req-503");
  failure = null;
  await controller.load("a");
  assert.equal(state.status, "ready");
  assert.equal(state.detail.id, "a");
});
