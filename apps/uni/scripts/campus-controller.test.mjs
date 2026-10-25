import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCampusController,
  initialCampusState,
} from "../src/campus/controller.ts";
import { RequestError } from "../src/api/http.ts";
import { campusReturnTarget } from "../src/navigation/campus-return.ts";
import { beijingTime, renewalDue } from "../src/campus/presentation.ts";

const status = {
  status: "unverified",
  termId: null,
  verifiedAt: null,
  validUntil: null,
  source: null,
  available: true,
  currentTerm: {
    id: "autumn",
    startAt: "2026-09-01T00:00:00Z",
    endAt: "2027-02-01T00:00:00Z",
  },
  policyVersion: 1,
};
const transaction = (extra = {}) => ({
  id: "tx-1",
  status: "waiting",
  expiresAt: "2026-10-26T00:05:00Z",
  reason: null,
  challenge: {
    version: "v1",
    imageDataUrl: "data:image/png;base64,aGVsbG8=",
    expiresAt: "2026-10-26T00:05:00Z",
  },
  ...extra,
});
function fixture() {
  const calls = [];
  let generation = 1;
  const api = Object.fromEntries(
    [
      "policy",
      "status",
      "profile",
      "create",
      "refresh",
      "submit",
      "query",
      "cancel",
    ].map((name) => [
      name,
      (...args) => {
        let resolve, reject;
        const promise = new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        });
        promise.catch(() => {});
        const call = {
          name,
          args: structuredClone(args),
          resolve,
          reject,
          promise,
          cancelled: false,
          cancel() {
            this.cancelled = true;
          },
        };
        calls.push(call);
        return call;
      },
    ]),
  );
  const state = initialCampusState();
  const controller = createCampusController(
    state,
    api,
    () => generation,
    () => Date.parse("2026-10-26T00:00:00Z"),
  );
  const last = (name) => calls.filter((x) => x.name === name).at(-1);
  async function load() {
    const pending = controller.show();
    last("policy").resolve({ version: 1, content: "独立告知全文" });
    last("status").resolve(structuredClone(status));
    last("profile").resolve({ profile: null });
    await pending;
    state.consented = true;
  }
  async function start() {
    const pending = controller.start();
    last("create").resolve(transaction());
    await pending;
  }
  return {
    state,
    controller,
    calls,
    last,
    load,
    start,
    changeAccount() {
      generation++;
      controller.reset();
    },
  };
}

test("独立告知同意后才创建事务；提交保留密码原值并立即清密、防连点", async () => {
  const f = fixture();
  await f.load();
  f.state.consented = false;
  await f.controller.start();
  assert.equal(f.last("create"), undefined);
  f.state.consented = true;
  await f.start();
  Object.assign(f.state, {
    account: "001",
    password: " pass ",
    captcha: "Ab9",
  });
  const pending = f.controller.submit();
  await f.controller.submit();
  assert.equal(f.calls.filter((x) => x.name === "submit").length, 1);
  assert.equal(f.last("submit").args[1].password, " pass ");
  assert.equal(f.state.password, "");
  assert.equal(f.state.captcha, "");
  f.last("submit").resolve(
    transaction({
      status: "failed",
      reason: "credentials_failed",
      challenge: undefined,
    }),
  );
  await pending;
  assert.equal(f.state.transaction.status, "failed");
});

test("刷新立即清空旧答案，刷新中不能提交，成功后只使用新版本", async () => {
  const f = fixture();
  await f.load();
  await f.start();
  Object.assign(f.state, {
    account: "001",
    password: "secret",
    captcha: "old",
  });
  const refresh = f.controller.refresh();
  assert.equal(f.state.captcha, "");
  assert.equal(f.state.password, "");
  await f.controller.submit();
  assert.equal(f.last("submit"), undefined);
  f.last("refresh").resolve(
    transaction({ challenge: { ...transaction().challenge, version: "v2" } }),
  );
  await refresh;
  Object.assign(f.state, { password: "next", captcha: "new" });
  const submit = f.controller.submit();
  assert.equal(f.last("submit").args[1].challengeVersion, "v2");
  f.last("submit").resolve(
    transaction({
      status: "failed",
      reason: "captcha_failed",
      challenge: undefined,
    }),
  );
  await submit;
});

