import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAuthSession,
  initialAuthState,
  authFailureMessage,
  nicknameProblem,
} from "../src/auth/auth-session.ts";
import { RequestError } from "../src/api/http.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));

const credential = (overrides = {}) => ({
  kind: "active",
  user: { id: "u1", nickname: "微信用户", status: "active" },
  accessToken: "at-1",
  refreshToken: "rt-1",
  accessExpiresAt: "2026-10-25T12:15:00.000Z",
  sessionExpiresAt: "2026-11-24T12:00:00.000Z",
  ...overrides,
});

const profile = (overrides = {}) => ({
  user: { id: "u1", nickname: "微信用户", status: "active" },
  campus: {
    status: "unverified",
    termId: null,
    verifiedAt: null,
    validUntil: null,
  },
  availability: { teaming: false },
  ...overrides,
});

/** 可手动结算的认证接口替身；cancelable=false 用于验证迟到回调。 */
function createApi() {
  const calls = [];
  const api = {
    calls,
    probe: () => null,
    pending(label, arg, cancelable = true) {
      let settle;
      const promise = new Promise((resolve, reject) => {
        settle = { resolve, reject };
      });
      // 会话会把拒绝传播给调用方，这里先挂观察者避免测试进程告警。
      promise.catch(() => {});
      const call = {
        label,
        arg,
        promise,
        resolve: settle.resolve,
        reject: settle.reject,
        cancel() {
          if (!cancelable) return;
          settle.reject(new RequestError("cancelled", "请求已取消。"));
        },
      };
      calls.push(call);
      return call;
    },
    wechatLogin(code, consentVersion) {
      return api.pending("login", { code, consentVersion });
    },
    refresh(token) {
      return api.pending("refresh", token);
    },
    logout() {
      return api.pending("logout", { token: api.probe() });
    },
    profile() {
      return api.pending("profile", undefined);
    },
    updateNickname(nickname) {
      return api.pending("nickname", nickname);
    },
  };
  return api;
}

function createStorage(initial = null) {
  const state = { value: initial, writes: 0, clears: 0 };
  return {
    state,
    read: () => state.value,
    write(value) {
      state.value = value;
      state.writes += 1;
    },
    clear() {
      state.value = null;
      state.clears += 1;
    },
  };
}

function setup(initialRefresh = null) {
  const state = initialAuthState();
  const api = createApi();
  const storage = createStorage(initialRefresh);
  const session = createAuthSession(state, api, storage);
  api.probe = () => session.accessToken();
  return { state, api, storage, session };
}

/** 完成一次登录：结算登录请求与随后的资料请求。 */
async function loginOk(ctx, cred = credential(), prof = profile()) {
  const pending = ctx.session.login("wx-code", 1);
  ctx.api.calls.at(-1).resolve(cred);
  await tick();
  ctx.api.calls.at(-1).resolve(prof);
  await pending;
}

test("登录只把刷新凭据写入存储，访问凭据仅在内存并提升代次", async () => {
  const ctx = setup();
  await loginOk(ctx);
  assert.equal(ctx.storage.state.value, "rt-1");
  assert.equal(ctx.session.accessToken(), "at-1");
  assert.equal(ctx.state.phase, "authenticated");
  assert.equal(ctx.state.user.nickname, "微信用户");
  assert.equal(ctx.state.generation, 1);
  const login = ctx.api.calls.find((call) => call.label === "login");
  assert.deepEqual(login.arg, { code: "wx-code", consentVersion: 1 });
});

test("冷启动只用刷新凭据恢复；无凭据时不发任何请求", async () => {
  const empty = setup();
  await empty.session.restore();
  assert.equal(empty.state.phase, "anonymous");
  assert.equal(empty.api.calls.length, 0);

  const ctx = setup("rt-1");
  const restoring = ctx.session.restore();
  assert.equal(ctx.state.phase, "authenticating");
  ctx.api.calls[0].resolve(credential());
  await tick();
  ctx.api.calls[1].resolve(profile());
  await restoring;
  assert.equal(ctx.state.phase, "authenticated");
  assert.deepEqual(
    ctx.api.calls.map((call) => call.label),
    ["refresh", "profile"],
  );
  assert.equal(ctx.api.calls[0].arg, "rt-1");
});

test("刷新失败清理本地凭据并要求重新登录，不重试旧刷新凭据", async () => {
  const ctx = setup("rt-1");
  const pending = ctx.session.refresh();
  ctx.api.calls[0].reject(
    new RequestError("http", "登录状态已失效", {
      statusCode: 401,
      code: "REFRESH_TOKEN_REPLAY",
    }),
  );
  await assert.rejects(pending);
  assert.equal(ctx.storage.state.value, null);
  assert.equal(ctx.state.phase, "anonymous");
  assert.equal(ctx.session.accessToken(), null);
  assert.match(ctx.state.errorMessage, /重新微信登录/);
  assert.equal(ctx.api.calls.length, 1);
});

