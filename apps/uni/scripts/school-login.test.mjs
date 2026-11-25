import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSchoolLoginController,
  initialSchoolLoginState,
  schoolLoginFailureMessage,
} from "../src/auth/school-login.ts";
import { RequestError } from "../src/api/http.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));

function deferred(cancelable = true) {
  let settle;
  const promise = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  promise.catch(() => {});
  return {
    promise,
    resolve: settle.resolve,
    reject: settle.reject,
    cancel() {
      if (cancelable) {
        settle.reject(new RequestError("cancelled", "请求已取消。"));
      }
    },
  };
}

function makeHarness(overrides = {}) {
  const calls = [];
  const authenticated = [];
  let gen = 0;
  let now = 1_700_000_000_000;
  const state = initialSchoolLoginState();

  const api = {
    schoolPolicy() {
      const req = deferred();
      calls.push({ label: "policy", req });
      return req;
    },
    schoolCreateChallenge() {
      const req = deferred();
      calls.push({ label: "create", req });
      return req;
    },
    schoolRefreshChallenge(id, holderToken) {
      const req = deferred();
      calls.push({ label: "refresh", id, holderToken, req });
      return req;
    },
    schoolSubmitH5(id, body) {
      const req = deferred();
      calls.push({ label: "submit", id, body: { ...body }, req });
      return req;
    },
    schoolQueryStatus(id, holderToken) {
      const req = deferred();
      calls.push({ label: "status", id, holderToken, req });
      return req;
    },
    schoolCancel(id, holderToken) {
      const req = deferred();
      calls.push({ label: "cancel", id, holderToken, req });
      return req;
    },
  };

  const controller = createSchoolLoginController(state, api, {
    now: () => now,
    generation: () => gen,
    pollMaxAttempts: overrides.pollMaxAttempts ?? 3,
    pollIntervalMs: 0,
    delay: async () => {},
    onAuthenticated: async (cred) => {
      authenticated.push(cred);
    },
  });

  const policy = (version = 1) => ({
    version,
    content: `说明 v${version}`,
  });

  const challenge = (version = "c1", expiresAt = "2099-01-01T00:10:00.000Z") => ({
    id: "tx-1",
    status: "waiting",
    expiresAt,
    reason: null,
    holderToken: "ht-secret",
    challenge: {
      version,
      imageDataUrl: "data:image/png;base64,AAAA",
      expiresAt,
    },
  });

  const h5Cred = (token = "at-1") => ({
    kind: "active",
    user: { id: "u1", nickname: "禾伙搭用户", status: "active" },
    accessToken: token,
    accessExpiresAt: "2099-01-01T00:15:00.000Z",
    sessionExpiresAt: "2099-02-01T00:00:00.000Z",
  });

  async function enterReady(version = 1) {
    const p = controller.show();
    await tick();
    calls.at(-1).req.resolve(policy(version));
    await tick();
    calls.at(-1).req.resolve(challenge("c1"));
    await p;
  }

  return {
    state,
    calls,
    authenticated,
    controller,
    policy,
    challenge,
    h5Cred,
    enterReady,
    advanceNow: (ms) => {
      now += ms;
    },
    bumpGen: () => {
      gen += 1;
    },
  };
}

test("进入加载政策并建码：holderToken 不暴露在响应式 state 中", async () => {
  const h = makeHarness();
  await h.enterReady(2);
  assert.equal(h.state.policy?.version, 2);
  assert.equal(h.state.transaction?.id, "tx-1");
  assert.equal(h.state.transaction?.challenge?.version, "c1");
  assert.equal(
    JSON.stringify(h.state).includes("ht-secret"),
    false,
    "holderToken 只能驻留在控制器闭包的内存中",
  );
});

test("缺字段、未同意或图片失效时不发起提交；姓名学号去空格、密码原样提交并立清凭据", async () => {
  const h = makeHarness();
  await h.enterReady();

  h.controller.edit("name", " 张三 ");
  h.controller.edit("account", " 20240001 ");
  h.controller.edit("password", "  pw space  ");
  h.controller.edit("captcha", " abcd ");

  // 未勾选同意：不提交且提示
  assert.equal(await h.controller.submit(), false);
  assert.equal(h.calls.filter((c) => c.label === "submit").length, 0);

  // 缺密码：不提交
  h.controller.setConsented(true);
  h.controller.edit("password", "");
  assert.equal(await h.controller.submit(), false);
  assert.equal(h.state.fieldErrors.password, "请填写统一身份认证密码");
  assert.equal(h.calls.filter((c) => c.label === "submit").length, 0);

  // 图片失败：不提交且清除秘密
  h.controller.edit("password", "  pw space  ");
  h.controller.imageError();
  assert.equal(h.state.password, "");
  assert.equal(h.state.captcha, "");
  assert.equal(await h.controller.submit(), false);
  assert.equal(h.calls.filter((c) => c.label === "submit").length, 0);

  // 刷新验证码清除旧验证码答案，恢复图片正常
  await (() => {
    const p = h.controller.refresh();
    h.calls.at(-1).req.resolve(h.challenge("c2"));
    return p;
  })();
  h.controller.edit("password", "  pw space  ");
  h.controller.edit("captcha", " 1234 ");

  const pSubmit = h.controller.submit();
  assert.equal(h.state.password, "", "提交后立即清空页面密码");
  assert.equal(h.state.captcha, "", "提交后立即清空页面验证码");
  const sub = h.calls.find((c) => c.label === "submit");
  assert.deepEqual(sub.body, {
    holderToken: "ht-secret",
    name: "张三",
    account: "20240001",
    password: "  pw space  ",
    captcha: "1234",
    challengeVersion: "c2",
    consentVersion: 1,
  });

  sub.req.resolve({
    id: "tx-1",
    status: "succeeded",
    expiresAt: "2099-01-01T00:10:00.000Z",
    reason: null,
    credential: h.h5Cred("at-school"),
  });
  assert.equal(await pSubmit, true);
  assert.equal(h.authenticated.length, 1);
  assert.equal(h.authenticated[0].accessToken, "at-school");
});

