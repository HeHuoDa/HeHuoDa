import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAuthApi,
  isCredentialResponse,
  isH5CredentialResponse,
  isProfileResponse,
  isSchoolLoginH5Credential,
  isSchoolLoginTransaction,
} from "../src/api/auth-client.ts";
import { createHttpClient, RequestError } from "../src/api/http.ts";

const credential = {
  kind: "active",
  user: { id: "u1", nickname: "微信用户", status: "active" },
  accessToken: "at",
  refreshToken: "rt",
  accessExpiresAt: "2026-10-25T12:15:00.000Z",
  sessionExpiresAt: "2026-11-24T12:00:00.000Z",
};
const h5Credential = {
  kind: "active",
  user: { id: "u1", nickname: "禾伙搭用户", status: "active" },
  accessToken: "at-h5",
  accessExpiresAt: "2026-10-25T12:15:00.000Z",
  sessionExpiresAt: "2026-11-24T12:00:00.000Z",
};
const profile = {
  user: { id: "u1", nickname: "微信用户", status: "active" },
  campus: {
    status: "unverified",
    termId: null,
    verifiedAt: null,
    validUntil: null,
  },
  availability: { teaming: false },
};

function makeApi(options = {}) {
  const calls = [];
  const record = (label) => (req) => {
    const call = { label, options: req };
    calls.push(call);
    return { abort() {} };
  };
  const bare = createHttpClient(record("bare"), () => ({
    baseUrl: "/api/v1",
    timeout: 5000,
  }));
  const authed = createHttpClient(
    record("authed"),
    () => ({
      baseUrl: "/api/v1",
      timeout: 5000,
    }),
    {
      accessToken: () => "at-mem",
      refresh: () => Promise.resolve("at-mem"),
    },
  );
  return { calls, api: createAuthApi(bare, authed, options) };
}

test("资料读取和昵称更新接受后端真实校园资格状态", async () => {
  for (const status of ["valid", "expired", "revoked"]) {
    const { calls, api } = makeApi();
    const value = {
      ...profile,
      campus: {
        status,
        termId: "synthetic-term",
        verifiedAt: "2026-10-25T00:00:00Z",
        validUntil: "2027-01-31T16:00:00Z",
      },
    };
    const requests = [api.profile(), api.updateNickname("新昵称")];
    calls.forEach((call) =>
      call.options.success({ statusCode: 200, data: value }),
    );
    for (const request of requests)
      assert.deepEqual(await request.promise, value);
  }
});

test("原生端登录与刷新走公开客户端；会话请求走认证客户端且路径与请求体正确", async () => {
  const { calls, api } = makeApi();
  const pending = [api.wechatLogin("code-1", 1), api.refresh("rt-1")];
  assert.deepEqual(
    calls.slice(0, 2).map((c) => [c.label, c.options.method, c.options.url]),
    [
      ["bare", "POST", "/api/v1/auth/wechat/login"],
      ["bare", "POST", "/api/v1/auth/refresh"],
    ],
  );
  assert.deepEqual(calls[0].options.data, {
    code: "code-1",
    consentVersion: 1,
  });
  assert.deepEqual(calls[1].options.data, { refreshToken: "rt-1" });
  calls[0].options.success({ statusCode: 200, data: credential });
  calls[1].options.success({ statusCode: 200, data: credential });
  await Promise.all(pending.map((p) => p.promise));

  const sessionCalls = [
    api.logout(),
    api.profile(),
    api.updateNickname("新名"),
  ];
  assert.deepEqual(
    calls.slice(2).map((c) => [c.label, c.options.method, c.options.url]),
    [
      ["authed", "POST", "/api/v1/auth/logout"],
      ["authed", "GET", "/api/v1/auth/me"],
      ["authed", "POST", "/api/v1/auth/me"],
    ],
  );
  assert.deepEqual(calls[4].options.data, { nickname: "新名" });
  calls[2].options.success({ statusCode: 204, data: "" });
  calls[3].options.success({ statusCode: 200, data: profile });
  calls[4].options.success({ statusCode: 200, data: profile });
  await Promise.all(sessionCalls.map((p) => p.promise));
});

