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
const validStatus = {
  ...status,
  status: "valid",
  termId: "autumn",
  verifiedAt: "2026-10-26T00:00:00Z",
  validUntil: "2027-02-01T00:00:00Z",
  source: "sicau-eauth",
};
const savedProfile = {
  profile: {
    accountNumber: "00123456",
    name: "合成姓名",
    source: "sicau-eauth",
    updatedAt: "2026-10-26T00:00:00Z",
  },
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
const flush = () => new Promise((resolve) => setImmediate(resolve));

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
  const count = (name) => calls.filter((x) => x.name === name).length;
  /** 进入页面：读取资格、告知与资料，未认证时随即自动取码。 */
  async function load({
    qualification = status,
    profile = { profile: null },
  } = {}) {
    const pending = controller.show();
    last("policy").resolve({ version: 1, content: "认证说明" });
    last("status").resolve(structuredClone(qualification));
    last("profile").resolve(structuredClone(profile));
    await flush();
    if (last("create")) last("create").resolve(transaction());
    await pending;
  }
  async function restart() {
    const pending = controller.restart();
    last("create").resolve(transaction());
    await pending;
  }
  function fill(extra = {}) {
    state.consented = true;
    Object.assign(state, {
      name: "张三",
      account: "001",
      password: "secret",
      captcha: "AB",
      ...extra,
    });
  }
  return {
    state,
    controller,
    calls,
    last,
    count,
    load,
    restart,
    fill,
    changeAccount() {
      generation++;
      controller.reset();
    },
  };
}

test("未认证用户进入即自动取码，不要求先勾选同意，且只创建一次事务", async () => {
  const f = fixture();
  await f.load();
  assert.equal(f.count("create"), 1);
  assert.equal(f.last("create").args.length, 0);
  assert.equal(f.state.transaction.status, "waiting");
  assert.equal(f.state.consented, false);
  const again = f.controller.show();
  f.last("query").resolve(transaction());
  await again;
  assert.equal(f.count("create"), 1);
});

test("已有有效资格先看资料卡，点重新认证才创建新事务", async () => {
  const f = fixture();
  await f.load({ qualification: validStatus, profile: savedProfile });
  assert.equal(f.last("create"), undefined);
  assert.equal(f.state.qualification.status, "valid");
  assert.equal(f.state.profile.name, "合成姓名");
  await f.restart();
  assert.equal(f.count("create"), 1);
  assert.equal(f.state.transaction.status, "waiting");
});

test("未开放或无学期配置时不创建事务", async () => {
  for (const qualification of [
    { ...status, available: false },
    { ...status, currentTerm: null },
  ]) {
    const f = fixture();
    await f.load({ qualification });
    assert.equal(f.last("create"), undefined);
    assert.equal(f.state.transaction, null);
  }
});

test("创建失败不循环：重新显示页面只重读资格，不再自动创建", async () => {
  const f = fixture();
  const show = f.controller.show();
  f.last("policy").resolve({ version: 1, content: "认证说明" });
  f.last("status").resolve(structuredClone(status));
  f.last("profile").resolve({ profile: null });
  await flush();
  f.last("create").reject(new RequestError("network", "network"));
  await show;
  assert.equal(f.state.transaction, null);
  assert.match(f.state.message, /连接中断|服务暂时无法完成认证/);
  const again = f.controller.show();
  f.last("status").resolve(structuredClone(status));
  f.last("policy").resolve({ version: 1, content: "认证说明" });
  f.last("profile").resolve({ profile: null });
  await again;
  assert.equal(f.count("create"), 1);
});

