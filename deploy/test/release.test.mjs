import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { release } from "../release.mjs";

const old = "1".repeat(40);
const next = "2".repeat(40);

function fixture(
  t,
  {
    first = false,
    failMigration = false,
    failCheck = false,
    failRollback = false,
    backupFails = false,
    changeDatabase = false,
    missingApi = false,
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "hehuoda-release-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  if (!first)
    writeFileSync(
      join(directory, "current.json"),
      JSON.stringify({
        sha: old,
        releaseDirectory: join(directory, "releases", old),
      }),
    );
  const events = [];
  const operations = {
    releaseContext(tag, record) {
      if (record && !record.releaseDirectory)
        throw new Error("Missing previous release directory");
      return record || { releaseDirectory: join(directory, "releases", tag) };
    },
    compose(args, tag, options) {
      events.push({ command: args[0], args, tag, context: options?.release });
      if (args[0] === "ps") return first || missingApi ? "" : "old-container";
      if (args[0] === "config")
        return JSON.stringify({
          name: "test-deployment",
          services: {
            api: { image: `test/api:${old}` },
            db: {
              image:
                changeDatabase && tag === next ? "postgres:18" : "postgres:17",
              volumes: [{ source: "database" }],
            },
          },
        });
      if (args[0] === "exec") return first ? "0" : "1";
      if (args[0] === "run" && failMigration)
        throw new Error("Migration failed");
      if (args[0] === "up" && tag === old && failRollback)
        throw new Error("Old application failed");
      return "";
    },
    docker() {
      return `test/api:${old}`;
    },
    validateDeploymentConfig() {},
    backup(tag) {
      events.push({ command: "backup", tag });
      if (backupFails) throw new Error("Restore verification failed");
      return "isolated.dump";
    },
    verifyApplication(tag) {
      events.push({ command: "check", tag });
      if (failCheck && tag === next) throw new Error("New application failed");
    },
    async verifyPublicApplication() {},
  };
  return {
    directory,
    events,
    operations,
    state: () =>
      JSON.parse(readFileSync(join(directory, "current.json"), "utf8")),
  };
}

test("successful update backs up before migration and advances state only after readiness", async (t) => {
  const f = fixture(t);
  await release(next, f.operations, f.directory);
  assert.equal(f.state().sha, next);
  assert.equal(f.state().previous, old);
  assert.ok(
    f.events.findIndex((e) => e.command === "backup") <
      f.events.findIndex((e) => e.command === "run"),
  );
  assert.equal(f.events.at(-1).command, "check");
  assert.equal(existsSync(join(f.directory, "release.lock")), false);
});

test("empty first installation skips backup and records its first SHA", async (t) => {
  const f = fixture(t, { first: true });
  await release(next, f.operations, f.directory);
  assert.equal(f.state().previous, null);
  assert.equal(
    f.events.some((e) => e.command === "backup"),
    false,
  );
});

test("backup restore failure prevents migration and application replacement", async (t) => {
  const f = fixture(t, { backupFails: true });
  await assert.rejects(release(next, f.operations, f.directory));
  assert.equal(f.state().sha, old);
  assert.equal(
    f.events.some((e) => e.command === "run"),
    false,
  );
  assert.equal(
    f.events.some((e) => e.command === "up" && e.args.includes("api")),
    false,
  );
});

test("migration failure leaves old applications and release state intact", async (t) => {
  const f = fixture(t, { failMigration: true });
  await assert.rejects(release(next, f.operations, f.directory));
  assert.equal(f.state().sha, old);
  assert.equal(
    f.events.some((e) => e.command === "up" && e.args.includes("api")),
    false,
  );
});

test("failed readiness restores old application without executing any database downgrade", async (t) => {
  const f = fixture(t, { failCheck: true });
  const previousDirectory = join(f.directory, "releases", old);
  writeFileSync(
    join(f.directory, "current.json"),
    JSON.stringify({ sha: old, releaseDirectory: previousDirectory }),
  );
  await assert.rejects(release(next, f.operations, f.directory));
  assert.equal(f.state().sha, old);
  assert.ok(f.events.some((e) => e.command === "up" && e.tag === old));
  assert.equal(f.events.at(-1).tag, old);
  assert.equal(f.events.filter((e) => e.command === "run").length, 1);
  assert.equal(
    f.events.find((e) => e.command === "up" && e.tag === old).context
      .releaseDirectory,
    previousDirectory,
  );
  assert.equal(
    f.events.find(
      (e) => e.command === "up" && e.tag === next && e.args.includes("api"),
    ).context.releaseDirectory,
    join(f.directory, "releases", next),
  );
});

test("legacy release state without its configuration refuses replacement before pulling or migrating", async (t) => {
  const f = fixture(t);
  writeFileSync(
    join(f.directory, "current.json"),
    JSON.stringify({ sha: old }),
  );
  await assert.rejects(
    release(next, f.operations, f.directory),
    /release state was not advanced/,
  );
  assert.equal(
    f.events.some((event) => ["pull", "run", "up"].includes(event.command)),
    false,
  );
});

test("database image or storage changes require a separate maintenance plan before replacement", async (t) => {
  const f = fixture(t, { changeDatabase: true });
  await assert.rejects(release(next, f.operations, f.directory));
  assert.equal(
    f.events.some((event) => ["pull", "run", "up"].includes(event.command)),
    false,
  );
  assert.equal(f.state().sha, old);
});

test("a missing application container does not bypass recorded database protection", async (t) => {
  const f = fixture(t, { changeDatabase: true, missingApi: true });
  await assert.rejects(release(next, f.operations, f.directory));
  assert.equal(
    f.events.some((event) => ["pull", "run", "up"].includes(event.command)),
    false,
  );
});

test("rollback failure and first-deployment failure have distinct actionable errors", async (t) => {
  const rollback = fixture(t, { failCheck: true, failRollback: true });
  await assert.rejects(
    release(next, rollback.operations, rollback.directory),
    /ROLLBACK FAILED/,
  );
  assert.equal(rollback.state().sha, old);
  const first = fixture(t, { first: true, failCheck: true });
  await assert.rejects(
    release(next, first.operations, first.directory),
    /FIRST DEPLOYMENT FAILED/,
  );
  assert.equal(existsSync(join(first.directory, "current.json")), false);
});

test("same SHA is checked without duplicate migrations; concurrent release locks are preserved", async (t) => {
  const f = fixture(t);
  await release(old, f.operations, f.directory);
  assert.equal(
    f.events.some((e) => e.command === "run" || e.command === "pull"),
    false,
  );
  mkdirSync(join(f.directory, "release.lock"));
  await assert.rejects(
    release(next, f.operations, f.directory),
    /Another release owns/,
  );
  assert.equal(existsSync(join(f.directory, "release.lock")), true);
});