test("验证码刷新清除旧验证码答案并保留已输入账号姓名", async () => {
  const h = makeHarness();
  await h.enterReady();
  h.controller.edit("name", "李四");
  h.controller.edit("account", "20240002");
  h.controller.edit("captcha", "old");

  const p = h.controller.refresh();
  assert.equal(h.state.captcha, "");
  assert.equal(h.state.name, "李四");
  assert.equal(h.state.account, "20240002");
  h.calls.at(-1).req.resolve({
    ...h.challenge("c2"),
    holderToken: "ht-2",
  });
  await p;
  assert.equal(h.state.transaction?.challenge?.version, "c2");
});

test("告知版本过期时取消勾选并重读说明，绝不自动重发密码", async () => {
  const h = makeHarness();
  await h.enterReady(1);
  h.controller.setConsented(true);
  h.controller.edit("name", "王五");
  h.controller.edit("account", "20240003");
  h.controller.edit("password", "secret");
  h.controller.edit("captcha", "9999");

  const p = h.controller.submit();
  h.calls.at(-1).req.reject(
    new RequestError("http", "consent mismatch", {
      statusCode: 400,
      code: "CAMPUS_CONSENT_MISMATCH",
      details: { currentVersion: 3 },
    }),
  );
  await tick();
  h.calls.at(-1).req.resolve(h.policy(3));
  assert.equal(await p, false);

  assert.equal(h.state.consented, false);
  assert.equal(h.state.policy?.version, 3);
  assert.equal(h.state.password, "");
  assert.equal(h.calls.filter((c) => c.label === "submit").length, 1);
  assert.match(h.state.message, /认证说明已更新/);
});

test("提交结果不明时查原事务有界轮询；状态为 succeeded 但无凭据不得建立登录态", async () => {
  const h = makeHarness({ pollMaxAttempts: 2 });
  await h.enterReady();
  h.controller.setConsented(true);
  h.controller.edit("name", "赵六");
  h.controller.edit("account", "20240004");
  h.controller.edit("password", "pw");
  h.controller.edit("captcha", "1111");

  const p = h.controller.submit();
  h.calls.at(-1).req.reject(new RequestError("timeout", "timeout"));
  await tick();
  // 第 1 次 status 返回 processing
  const status1 = h.calls.at(-1);
  assert.equal(status1.label, "status");
  assert.equal(status1.id, "tx-1");
  status1.req.resolve({
    id: "tx-1",
    status: "processing",
    expiresAt: "2099-01-01T00:10:00.000Z",
    reason: null,
  });
  await tick();
  // 第 2 次 status 返回 succeeded（状态接口不发凭据）
  const status2 = h.calls.at(-1);
  assert.equal(status2.label, "status");
  status2.req.resolve({
    id: "tx-1",
    status: "succeeded",
    expiresAt: "2099-01-01T00:10:00.000Z",
    reason: null,
  });
  assert.equal(await p, false);

  assert.equal(h.authenticated.length, 0, "状态接口不得直接建立登录态");
  assert.equal(h.calls.filter((c) => c.label === "submit").length, 1, "不自动重发密码");
  assert.equal(h.state.transaction?.status, "failed");
  assert.match(h.state.message, /未送达|未下发/);
});

test("取消与离页会中止在途请求，迟到响应不得恢复已取消或已替换事务", async () => {
  const h = makeHarness();
  await h.enterReady();
  h.controller.setConsented(true);
  h.controller.edit("name", "孙七");
  h.controller.edit("account", "20240005");
  h.controller.edit("password", "pw");
  h.controller.edit("captcha", "2222");

  // 刷新验证码途中用户点击取消
  const refreshP = h.controller.refresh();
  const refreshCall = h.calls.at(-1);
  refreshCall.req.cancel = () => {}; // 模拟底层未能即时取消的迟到响应

  const cancelP = h.controller.cancel();
  h.calls.at(-1).req.resolve({
    id: "tx-1",
    status: "cancelled",
    expiresAt: "2099-01-01T00:10:00.000Z",
    reason: null,
  });
  await cancelP;
  assert.equal(h.state.transaction?.status, "cancelled");

  // 迟到的刷新响应回落：不得覆盖已取消状态
  refreshCall.req.resolve(h.challenge("late"));
  await refreshP;
  assert.equal(h.state.transaction?.status, "cancelled");
  assert.equal(h.state.transaction?.challenge, undefined);

  // 错误文案映射覆盖常见后端学校错误码
  assert.match(
    schoolLoginFailureMessage(
      new RequestError("http", "x", {
        statusCode: 400,
        code: "CAMPUS_IDENTITY_MISMATCH",
      }),
    ),
    /姓名与学号不匹配/,
  );
  assert.match(
    schoolLoginFailureMessage(
      new RequestError("http", "x", {
        statusCode: 429,
        code: "CAMPUS_RATE_LIMITED",
        details: { retryAfterSeconds: 15 },
      }),
    ),
    /15 秒/,
  );
  assert.match(
    schoolLoginFailureMessage(
      new RequestError("http", "x", {
        statusCode: 403,
        code: "ACCOUNT_RESTRICTED",
      }),
    ),
    /账号当前受限/,
  );
});
