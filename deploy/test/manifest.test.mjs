import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { readManifest, readReleaseManifest } from "../manifest.mjs";

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

test("version 2 archive manifest binds the archive, run, repository, platform and image identities", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "hehuoda-archive-manifest-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sha = "a".repeat(40);
  const manifest = {
    version: 2,
    delivery: "archive",
    sha,
    repository: "HeHuoDa/HeHuoDa",
    runId: "123456",
    runAttempt: "2",
    platform: "linux/amd64",
    archive: { file: "images.tar.gz", sha256: "b".repeat(64), bytes: 500 },
    images: {
      api: `hehuoda-local/api:${sha}`,
      web: `hehuoda-local/web:${sha}`,
    },
    imageIds: {
      api: `sha256:${"1".repeat(64)}`,
      web: `sha256:${"2".repeat(64)}`,
    },
  };
  writeFileSync(join(directory, "release.json"), JSON.stringify(manifest));
  assert.deepEqual(readManifest(directory, sha), manifest);
  assert.deepEqual(readReleaseManifest(directory, sha), manifest.images);

  for (const invalid of [
    { ...manifest, version: 1 },
    { ...manifest, version: 3 },
    { ...manifest, delivery: "registry" },
    { ...manifest, repository: "../repo" },
    { ...manifest, runId: "0" },
    { ...manifest, runAttempt: "00" },
    { ...manifest, platform: "windows/amd64" },
    { ...manifest, archive: { ...manifest.archive, file: "../images.tar.gz" } },
    { ...manifest, archive: { ...manifest.archive, bytes: 0 } },
    {
      ...manifest,
      images: { ...manifest.images, web: `other-local/web:${sha}` },
    },
    { ...manifest, imageIds: { ...manifest.imageIds, api: "sha256:bad" } },
  ]) {
    writeFileSync(join(directory, "release.json"), JSON.stringify(invalid));
    assert.throws(() => readManifest(directory, sha));
  }
});

test("legacy digest manifests remain readable with an explicit registry delivery type", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "hehuoda-legacy-manifest-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sha = "c".repeat(40);
  const images = {
    api: `ghcr.io/hehuoda/hehuoda/api@sha256:${"1".repeat(64)}`,
    web: `ghcr.io/hehuoda/hehuoda/web@sha256:${"2".repeat(64)}`,
  };
  writeFileSync(
    join(directory, "release.json"),
    JSON.stringify({ sha, images }),
  );
  assert.deepEqual(readManifest(directory, sha), {
    version: 1,
    delivery: "registry",
    sha,
    images,
  });
});
