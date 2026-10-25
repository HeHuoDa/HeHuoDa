import assert from "node:assert/strict";
import test from "node:test";

import { verifyPublicApplication } from "../runtime.mjs";

const html = () =>
  new Response('<!doctype html><html lang="zh"></html>', {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
const json = (value) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const healthy = (path) => {
  if (path === "/") return html();
  if (path === "/api/v1/health/ready") return json({ status: "ready" });
  if (path === "/api/v1/colleges") return json([]);
  if (path === "/api/v1/competitions") return json({ items: [] });
  return new Response("missing", { status: 404 });
};

test("public verification retries a transient failure before succeeding", async () => {
  let rootCalls = 0;
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/") {
      rootCalls += 1;
      if (rootCalls < 3) throw new TypeError("fetch failed");
    }
    return healthy(path);
  };
  await verifyPublicApplication(
    { publicUrl: "http://public.example" },
    { fetchImpl, attempts: 5, delayMs: 1, log: () => {} },
  );
  assert.equal(rootCalls, 3);
});

test("public verification stops immediately on a deterministic shape mismatch", async () => {
  const logs = [];
  let calls = 0;
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    calls += 1;
    if (path === "/api/v1/colleges") return json({ items: [] });
    return healthy(path);
  };
  await assert.rejects(
    verifyPublicApplication(
      { publicUrl: "http://public.example" },
      { fetchImpl, attempts: 20, delayMs: 1, log: (line) => logs.push(line) },
    ),
    /Public college query returned an invalid shape/,
  );
  assert.equal(calls, 3);
  assert.deepEqual(logs, [
    "phase=public-check status=verified path=/",
    "phase=public-check status=verified path=/api/v1/health/ready",
    "phase=public-check status=failed path=/api/v1/colleges reason=shape",
  ]);
});

test("public verification reports a bounded status failure without leaking the host", async () => {
  const logs = [];
  const fetchImpl = async () => new Response("bad gateway", { status: 502 });
  await assert.rejects(
    verifyPublicApplication(
      { publicUrl: "http://public.example" },
      { fetchImpl, attempts: 3, delayMs: 1, log: (line) => logs.push(line) },
    ),
    /Public application check failed/,
  );
  assert.deepEqual(logs, [
    "phase=public-check status=failed path=/ reason=status code=502",
  ]);
  assert.ok(logs.every((line) => !line.includes("public.example")));
});
