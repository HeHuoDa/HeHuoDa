import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveApiConfig } from "../src/api/config.ts";
import { createHttpClient, RequestError } from "../src/api/http.ts";
import { isHealthResponse } from "../src/api/health.ts";
import {
  createHealthController,
  initialHealthState,
} from "../src/stores/health-controller.ts";

function platform() {
  const calls = [];
  const client = createHttpClient(
    (options) => {
      const call = { options, aborted: false };
      calls.push(call);
      return {
        abort() {
          call.aborted = true;
        },
      };
    },
    () => ({ baseUrl: "/api/v1", timeout: 5000 }),
  );
  return { calls, request: () => client.get("/health", isHealthResponse) };
}
const ok = (call, requestId = "req-1") =>
  call.options.success({ statusCode: 200, data: { status: "ok", requestId } });

test("H5 开发默认使用代理；小程序与正式环境缺配置明确失败", () => {
  assert.deepEqual(resolveApiConfig({ development: true, platform: "h5" }), {
    baseUrl: "/api/v1",
    timeout: 5000,
  });
  for (const platform of ["h5", "mp-weixin"]) {
    assert.throws(
      () => resolveApiConfig({ development: false, platform }),
      /VITE_API_BASE_URL/,
    );
  }
  assert.throws(
    () => resolveApiConfig({ development: true, platform: "mp-weixin" }),
    /完整 API/,
  );
  assert.deepEqual(
    resolveApiConfig({
      baseUrl: "https://api.example.com/api/v1/",
      development: false,
      platform: "mp-weixin",
      timeout: "1000",
    }),
    { baseUrl: "https://api.example.com/api/v1", timeout: 1000 },
  );
  assert.equal(
    resolveApiConfig({ baseUrl: "/api/v1", development: false, platform: "h5" })
      .baseUrl,
    "/api/v1",
  );
});

test("无效地址与超时配置拒绝：协议相对地址、凭据、查询、生产明文、小程序相对地址", () => {
  for (const baseUrl of [
    "//example.com/api",
    "https://user:pass@example.com/api",
    "https://example.com/api?token=x",
    "http://example.com/api",
    "/api/v1",
    "javascript:alert(1)",
    "https://example.com\\evil",
  ]) {
    assert.throws(() =>
      resolveApiConfig({ baseUrl, development: false, platform: "mp-weixin" }),
    );
  }
  for (const timeout of ["0", "NaN", "-1", "1.5", "60001", "Infinity"]) {
    assert.throws(
      () =>
        resolveApiConfig({
          baseUrl: "/api/v1",
          timeout,
          development: false,
          platform: "h5",
        }),
      /TIMEOUT/,
    );
  }
});

test("统一 GET 入口使用配置，返回经校验的类型化健康响应", async () => {
  const p = platform();
  const request = p.request();
  assert.equal(p.calls[0].options.url, "/api/v1/health");
  assert.equal(p.calls[0].options.method, "GET");
  assert.equal(p.calls[0].options.timeout, 5000);
  ok(p.calls[0]);
  assert.deepEqual(await request.promise, { status: "ok", requestId: "req-1" });
});

for (const statusCode of [400, 500]) {
  test(`success 回调中的 ${statusCode} 仍映射为 HTTP 失败并保留公开错误字段`, async () => {
    const p = platform();
    const request = p.request();
    p.calls[0].options.success({
      statusCode,
      data: {
        code: "BAD_REQUEST",
        message: "请求无效",
        requestId: "error-1",
        details: { field: "q" },
      },
    });
    await assert.rejects(
      request.promise,
      (error) =>
        error instanceof RequestError &&
        error.kind === "http" &&
        error.statusCode === statusCode &&
        error.code === "BAD_REQUEST" &&
        error.message === "请求无效" &&
        error.requestId === "error-1" &&
        error.details.field === "q",
    );
  });
}

for (const data of [
  undefined,
  null,
  "<html>服务器错误</html>",
  [],
  { message: {}, requestId: 12, code: [] },
]) {
  test(`错误体缺失或畸形提供通用信息：${JSON.stringify(data)}`, async () => {
    const p = platform();
    const request = p.request();
    p.calls[0].options.success({
      statusCode: 500,
      data,
      header: { "X-Request-ID": "header-id" },
    });
    await assert.rejects(
      request.promise,
      (error) =>
        error.kind === "http" &&
        error.requestId === "header-id" &&
        error.code === null &&
        error.message === "暂时无法连接服务，请稍后重试。",
    );
  });
}