test("提交携带姓名与告知版本，去空格但保留学号前导零和密码原值，立即清密", async () => {
  const f = fixture();
  await f.load();
  f.fill({ name: " 张三 ", account: " 001 ", password: " pass " });
  const pending = f.controller.submit();
  assert.deepEqual(f.last("submit").args[1], {
    name: "张三",
    account: "001",
    password: " pass ",
    captcha: "AB",
    challengeVersion: "v1",
    consentVersion: 1,
  });
  assert.equal(f.state.password, "");
  assert.equal(f.state.captcha, "");
  await f.controller.submit();
  assert.equal(f.count("submit"), 1);
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

test("必填与同意就地提示，未通过校验不发送凭据", async () => {
  const f = fixture();
  await f.load();
  await f.controller.submit();
  assert.equal(f.last("submit"), undefined);
  assert.deepEqual(Object.keys(f.state.fieldErrors).sort(), [
    "account",
    "captcha",
    "name",
    "password",
  ]);
  assert.match(f.state.fieldErrors.name, /姓名/);
  f.controller.edit("name", "张三");
  assert.equal(f.state.fieldErrors.name, "");
  f.fill({ consented: false });
  await f.controller.submit();
  assert.equal(f.last("submit"), undefined);
  assert.match(f.state.message, /同意/);
});

test("身份不匹配完整提示；重新认证保留姓名学号并清空密码验证码", async () => {
  const f = fixture();
  await f.load();
  f.fill();
  const pending = f.controller.submit();
  f.last("submit").resolve(
    transaction({
      status: "failed",
      reason: "identity_mismatch",
      challenge: undefined,
    }),
  );
  await pending;
  assert.equal(f.state.message, "验证失败，姓名与学号不匹配。");
  assert.equal(f.state.profile, null);
  await f.restart();
  assert.equal(f.last("create").args.length, 0);
  assert.equal(f.state.name, "张三");
  assert.equal(f.state.account, "001");
  assert.equal(f.state.password, "");
  assert.equal(f.state.captcha, "");
});

test("刷新立即清空旧答案，刷新中不能提交，成功后只使用新版本", async () => {
  const f = fixture();
  await f.load();
  f.fill();
  const refresh = f.controller.refresh();
  assert.equal(f.state.captcha, "");
  assert.equal(f.state.password, "");
  await f.controller.submit();
  assert.equal(f.last("submit"), undefined);
  f.last("refresh").resolve(
    transaction({ challenge: { ...transaction().challenge, version: "v2" } }),
  );
  await refresh;
  f.fill();
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
  f.fill();
  const submit = f.controller.submit();
  f.last("submit").reject(new RequestError("timeout", "原始信息不可回显"));
  await flush();
  assert.deepEqual(f.last("query").args, ["tx-1"]);
  f.last("query").resolve(
    transaction({ status: "processing", challenge: undefined }),
  );
  await submit;
  await f.controller.submit();
  assert.equal(f.count("submit"), 1);
  assert.equal(f.state.password, "");
  assert.equal(f.state.captcha, "");
});

test("超时查询识别已成功，并单独读取当前资格及本人只读资料", async () => {
  const f = fixture();
  await f.load();
  f.fill();
  const submit = f.controller.submit();
  f.last("submit").reject(new RequestError("timeout", "timeout"));
  await flush();
  f.last("query").resolve(
    transaction({ status: "succeeded", challenge: undefined }),
  );
  await flush();
  f.last("status").resolve(structuredClone(validStatus));
  f.last("policy").resolve({ version: 1, content: "认证说明" });
  f.last("profile").resolve(structuredClone(savedProfile));
  await submit;
  assert.equal(f.state.transaction.status, "succeeded");
  assert.equal(f.state.qualification.status, "valid");
  assert.equal(f.state.profile.accountNumber, "00123456");
});

test("切后台立即清密并取消页面请求，恢复只查询原事务、不恢复旧挑战", async () => {
  const f = fixture();
  await f.load();
  f.fill();
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
  assert.equal(f.count("create"), 1);
});

test("取消与退出后的迟到成功不能污染状态或新账号", async () => {
  const f = fixture();
  await f.load();
  f.fill();
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
  assert.equal(f.state.name, "");
  assert.equal(f.state.account, "");
});

test("提前重验失败保留旧有效资格与学校资料；终态不复用验证码", async () => {
  const f = fixture();
  await f.load({ qualification: validStatus, profile: savedProfile });
  await f.restart();
  f.fill();
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
  assert.equal(f.state.profile.name, "合成姓名");
  assert.match(f.state.message, /申诉入口尚未开放/);
  await f.controller.submit();
  assert.equal(f.count("submit"), 1);
});

test("过期不能提交；离页尽力取消，取消失败不能显示已取消", async () => {
  const f = fixture();
  await f.load();
  f.state.transaction.expiresAt = "2026-10-25T00:00:00Z";
  f.fill();
  await f.controller.submit();
  assert.equal(f.last("submit"), undefined);
  assert.equal(f.state.password, "");
  const cancel = f.controller.cancel();
  f.last("cancel").reject(new RequestError("network", "network"));
  await cancel;
  assert.equal(f.state.uncertain, true);
  assert.match(f.state.message, /未确认取消/);
  f.controller.hide(true);
  assert.equal(f.count("cancel"), 2);
  f.last("cancel").resolve(transaction({ status: "cancelled" }));
});

test("提交时告知版本变更必须重新同意，且不把事务判为结果不明", async () => {
  const f = fixture();
  await f.load();
  f.fill();
  const submit = f.controller.submit();
  f.last("submit").reject(
    new RequestError("http", "hidden", {
      code: "CAMPUS_CONSENT_MISMATCH",
      statusCode: 409,
    }),
  );
  await flush();
  f.last("policy").resolve({ version: 2, content: "新说明" });
  f.last("status").resolve({ ...status, policyVersion: 2 });
  f.last("profile").resolve({ profile: null });
  await submit;
  assert.equal(f.state.consented, false);
  assert.equal(f.state.policy.version, 2);
  assert.equal(f.state.uncertain, false);
  assert.ok(f.state.transaction.challenge);
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
  f.fill();
  const pending = f.controller.submit();
  f.last("submit").reject(
    new RequestError("http", "不可信原文", {
      code: "CAMPUS_BINDING_CONFLICT",
      statusCode: 409,
    }),
  );
  await flush();
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
  f.controller.imageError();
  f.fill();
  await f.controller.submit();
  assert.equal(f.last("submit"), undefined);
  const pending = f.controller.refresh();
  f.last("refresh").resolve(
    transaction({ challenge: { ...transaction().challenge, version: "v2" } }),
  );
  await pending;
  assert.equal(f.state.imageFailed, false);
});

test("连续取消只发送一次撤销请求", async () => {
  const f = fixture();
  await f.load();
  const pending = f.controller.cancel();
  void f.controller.cancel();
  assert.equal(f.count("cancel"), 1);
  f.last("cancel").resolve(
    transaction({ status: "cancelled", challenge: undefined }),
  );
  await pending;
});
