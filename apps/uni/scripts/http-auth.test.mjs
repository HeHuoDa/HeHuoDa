import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createHttpClient,
  RequestError,
  responseRequestId,
} from "../src/api/http.ts";

/** 记录 transport 调用的假平台层；可注入认证会话，手动驱动响应。 */
function platform(auth) {
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
    auth,
  );
  return {
    calls,
    client,
    respond(call, statusCode, data, header) {
      call.options.success({ statusCode, data, header });
    },
  };
}

/** 可编程认证会话替身：记录刷新次数，可控制令牌与刷新成败。 */
function authSession(overrides = {}) {
  const state = {
    // 显式传入 null 表示未登录；不能用 ??，否则 null 会被默认令牌顶替。
    token: "token" in overrides ? overrides.token : "token-a",
    refreshCount: 0,
    failRefresh: overrides.failRefresh ?? false,
  };
  return {
    state,
    accessToken: () => state.token,
    refresh() {
      state.refreshCount += 1;
      if (state.failRefresh) {
        return Promise.reject(new Error("刷新失败"));
      }
      state.token = "token-b";
      return Promise.resolve("token-b");
    },
  };
}

const isCredential = (data) =>
  typeof data === "object" &&
  data !== null &&
  typeof data.accessToken === "string";

test("POST 携带方法、请求体与认证头；无令牌时不带认证头", async () => {
  const p = platform(authSession());
  const posted = p.client.post(
    "/auth/wechat/login",
    { code: "c" },
    isCredential,
  );
  assert.equal(p.calls[0].options.method, "POST");
  assert.deepEqual(p.calls[0].options.data, { code: "c" });
  assert.equal(p.calls[0].options.header.Authorization, "Bearer token-a");
  p.respond(p.calls[0], 200, { accessToken: "t" });
  await posted.promise;

  const noAuth = platform();
  const plain = noAuth.client.post(
    "/auth/wechat/login",
    { code: "c" },
    isCredential,
  );
  assert.equal(noAuth.calls[0].options.header, undefined);
  noAuth.respond(noAuth.calls[0], 200, { accessToken: "t" });
  await plain.promise;

  // 昵称修改走 POST 别名：wx.request 不接受 PATCH，客户端不发明第三种方法。
  const renamed = p.client.post(
    "/auth/me",
    { nickname: "新昵称" },
    isCredential,
  );
  assert.equal(p.calls[1].options.method, "POST");
  assert.deepEqual(p.calls[1].options.data, { nickname: "新昵称" });
  p.respond(p.calls[1], 200, { accessToken: "t" });
  await renamed.promise;
});

test("带认证头的 401 触发单次刷新并用新令牌重发一次", async () => {
  const auth = authSession();
  const p = platform(auth);
  const pending = p.client.get("/auth/me", isCredential);
  p.respond(p.calls[0], 401, { code: "UNAUTHORIZED", message: "未授权" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(auth.state.refreshCount, 1);
  assert.equal(p.calls.length, 2);
  assert.equal(p.calls[1].options.header.Authorization, "Bearer token-b");
  p.respond(p.calls[1], 200, { accessToken: "ok" });
  assert.deepEqual(await pending.promise, { accessToken: "ok" });
});

test("并发多个 401 共享一次刷新，各自重发成功", async () => {
  const auth = authSession();
  const p = platform(auth);
  const first = p.client.get("/auth/me", isCredential);
  const second = p.client.get("/auth/me", isCredential);
  p.respond(p.calls[0], 401, { code: "UNAUTHORIZED", message: "未授权" });
  p.respond(p.calls[1], 401, { code: "UNAUTHORIZED", message: "未授权" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(auth.state.refreshCount, 1);
  assert.equal(p.calls.length, 4);
  p.respond(p.calls[2], 200, { accessToken: "one" });
  p.respond(p.calls[3], 200, { accessToken: "two" });
  assert.deepEqual(await first.promise, { accessToken: "one" });
  assert.deepEqual(await second.promise, { accessToken: "two" });
});

test("刷新失败以原 401 拒绝；重发后仍 401 不再刷新", async () => {
  const auth = authSession({ failRefresh: true });
  const p = platform(auth);
  const pending = p.client.get("/auth/me", isCredential);
  p.respond(p.calls[0], 401, { code: "UNAUTHORIZED", message: "未授权" });
  await assert.rejects(
    pending.promise,
    (error) =>
      error instanceof RequestError &&
      error.kind === "http" &&
      error.statusCode === 401,
  );

  const auth2 = authSession();
  const p2 = platform(auth2);
  const pending2 = p2.client.get("/auth/me", isCredential);
  p2.respond(p2.calls[0], 401, { code: "UNAUTHORIZED", message: "未授权" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(p2.calls.length, 2);
  p2.respond(p2.calls[1], 401, { code: "UNAUTHORIZED", message: "未授权" });
  await assert.rejects(
    pending2.promise,
    (error) => error instanceof RequestError && error.statusCode === 401,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(auth2.state.refreshCount, 1);
});

test("未带认证头的 401（登录码无效）不触发刷新；网络与超时错误不重发", async () => {
  const auth = authSession({ token: null });
  const p = platform(auth);
  const login = p.client.post(
    "/auth/wechat/login",
    { code: "bad" },
    isCredential,
  );
  p.respond(p.calls[0], 401, { code: "WECHAT_CODE_INVALID", message: "无效" });
  await assert.rejects(
    login.promise,
    (error) => error.code === "WECHAT_CODE_INVALID",
  );
  assert.equal(auth.state.refreshCount, 0);

  const auth2 = authSession();
  const p2 = platform(auth2);
  const netFail = p2.client.get("/auth/me", isCredential);
  p2.calls[0].options.fail({ errMsg: "request:fail timeout" });
  await assert.rejects(netFail.promise, (error) => error.kind === "timeout");
  assert.equal(auth2.state.refreshCount, 0);
  assert.equal(p2.calls.length, 1);
});

test("等待刷新期间取消：请求以 cancelled 结算，不再重发", async () => {
  const auth = {
    accessToken: () => "token-a",
    refresh: () => new Promise(() => {}),
  };
  const p = platform(auth);
  const pending = p.client.get("/auth/me", isCredential);
  p.respond(p.calls[0], 401, { code: "UNAUTHORIZED", message: "未授权" });
  await new Promise((resolve) => setImmediate(resolve));
  pending.cancel();
  await assert.rejects(pending.promise, (error) => error.kind === "cancelled");
  assert.equal(p.calls.length, 1);
});

test("204 无响应体可通过校验（登出场景）", async () => {
  const p = platform(authSession());
  const pending = p.client.post("/auth/logout", undefined, () => true);
  assert.equal(p.calls[0].options.data, undefined);
  p.respond(p.calls[0], 204, "");
  assert.equal(await pending.promise, "");
});

test("responseRequestId 保持既有语义", () => {
  assert.equal(responseRequestId({ requestId: "req-9" }, {}), "req-9");
  assert.equal(
    responseRequestId({}, { "x-request-id": "header-1" }),
    "header-1",
  );
  assert.equal(responseRequestId({}, {}), null);
});
