import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createH5Preview } from "./h5-preview.mjs";

test("仅托管 uni 产物：页面回退 HTML，API 与缺失资源返回真实 404", async () => {
  const root = await mkdtemp(join(tmpdir(), "uni-preview-"));
  await writeFile(
    join(root, "index.html"),
    "<!doctype html><title>UNI</title>",
  );
  const server = createH5Preview(root);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ["/home", "/teams/demo-1", "/about", "/unknown"]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /<title>UNI/);
    }
    for (const path of [
      "/api",
      "/api/missing",
      "/assets/missing.js",
      "/static/logo.png",
      "/missing.png",
      "/%2e%2e/secret.js",
    ]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 404, path);
      assert.doesNotMatch(await response.text(), /doctype html/);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true });
  }
});
