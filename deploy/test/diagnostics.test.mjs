import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("failed Docker operations retain private stderr and export only safe diagnostic categories", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "hehuoda-diagnostics-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    const { docker } = await import(${JSON.stringify(new URL("../runtime.mjs", import.meta.url).href)});
    try {
      docker(['-e', "console.error('password=private-fixture pg_restore: connection refused'); process.exit(7)"]);
    } catch (error) { console.log(error.message); }
  `,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DOCKER_BIN: process.execPath,
        DEPLOY_STATE_DIR: directory,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /private-fixture/);
  const files = readdirSync(join(directory, "logs"));
  assert.ok(files.some((file) => file.endsWith(".log")));
  const reports = files.filter((file) => file.endsWith(".json"));
  assert.equal(reports.length, 1);
  const report = readFileSync(join(directory, "logs", reports[0]), "utf8");
  assert.doesNotMatch(report, /private-fixture|password|console\.error/);
  assert.equal(JSON.parse(report).exitCode, 7);
  assert.ok(JSON.parse(report).categories.includes("connection-refused"));
});
