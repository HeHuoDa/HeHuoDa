import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAuthApi,
  isCredentialResponse,
  isProfileResponse,
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

function makeApi() {
  const calls = [];
  const record = (label) => (options) => {
    const call = { label, options };
    calls.push(call);
    return { abort() {} };
  };
  const bare = createHttpClient(record("bare"), () => ({
    baseUrl: "/api/v1",
    timeout: 5000,
  }));
  const authed = createHttpClient(record("authed"), () => ({
    baseUrl: "/api/v1",
    timeout: 5000,
  }));
  return { calls, api: createAuthApi(bare, authed) };
}

test("登录与刷新走公开客户端；会话请求走认证客户端且路径与请求体正确", async () => {
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

test("凭据与资料守卫拒绝畸形响应", async () => {
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