test("H5 模式：刷新、登出与 submit/h5 携带 withCredentials 与 X-Refresh-CSRF 且不注 Bearer；昵称走 PATCH /auth/me", async () => {
  const { calls, api } = makeApi({ h5: true });
  const tx = {
    id: "tx-1",
    status: "waiting",
    expiresAt: "2026-10-25T12:10:00.000Z",
    reason: null,
    holderToken: "ht-1",
    challenge: {
      version: "v1",
      imageDataUrl: "data:image/png;base64,AA==",
      expiresAt: "2026-10-25T12:05:00.000Z",
    },
  };
  const txDone = {
    id: "tx-1",
    status: "succeeded",
    expiresAt: "2026-10-25T12:10:00.000Z",
    reason: null,
    credential: h5Credential,
  };

  const pPolicy = api.schoolPolicy();
  const pCreate = api.schoolCreateChallenge();
  const pRefreshCap = api.schoolRefreshChallenge("tx-1", "ht-1");
  const pSubmit = api.schoolSubmitH5("tx-1", {
    holderToken: "ht-1",
    name: "张三",
    account: "20240001",
    password: "pw",
    captcha: "1234",
    challengeVersion: "v1",
    consentVersion: 2,
  });
  const pStatus = api.schoolQueryStatus("tx-1", "ht-1");
  const pCancel = api.schoolCancel("tx-1", "ht-1");
  const pRefresh = api.refresh();
  const pLogout = api.logout();
  const pPatch = api.updateNickname("新昵称");

  assert.deepEqual(
    calls.map((c) => [c.label, c.options.method, c.options.url]),
    [
      ["bare", "GET", "/api/v1/campus-verification/policy"],
      ["bare", "POST", "/api/v1/auth/school/challenges"],
      ["bare", "POST", "/api/v1/auth/school/challenges/tx-1/captcha"],
      ["bare", "POST", "/api/v1/auth/school/challenges/tx-1/submit/h5"],
      ["bare", "POST", "/api/v1/auth/school/challenges/tx-1/status"],
      ["bare", "POST", "/api/v1/auth/school/challenges/tx-1/cancel"],
      ["bare", "POST", "/api/v1/auth/refresh"],
      ["bare", "POST", "/api/v1/auth/logout"],
      ["authed", "PATCH", "/api/v1/auth/me"],
    ],
  );

  // 三个 Cookie+CSRF 端点必须设 withCredentials=true 和 X-Refresh-CSRF=1，且不注 Bearer
  for (const idx of [3, 6, 7]) {
    assert.equal(calls[idx].options.withCredentials, true);
    assert.equal(calls[idx].options.header["X-Refresh-CSRF"], "1");
    assert.equal(calls[idx].options.header.Authorization, undefined);
  }
  assert.deepEqual(calls[6].options.data, {});
  assert.deepEqual(calls[7].options.data, {});
  assert.equal(calls[8].options.header.Authorization, "Bearer at-mem");
  assert.deepEqual(calls[8].options.data, { nickname: "新昵称" });

  calls[0].options.success({
    statusCode: 200,
    data: { version: 2, content: "说明" },
  });
  calls[1].options.success({ statusCode: 201, data: tx });
  calls[2].options.success({ statusCode: 200, data: tx });
  calls[3].options.success({ statusCode: 200, data: txDone });
  calls[4].options.success({
    statusCode: 200,
    data: { ...tx, challenge: undefined },
  });
  calls[5].options.success({
    statusCode: 200,
    data: {
      id: "tx-1",
      status: "cancelled",
      expiresAt: "2026-10-25T12:10:00.000Z",
      reason: null,
    },
  });
  calls[6].options.success({ statusCode: 200, data: h5Credential });
  calls[7].options.success({ statusCode: 204, data: "" });
  calls[8].options.success({ statusCode: 200, data: profile });

  await Promise.all([
    pPolicy.promise,
    pCreate.promise,
    pRefreshCap.promise,
    pSubmit.promise,
    pStatus.promise,
    pCancel.promise,
    pRefresh.promise,
    pLogout.promise,
    pPatch.promise,
  ]);
});

test("凭据与资料守卫拒绝畸形响应及 H5 响应含 refreshToken", async () => {
  const { calls, api } = makeApi();
  const bad = [
    { ...credential, kind: "legacy" },
    { ...credential, user: { ...credential.user, status: "unknown" } },
    { ...credential, accessExpiresAt: "不是时间" },
  ];
  for (const [index, data] of bad.entries()) {
    assert.equal(isCredentialResponse(data), false, `credential case ${index}`);
  }
  assert.equal(isCredentialResponse(credential), true);
  assert.equal(isH5CredentialResponse(h5Credential), true);
  assert.equal(
    isH5CredentialResponse({ ...h5Credential, refreshToken: "rt" }),
    false,
  );
  assert.equal(
    isSchoolLoginTransaction({
      id: "tx-1",
      status: "waiting",
      expiresAt: "2026-10-25T12:10:00.000Z",
      reason: null,
    }),
    true,
  );
  assert.equal(
    isSchoolLoginH5Credential({
      id: "tx-1",
      status: "succeeded",
      expiresAt: "2026-10-25T12:10:00.000Z",
      reason: null,
      credential: { ...h5Credential, refreshToken: "leak" },
    }),
    false,
  );
  assert.equal(
    isProfileResponse({
      ...profile,
      campus: { ...profile.campus, status: "verified" },
    }),
    false,
  );
  assert.equal(isProfileResponse(profile), true);

  const pending = api.wechatLogin("c", 1);
  calls[0].options.success({ statusCode: 200, data: bad[0] });
  await assert.rejects(
    pending.promise,
    (error) =>
      error instanceof RequestError && error.kind === "invalid-response",
  );
});