test("并发刷新共享同一次请求，避免轮换后重放撤销整族", async () => {
  const ctx = setup("rt-1");
  const first = ctx.session.refresh();
  const second = ctx.session.refresh();
  assert.equal(ctx.api.calls.length, 1);
  ctx.api.calls[0].resolve(credential());
  assert.equal(await first, "at-1");
  assert.equal(await second, "at-1");
  assert.equal(ctx.storage.state.writes, 1);
});

test("退出无论远端结果都清本地；远端失败如实返回状态不明", async () => {
  const ok = setup();
  await loginOk(ok);
  const result = await (async () => {
    const pending = ok.session.logout();
    const call = ok.api.calls.at(-1);
    // 撤销请求必须在清理前发出，否则会丢失认证头。
    assert.equal(call.label, "logout");
    assert.equal(call.arg.token, "at-1");
    call.resolve("");
    return pending;
  })();
  assert.equal(result.remoteRevoked, true);
  assert.equal(ok.storage.state.value, null);
  assert.equal(ok.state.phase, "anonymous");

  const failed = setup();
  await loginOk(failed);
  const pending = failed.session.logout();
  failed.api.calls
    .at(-1)
    .reject(new RequestError("network", "暂时无法连接服务。"));
  const failure = await pending;
  assert.equal(failure.remoteRevoked, false);
  assert.match(failure.message, /远端会话未能确认撤销/);
  assert.equal(failed.storage.state.value, null);
  assert.equal(failed.state.user, null);
  assert.equal(failed.state.phase, "anonymous");
});

test("账号切换后旧账号的迟到响应不写入新账号", async () => {
  const ctx = setup();
  const first = ctx.session.login("code-a", 1);
  ctx.api.calls[0].resolve(credential());
  await tick();
  const lateProfile = ctx.api.calls[1];
  // 旧资料请求不被取消，模拟平台迟到回调。
  lateProfile.cancel = () => {};

  const second = ctx.session.login("code-b", 1);
  ctx.api.calls[2].resolve(
    credential({
      user: { id: "u2", nickname: "第二位", status: "active" },
      accessToken: "at-2",
      refreshToken: "rt-2",
    }),
  );
  await tick();
  ctx.api.calls[3].resolve(
    profile({ user: { id: "u2", nickname: "第二位", status: "active" } }),
  );
  await second;

  lateProfile.resolve(
    profile({ user: { id: "u1", nickname: "旧账号", status: "active" } }),
  );
  await assert.rejects(first);
  assert.equal(ctx.state.user.id, "u2");
  assert.equal(ctx.state.user.nickname, "第二位");
  assert.equal(ctx.session.accessToken(), "at-2");
  assert.equal(ctx.storage.state.value, "rt-2");
});

test("昵称按 trim 后 1–20 字校验并写回资料", async () => {
  const ctx = setup();
  await loginOk(ctx);
  await assert.rejects(ctx.session.updateNickname("   "), /请填写昵称/);
  await assert.rejects(ctx.session.updateNickname("字".repeat(21)), /最多 20/);
  assert.equal(nicknameProblem("  禾小苗  "), null);

  const pending = ctx.session.updateNickname("  禾小苗  ");
  const call = ctx.api.calls.at(-1);
  assert.equal(call.label, "nickname");
  assert.equal(call.arg, "禾小苗");
  call.resolve(
    profile({ user: { id: "u1", nickname: "禾小苗", status: "active" } }),
  );
  await pending;
  assert.equal(ctx.state.user.nickname, "禾小苗");
});

test("会话绝对到期后清理凭据并要求重新登录", async () => {
  const ctx = setup();
  await loginOk(
    ctx,
    credential({ sessionExpiresAt: "2026-10-25T12:00:00.000Z" }),
  );
  assert.equal(
    ctx.session.expireIfNeeded(Date.parse("2026-10-25T11:59:59.000Z")),
    false,
  );
  assert.equal(
    ctx.session.expireIfNeeded(Date.parse("2026-10-25T12:00:01.000Z")),
    true,
  );
  assert.equal(ctx.state.phase, "anonymous");
  assert.equal(ctx.storage.state.value, null);
  assert.match(ctx.state.errorMessage, /登录已过期/);
});

test("错误映射只使用公开状态与错误码，不回显原始 message", () => {
  assert.equal(
    authFailureMessage(
      new RequestError("http", "内部堆栈", {
        statusCode: 429,
        code: "TOO_MANY_REQUESTS",
        details: { retryAfterSeconds: 42 },
      }),
    ),
    "请求过于频繁，请 42 秒后再试。",
  );
  assert.equal(
    authFailureMessage(
      new RequestError("http", "关闭", {
        statusCode: 503,
        code: "WECHAT_LOGIN_UNAVAILABLE",
      }),
    ),
    "微信登录暂未开放，当前可先浏览公开内容。",
  );
  assert.equal(
    authFailureMessage(
      new RequestError("http", "受限", {
        statusCode: 403,
        code: "ACCOUNT_RESTRICTED",
      }),
    ),
    "账号当前受限，无法继续操作。",
  );
  assert.equal(
    authFailureMessage(new RequestError("timeout", "超时")),
    "网络超时，结果未确认，请稍后重试。",
  );
});
