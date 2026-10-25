import assert from "node:assert/strict";
import { test } from "node:test";
import { createHttpClient } from "../src/api/http.ts";
import {
  createCampusApi,
  isCampusTransaction,
  isCampusQualification,
} from "../src/api/campus-client.ts";

const tx = {
  id: "tx-1",
  status: "waiting",
  expiresAt: "2026-10-26T00:05:00Z",
  reason: null,
  challenge: {
    version: "v1",
    imageDataUrl: "data:image/png;base64,aGVsbG8=",
    expiresAt: "2026-10-26T00:05:00Z",
  },
};
test("校园客户端使用真实平台路径、Bearer及DELETE取消，无学校URL或额外字段", async () => {
  const requests = [];
  const transport = (options) => {
    requests.push(options);
    queueMicrotask(() => options.success({ statusCode: 200, data: tx }));
    return { abort() {} };
  };
  const api = createCampusApi(
    createHttpClient(transport, () => ({ baseUrl: "/api/v1", timeout: 5000 }), {
      accessToken: () => "synthetic-access",
      refresh: async () => "synthetic-refresh",
    }),
  );
  await api.create(3).promise;
  assert.deepEqual(requests[0].data, { consentVersion: 3 });
  await api.refresh("tx-1").promise;
  assert.equal(
    requests[1].url,
    "/api/v1/campus-verification/transactions/tx-1/captcha",
  );
  const body = {
    account: "001",
    password: " pass ",
    captcha: "AB",
    challengeVersion: "v1",
  };
  await api.submit("tx-1", body).promise;
  assert.equal(requests[2].data.password, " pass ");
  await api.query("tx-1").promise;
  await api.cancel("tx-1").promise;
  assert.equal(requests[4].method, "DELETE");
  assert.equal(requests[4].data, undefined);
  assert.ok(
    requests.every(
      (r) =>
        r.header.Authorization === "Bearer synthetic-access" &&
        r.url.startsWith("/api/v1/campus-verification"),
    ),
  );
});

test("挑战只允许内嵌安全位图，拒绝学校URL、SVG、畸形状态及日期", () => {
  assert.equal(isCampusTransaction(tx), true);
  for (const imageDataUrl of [
    "https://school.test/captcha?cookie=secret",
    "data:image/svg+xml;base64,aA==",
    "javascript:alert(1)",
  ])
    assert.equal(
      isCampusTransaction({
        ...tx,
        challenge: { ...tx.challenge, imageDataUrl },
      }),
      false,
    );
  assert.equal(isCampusTransaction({ ...tx, status: "ok" }), false);
  assert.equal(isCampusTransaction({ ...tx, expiresAt: "invalid" }), false);
  assert.equal(isCampusQualification({ status: "valid" }), false);
});