test("HTTP 2xx 不跳过必要字段校验", async () => {
  for (const data of [
    null,
    {},
    [],
    "ok",
    { status: "bad", requestId: "r" },
    { status: "ok" },
    { status: "ok", requestId: "  " },
    { status: "ok", requestId: 123 },
    { status: "ok", requestId: "x".repeat(257) },
  ]) {
    const p = platform();
    const request = p.request();
    p.calls[0].options.success({ statusCode: 200, data });
    await assert.rejects(
      request.promise,
      (error) => error.kind === "invalid-response",
    );
  }
});

for (const [errMsg, kind] of [
  ["request:fail timeout", "timeout"],
  ["request:fail time out", "timeout"],
  ["request:fail net::ERR_INTERNET_DISCONNECTED", "network"],
  ["request:fail abort", "cancelled"],
]) {
  test(`${errMsg} 映射为 ${kind}`, async () => {
    const p = platform();
    const request = p.request();
    p.calls[0].options.fail({ errMsg });
    await assert.rejects(request.promise, (error) => error.kind === kind);
  });
}

test("主动取消调用 RequestTask.abort，无 fail 回调也结算，迟到成功忽略", async () => {
  const p = platform();
  const request = p.request();
  request.cancel();
  request.cancel();
  ok(p.calls[0]);
  assert.equal(p.calls[0].aborted, true);
  await assert.rejects(request.promise, (error) => error.kind === "cancelled");
});

test("同步 abort 回调、传输抛错与配置失败均有确定结果", async () => {
  const client = createHttpClient(
    (options) => ({
      abort() {
        options.fail({ errMsg: "request:fail abort" });
      },
    }),
    () => ({ baseUrl: "/api/v1", timeout: 5000 }),
  );
  const request = client.get("/health", isHealthResponse);
  request.cancel();
  await assert.rejects(request.promise, (error) => error.kind === "cancelled");
  const broken = createHttpClient(
    () => {
      throw new Error("platform");
    },
    () => ({ baseUrl: "/api/v1", timeout: 5000 }),
  );
  await assert.rejects(
    broken.get("/health", isHealthResponse).promise,
    (error) => error.kind === "network",
  );
  const config = createHttpClient(
    () => {
      assert.fail("配置失败不发请求");
    },
    () => {
      throw new Error("配置缺失");
    },
  );
  await assert.rejects(
    config.get("/health", isHealthResponse).promise,
    (error) => error.kind === "config",
  );
});

test("健康页首载、重复点击、错误 requestId、手动重试恢复", async () => {
  const p = platform();
  const state = initialHealthState();
  const health = createHealthController(state, p.request);
  const first = health.refresh();
  await health.refresh();
  assert.equal(p.calls.length, 1);
  assert.equal(state.state, "loading");
  p.calls[0].options.success({
    statusCode: 500,
    data: { requestId: "failed-id" },
  });
  await first;
  assert.equal(state.state, "offline");
  assert.equal(state.requestId, "failed-id");
  const retry = health.refresh();
  assert.equal(state.requestId, null);
  assert.equal(state.errorMessage, null);
  ok(p.calls[1], "retry-id");
  await retry;
  assert.equal(state.state, "online");
  assert.equal(state.requestId, "retry-id");
});

test("A 比 B 晚返回：即使传输取消无效，代次保护也只展示最新结果", async () => {
  const deferred = [];
  const state = initialHealthState();
  const health = createHealthController(state, () => ({
    promise: new Promise((resolve, reject) =>
      deferred.push({ resolve, reject }),
    ),
    cancel() {},
  }));
  const a = health.refresh();
  health.cancel();
  assert.deepEqual(state, initialHealthState());
  const b = health.refresh();
  deferred[1].resolve({ status: "ok", requestId: "B" });
  await b;
  deferred[0].resolve({ status: "ok", requestId: "A" });
  await a;
  assert.equal(state.requestId, "B");
  assert.equal(state.state, "online");
});

test("旧请求迟到失败及取消不覆盖新加载态或展示普通业务失败", async () => {
  const deferred = [];
  const state = initialHealthState();
  const health = createHealthController(state, () => ({
    promise: new Promise((resolve, reject) =>
      deferred.push({ resolve, reject }),
    ),
    cancel() {},
  }));
  const a = health.refresh();
  health.cancel();
  const b = health.refresh();
  deferred[0].reject(new RequestError("network", "A失败"));
  await a;
  assert.equal(state.state, "loading");
  assert.equal(state.errorMessage, null);
  deferred[1].reject(new RequestError("cancelled", "请求已取消。"));
  await b;
  assert.equal(state.state, "idle");
  assert.equal(state.errorMessage, null);
});
