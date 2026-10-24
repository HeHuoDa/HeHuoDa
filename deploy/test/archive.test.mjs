import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { createArchiveManifest, verifyArchive } from "../archive.mjs";

test("archive manifest records the verified images and binds them to exact workflow provenance", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "hehuoda-archive-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sha = "a".repeat(40);
  writeFileSync(join(directory, "images.tar.gz"), "verified image archive");
  const manifest = await createArchiveManifest({
    directory,
    sha,
    repository: "HeHuoDa/HeHuoDa",
    runId: "123456",
    runAttempt: "2",
    imagePrefix: "hehuoda-local",
    inspectImage(reference) {
      return {
        id: `sha256:${reference.includes("/api:") ? "1" : "2"}`.padEnd(71, "0"),
        platform: "linux/amd64",
      };
    },
  });
  assert.equal(manifest.version, 2);
  assert.equal(manifest.delivery, "archive");
  assert.equal(manifest.repository, "HeHuoDa/HeHuoDa");
  assert.equal(manifest.images.api, `hehuoda-local/api:${sha}`);
  assert.equal(manifest.images.web, `hehuoda-local/web:${sha}`);
  assert.equal(
    manifest.archive.bytes,
    Buffer.byteLength("verified image archive"),
  );
  assert.equal(
    readFileSync(join(directory, "release.json"), "utf8").includes("123456"),
    true,
  );
  assert.deepEqual(
    await verifyArchive(directory, sha, {
      repository: "HeHuoDa/HeHuoDa",
      runId: "123456",
      runAttempt: "2",
    }),
    manifest,
  );
});

test("archive verification rejects changed, missing, or wrong-run artifacts", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "hehuoda-archive-invalid-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sha = "b".repeat(40);
  writeFileSync(join(directory, "images.tar.gz"), "verified image archive");
  await createArchiveManifest({
    directory,
    sha,
    repository: "HeHuoDa/HeHuoDa",
    runId: "123456",
    runAttempt: "1",
    imagePrefix: "hehuoda-local",
    inspectImage: () => ({
      id: `sha256:${"1".repeat(64)}`,
      platform: "linux/amd64",
    }),
  });
  await assert.rejects(
    verifyArchive(directory, sha, { runId: "123457" }),
    /runId/,
  );
  await assert.rejects(
    verifyArchive(directory, sha, { repository: "Other/Repository" }),
    /repository/,
  );
  writeFileSync(join(directory, "images.tar.gz"), "changed archive");
  await assert.rejects(verifyArchive(directory, sha), /checksum or size/);
  rmSync(join(directory, "images.tar.gz"));
  await assert.rejects(verifyArchive(directory, sha), /archive is unavailable/);
});

test("archive manifest creation rejects image platform mismatches and malformed metadata", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "hehuoda-archive-platform-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, "images.tar.gz"), "image archive");
  const values = {
    directory,
    sha: "c".repeat(40),
    repository: "HeHuoDa/HeHuoDa",
    runId: "1",
    runAttempt: "1",
    imagePrefix: "hehuoda-local",
  };
  await assert.rejects(
    createArchiveManifest({
      ...values,
      inspectImage: (reference) => ({
        id: `sha256:${"1".repeat(64)}`,
        platform: reference.includes("/api:") ? "linux/amd64" : "linux/arm64",
      }),
    }),
    /same platform/,
  );
  await assert.rejects(
    createArchiveManifest({ ...values, runId: "0", inspectImage: () => ({}) }),
    /metadata/,
  );
});
