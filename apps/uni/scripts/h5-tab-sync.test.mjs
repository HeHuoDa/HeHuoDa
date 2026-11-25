import assert from "node:assert/strict";
import { test } from "node:test";
import { createH5TabSync } from "../src/auth/h5-tab-sync.ts";
import { RequestError } from "../src/api/http.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));

const h5Cred = (token = "at-new") => ({
  kind: "active",
  user: { id: "u1", nickname: "禾伙搭用户", status: "active" },
  accessToken: token,
  accessExpiresAt: "2026-10-25T12:15:00.000Z",
  sessionExpiresAt: "2026-11-24T12:00:00.000Z",
});

function createBus({ delayBroadcastMs = 0 } = {}) {
  let coord = null;
  let clock = 1_700_000_000_000;
  let lockChain = Promise.resolve();
  const channels = new Set();

  const locks = {
    request(_name, callback) {
      const next = lockChain.then(() => callback());
      lockChain = next.catch(() => {});
      return next;
    },
  };

  const createChannel = () => {
    const ch = {
      onmessage: null,
      postMessage(msg) {
        const dispatch = () => {
          for (const target of channels) {
            if (target !== ch && target.onmessage) {
              target.onmessage({ data: msg });
            }
          }
        };
        if (delayBroadcastMs > 0) setTimeout(dispatch, delayBroadcastMs);
        else queueMicrotask(dispatch);
      },
      close() {
        channels.delete(ch);
      },
    };
    channels.add(ch);
    return ch;
  };

  const coordStorage = {
    read: () => (coord ? { ...coord } : null),
    write: (next) => {
      coord = { ...next };
    },
  };

  return {
    getCoord: () => coord,
    setCoord: (next) => {
      coord = next;
    },
    advanceTime: (ms) => {
      clock += ms;
    },
    channels,
    env: (tabId, extra = {}) => ({
      isSecureContext: true,
      locks,
      createChannel,
      coordStorage,
      now: () => clock,
      graceMs: 80,
      logoutLockTimeoutMs: 80,
      tabId,
      ...extra,
    }),
  };
}

function makeHandlers(initialToken = null) {
  const state = {
    token: initialToken,
    remoteRefreshes: [],
    remoteLogins: [],
    logouts: 0,
    invalidations: [],
  };
  return {
    state,
    handlers: {
      currentAccessToken: () => state.token,
      onRemoteRefresh(cred) {
        state.token = cred.accessToken;
        state.remoteRefreshes.push(cred.accessToken);
      },
      onRemoteLogin(cred) {
        state.token = cred.accessToken;
        state.remoteLogins.push(cred.accessToken);
      },
      onRemoteLogout() {
        state.token = null;
        state.logouts += 1;
      },
      onRemoteInvalidated(outcome, errorCode) {
        state.token = null;
        state.invalidations.push([outcome, errorCode]);
      },
    },
  };
}

test("两标签同时冷启动：只发一次 /auth/refresh，另一标签复用内存凭据", async () => {
  const bus = createBus();
  const hA = makeHandlers();
  const hB = makeHandlers();
  const tabA = createH5TabSync(hA.handlers, bus.env("tab-a"));
  const tabB = createH5TabSync(hB.handlers, bus.env("tab-b"));

  let refreshCount = 0;
  let resolveRefresh;
  const pA = tabA.coordinateRefresh(
    () => {
      refreshCount += 1;
      return new Promise((resolve) => {
        resolveRefresh = resolve;
      });
    },
    { reason: "restore" },
  );
  const pB = tabB.coordinateRefresh(
    () => {
      refreshCount += 1;
      return Promise.resolve(h5Cred("should-not-run"));
    },
    { reason: "restore" },
  );

  await tick();
  assert.equal(refreshCount, 1);
  resolveRefresh(h5Cred("at-shared"));

  const [resA, resB] = await Promise.all([pA, pB]);
  assert.equal(resA.kind, "refreshed");
  assert.equal(resA.credential.accessToken, "at-shared");
  assert.equal(resB.kind, "adopted");
  assert.equal(hB.state.token, "at-shared");
  assert.equal(refreshCount, 1);

  // 协调存储绝不含任何令牌或用户身份字段
  const stored = JSON.stringify(bus.getCoord());
  assert.doesNotMatch(stored, /at-shared|userId|u1|禾伙搭/);
  tabA.dispose();
  tabB.dispose();
});

test("两标签同时遇到 401 且广播晚于锁释放：等待者仍通过宽限期收拢结果而不重发", async () => {
  const bus = createBus({ delayBroadcastMs: 25 });
  const hA = makeHandlers("at-old");
  const hB = makeHandlers("at-old");
  const tabA = createH5TabSync(hA.handlers, bus.env("tab-a"));
  const tabB = createH5TabSync(hB.handlers, bus.env("tab-b"));

  let refreshCount = 0;
  const pA = tabA.coordinateRefresh(
    async () => {
      refreshCount += 1;
      return h5Cred("at-rotated");
    },
    { reason: "retry", failedAccessToken: "at-old" },
  );
  const pB = tabB.coordinateRefresh(
    async () => {
      refreshCount += 1;
      return h5Cred("at-replay");
    },
    { reason: "retry", failedAccessToken: "at-old" },
  );

  const [resA, resB] = await Promise.all([pA, pB]);
  assert.equal(refreshCount, 1);
  assert.equal(resA.kind, "refreshed");
  assert.equal(resB.kind, "adopted");
  assert.equal(resB.credential?.accessToken, "at-rotated");
  tabA.dispose();
  tabB.dispose();
});

