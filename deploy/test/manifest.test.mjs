import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { readReleaseManifest } from "../manifest.mjs";

test("release manifest binds both digest references to the exact commit and repository", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "hehuoda-manifest-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sha = "a".repeat(40);
  const images = {
    api: `ghcr.io/hehuoda/hehuoda/api@sha256:${"1".repeat(64)}`,
    web: `ghcr.io/hehuoda/hehuoda/web@sha256:${"2".repeat(64)}`,
  };
  const write = (manifest) =>
    writeFileSync(join(directory, "release.json"), JSON.stringify(manifest));
  assert.throws(() => readReleaseManifest(directory, sha));
  write({ sha, images });
  assert.deepEqual(readReleaseManifest(directory, sha), images);
  for (const prefix of [
    "ccr.ccs.tencentyun.com/hehuoda",
    "hehuoda.tencentcloudcr.com/hehuoda",
  ]) {
    const tcrImages = {
      api: `${prefix}/api@sha256:${"1".repeat(64)}`,
      web: `${prefix}/web@sha256:${"2".repeat(64)}`,
    };
    write({ sha, images: tcrImages });
    assert.deepEqual(readReleaseManifest(directory, sha), tcrImages);
    write({ sha, images: { ...tcrImages, api: images.api } });
    assert.throws(() => readReleaseManifest(directory, sha));
  }
  for (const manifest of [
    { sha: "b".repeat(40), images },
    { sha, images: { ...images, api: `ghcr.io/hehuoda/hehuoda/api:${sha}` } },
    {
      sha,
      images: {
        ...images,
        web: images.web.replace("hehuoda/hehuoda", "other/repo"),
      },
    },
    { sha, images: { api: images.api } },
    {
      sha,
      images: Object.fromEntries(
        Object.entries(images).map(([key, value]) => [
          key,
          value.replace("ghcr.io", "untrusted.example"),
        ]),
      ),
    },
  ]) {
    write(manifest);
    assert.throws(() => readReleaseManifest(directory, sha));
  }
});