test("提交超时先查询原事务，处理中不会自动重发密码", async () => {
  const f = fixture();
  await f.load();
  await f.start();
  Object.assign(f.state, { account: "001", password: "secret", captcha: "AB" });
  const submit = f.controller.submit();
  f.last("submit").reject(new RequestError("timeout", "原始信息不可回显"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.last("query").args, ["tx-1"]);
  f.last("query").resolve(
    transaction({ status: "processing", challenge: undefined }),
  );
  await submit;
  await f.controller.submit();
  assert.equal(f.calls.filter((x) => x.name === "submit").length, 1);
  assert.equal(f.state.password, "");
  assert.equal(f.state.captcha, "");
});

test("超时查询识别已成功，并单独读取当前资格及本人只读资料", async () => {
  const f = fixture();
  await f.load();
  await f.start();
  Object.assign(f.state, { account: "001", password: "secret", captcha: "AB" });
  const submit = f.controller.submit();
  f.last("submit").reject(new RequestError("timeout", "timeout"));
  await new Promise((resolve) => setImmediate(resolve));
  f.last("query").resolve(
    transaction({ status: "succeeded", challenge: undefined }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  f.last("status").resolve({
    ...status,
    status: "valid",
    termId: "autumn",
    verifiedAt: "2026-10-26T00:00:00Z",
    validUntil: "2027-02-01T00:00:00Z",
    source: "sicau-eauth",
  });
  f.last("policy").resolve({ version: 1, content: "告知" });
  f.last("profile").resolve({
    profile: {
      accountNumber: "001",
      name: "合成姓名",
      source: "sicau-eauth",
      updatedAt: "2026-10-26T00:00:00Z",
    },
  });
  await submit;
  assert.equal(f.state.transaction.status, "succeeded");
  assert.equal(f.state.qualification.status, "valid");
  assert.equal(f.state.profile.accountNumber, "001");
});

test("切后台立即清密并取消页面请求，恢复只查询原事务、不恢复旧挑战", async () => {
  const f = fixture();
  await f.load();
  await f.start();
  Object.assign(f.state, { password: "secret", captcha: "AB" });
  const refresh = f.controller.refresh();
  f.controller.hide(false);
  assert.equal(f.last("refresh").cancelled, true);
  assert.equal(f.state.password, "");
  assert.equal(f.state.captcha, "");
  f.last("refresh").resolve(
    transaction({ challenge: { ...transaction().challenge, version: "late" } }),
  );
  await refresh;
  const show = f.controller.show();
  f.last("query").resolve(transaction());
  await show;
  assert.equal(f.state.transaction.challenge, undefined);
  assert.equal(f.calls.filter((x) => x.name === "create").length, 1);
});

test("取消与退出后的迟到成功不能污染状态或新账号", async () => {
  const f = fixture();
  await f.load();
  await f.start();
  Object.assign(f.state, { account: "001", password: "secret", captcha: "AB" });
  const submit = f.controller.submit();
  const old = f.last("submit");
  const cancel = f.controller.cancel();
  assert.equal(old.cancelled, true);
  f.last("cancel").resolve(
    transaction({ status: "cancelled", challenge: undefined }),
  );
  await cancel;
  f.changeAccount();
  old.resolve(transaction({ status: "succeeded", challenge: undefined }));
  await submit;
  assert.equal(f.state.transaction, null);
  assert.equal(f.state.profile, null);
  assert.equal(f.state.account, "");
});

test("提前重验失败保留旧有效资格与学校资料；终态不复用验证码", async () => {
  const f = fixture();
  await f.load();
  await f.start();
  f.state.qualification = {
    ...status,
    status: "valid",
    validUntil: "2027-02-01T00:00:00Z",
  };
  f.state.profile = {
    accountNumber: "001",
    name: "原姓名",
    source: "sicau-eauth",
    updatedAt: "2026-10-26T00:00:00Z",
  };
  Object.assign(f.state, { account: "001", password: "secret", captcha: "AB" });
  const submit = f.controller.submit();
  f.last("submit").resolve(
    transaction({
      status: "failed",
      reason: "binding_conflict",
      challenge: undefined,
    }),
  );
  await submit;
  assert.equal(f.state.qualification.status, "valid");
  assert.equal(f.state.profile.name, "原姓名");
  assert.match(f.state.message, /申诉入口尚未开放/);
  await f.controller.submit();
  assert.equal(f.calls.filter((x) => x.name === "submit").length, 1);
});

test("过期不能提交；离页尽力取消，取消失败不能显示已取消", async () => {
  const f = fixture();
  await f.load();
  await f.start();
  f.state.transaction.expiresAt = "2026-10-25T00:00:00Z";
  Object.assign(f.state, { account: "001", password: "secret", captcha: "AB" });
  await f.controller.submit();
  assert.equal(f.last("submit"), undefined);
  assert.equal(f.state.password, "");
  const cancel = f.controller.cancel();
  f.last("cancel").reject(new RequestError("network", "network"));
  await cancel;
  assert.equal(f.state.uncertain, true);
  assert.match(f.state.message, /未确认取消/);
  f.controller.hide(true);
  assert.equal(f.calls.filter((x) => x.name === "cancel").length, 2);
  f.last("cancel").resolve(transaction({ status: "cancelled" }));
});

test("告知版本变更必须重新同意；无学期或入口关闭不能创建", async () => {
  const f = fixture();
  await f.load();
  f.state.qualification.available = false;
  await f.controller.start();
  assert.equal(f.last("create"), undefined);
  f.state.qualification.available = true;
  f.state.qualification.currentTerm = null;
  await f.controller.start();
  assert.equal(f.last("create"), undefined);
  f.state.qualification = { ...status };
  const start = f.controller.start();
  f.last("create").reject(
    new RequestError("http", "hidden", {
      code: "CAMPUS_CONSENT_MISMATCH",
      statusCode: 409,
    }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  f.last("policy").resolve({ version: 2, content: "新告知" });
  f.last("status").resolve({ ...status, policyVersion: 2 });
  f.last("profile").resolve({ profile: null });
  await start;
  assert.equal(f.state.consented, false);
  assert.equal(f.state.policy.version, 2);
});

test("安全返回仅允许明确内部页面与资源编号，不接收 URL、敏感参数或自动操作", () => {
  for (const returnTo of [
    "https://evil.test",
    "//evil.test",
    "team-new?password=secret",
    "campus-verification",
    "source-webview",
    ["team-new"],
  ])
    assert.equal(campusReturnTarget({ returnTo }), null);
  assert.deepEqual(
    campusReturnTarget({ returnTo: "team-new", password: "ignored" }),
    { name: "team-new" },
  );
  assert.equal(
    campusReturnTarget({
      returnTo: "team-detail",
      teamId: "https://evil.test",
    }),
    null,
  );
  assert.deepEqual(
    campusReturnTarget({
      returnTo: "team-detail",
      teamId: "team-1",
      token: "ignored",
    }),
    { name: "team-detail", id: "team-1" },
  );
});

test("学期时间固定显示北京时间，只有有效期前七天提醒", () => {
  assert.equal(
    beijingTime("2027-01-31T16:00:00Z"),
    "2027-02-01 00:00（北京时间）",
  );
  const now = Date.parse("2027-01-25T00:00:00Z");
  assert.equal(renewalDue("2027-01-31T16:00:00Z", now), true);
  assert.equal(renewalDue("2027-02-02T00:00:00Z", now), false);
  assert.equal(renewalDue("2027-01-24T00:00:00Z", now), false);
});

test("绑定冲突的安全反馈不被后续通用终态覆盖", async () => {
  const f = fixture();
  await f.load();
  await f.start();
  Object.assign(f.state, { account: "001", password: "secret", captcha: "AB" });
  const pending = f.controller.submit();
  f.last("submit").reject(
    new RequestError("http", "不可信原文", {
      code: "CAMPUS_BINDING_CONFLICT",
      statusCode: 409,
    }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  f.last("query").resolve(
    transaction({
      status: "failed",
      reason: "internal_failure",
      challenge: undefined,
    }),
  );
  await pending;
  assert.match(f.state.message, /申诉入口尚未开放/);
});

test("不可见验证码不能提交，换图后才解除图片失败限制", async () => {
  const f = fixture();
  await f.load();
  await f.start();
  f.controller.imageError();
  Object.assign(f.state, { account: "001", password: "secret", captcha: "AB" });
  await f.controller.submit();
  assert.equal(f.last("submit"), undefined);
  const pending = f.controller.refresh();
  f.last("refresh").resolve(
    transaction({ challenge: { ...transaction().challenge, version: "v2" } }),
  );
  await pending;
  assert.equal(f.state.imageFailed, false);
});