test("领先页在刷新途中关闭导致状态停留 running：接管页转为 unknown 且阻止补发", async () => {
  const bus = createBus();
  bus.setCoord({
    seq: 3,
    roundId: "round-crashed",
    status: "running",
    ownerTabId: "tab-dead",
    logoutSeq: 0,
    updatedAt: 1_700_000_000_000,
  });

  const hB = makeHandlers("at-old");
  const tabB = createH5TabSync(hB.handlers, bus.env("tab-b"));
  let refreshCount = 0;
  const res = await tabB.coordinateRefresh(
    async () => {
      refreshCount += 1;
      return h5Cred();
    },
    { reason: "retry", failedAccessToken: "at-old" },
  );

  assert.equal(refreshCount, 0);
  assert.equal(res.kind, "unknown");
  assert.equal(bus.getCoord().status, "unknown");

  // 结果未知之后，再次自动刷新也必须被阻止，直到用户重新登录
  const resAgain = await tabB.coordinateRefresh(
    async () => {
      refreshCount += 1;
      return h5Cred();
    },
    { reason: "restore" },
  );
  assert.equal(refreshCount, 0);
  assert.equal(resAgain.kind, "unknown");

  tabB.notifyLogin(h5Cred("at-relogin"));
  assert.equal(bus.getCoord().status, "succeeded");
  tabB.dispose();
});

test("非安全上下文或缺失 Web Locks / BroadcastChannel 时返回 unsupported 且不并发直发", async () => {
  const bus = createBus();
  const h = makeHandlers();
  for (const overrides of [
    { isSecureContext: false },
    { locks: null },
    { createChannel: null },
  ]) {
    const sync = createH5TabSync(h.handlers, bus.env("tab-x", overrides));
    assert.equal(sync.isSupported(), false);
    let calls = 0;
    const res = await sync.coordinateRefresh(
      async () => {
        calls += 1;
        return h5Cred();
      },
      { reason: "restore" },
    );
    assert.equal(calls, 0);
    assert.equal(res.kind, "unsupported");
    sync.dispose();
  }
});

test("刷新与登出竞争及晚到旧广播：登出获胜且旧消息绝不复活会话", async () => {
  const bus = createBus();
  const hA = makeHandlers("at-1");
  const hB = makeHandlers("at-1");
  const tabA = createH5TabSync(hA.handlers, bus.env("tab-a"));
  const tabB = createH5TabSync(hB.handlers, bus.env("tab-b"));

  let releaseRefresh;
  const refreshPromise = tabA.coordinateRefresh(
    () =>
      new Promise((resolve) => {
        releaseRefresh = resolve;
      }),
    { reason: "retry", failedAccessToken: "at-1" },
  );
  await tick();

  // 在 A 刷新尚未落地时，B 触发退出（本页先清本地凭据）
  hB.state.token = null;
  let logoutCalls = 0;
  const logoutPromise = tabB.coordinateLogout(async () => {
    logoutCalls += 1;
  });
  await tick();
  assert.equal(hA.state.logouts, 1);
  assert.equal(hA.state.token, null);

  // A 的刷新随后返回，但不得再激活已退出会话
  releaseRefresh(h5Cred("at-zombie"));
  const [refreshRes] = await Promise.all([refreshPromise, logoutPromise]);
  assert.equal(logoutCalls, 1);
  assert.equal(refreshRes.kind, "logged-out");

  // 即使收到滞后的旧 seq 刷新/登录广播，也不得复活会话
  for (const ch of bus.channels) {
    ch.onmessage?.({
      data: {
        kind: "refresh-result",
        seq: 1,
        roundId: "old",
        senderTabId: "tab-old",
        outcome: "succeeded",
        credential: h5Cred("at-stale"),
      },
    });
    ch.onmessage?.({
      data: {
        kind: "login-succeeded",
        seq: 1,
        roundId: "old",
        senderTabId: "tab-old",
        credential: h5Cred("at-stale"),
      },
    });
  }
  assert.equal(hA.state.token, null);
  assert.equal(hB.state.token, null);

  tabA.dispose();
  tabB.dispose();
});

test("429 限流写回退避时间窗口；403 受限广播使其他标签同步清退", async () => {
  const bus = createBus();
  const hA = makeHandlers("at-1");
  const hB = makeHandlers("at-1");
  const tabA = createH5TabSync(hA.handlers, bus.env("tab-a"));
  const tabB = createH5TabSync(hB.handlers, bus.env("tab-b"));

  const r1 = await tabA.coordinateRefresh(
    () =>
      Promise.reject(
        new RequestError("http", "limited", {
          statusCode: 429,
          code: "TOO_MANY_REQUESTS",
          details: { retryAfterSeconds: 20 },
        }),
      ),
    { reason: "retry", failedAccessToken: "at-1" },
  );
  assert.equal(r1.kind, "rate-limited");
  assert.equal(bus.getCoord().status, "rate_limited");

  let secondCall = 0;
  const r2 = await tabB.coordinateRefresh(
    async () => {
      secondCall += 1;
      return h5Cred();
    },
    { reason: "restore" },
  );
  assert.equal(secondCall, 0);
  assert.equal(r2.kind, "rate-limited");

  // 403 受限通知清理对端标签
  bus.advanceTime(30_000);
  const r3 = await tabA.coordinateRefresh(
    () =>
      Promise.reject(
        new RequestError("http", "restricted", {
          statusCode: 403,
          code: "ACCOUNT_RESTRICTED",
        }),
      ),
    { reason: "retry", failedAccessToken: "at-1" },
  );
  assert.equal(r3.kind, "restricted");
  await tick();
  assert.equal(hB.state.token, null);
  assert.deepEqual(hB.state.invalidations, [
    ["restricted", "ACCOUNT_RESTRICTED"],
  ]);

  tabA.dispose();
  tabB.dispose();
});
