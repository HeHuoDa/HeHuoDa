import { randomUUID } from "node:crypto";
import { closeSync, openSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { backupDirectory, compose, docker, waitFor } from "./runtime.mjs";
import { compareIntegrity, readBusinessIntegrity } from "./integrity.mjs";

export const RESTORE_CONTAINER_LABEL = "backup-verification";

export function removeVerificationContainer(container, run = docker) {
  const label = run([
    "inspect",
    "--format",
    '{{ index .Config.Labels "hehuoda.task" }}',
    container,
  ]);
  if (label !== RESTORE_CONTAINER_LABEL) {
    throw new Error("Refusing to remove a container with an unexpected label");
  }
  run(["rm", "-f", "-v", container]);
}

// 阶段二要求恢复后仍能核对业务关系，不只是「四类计数非空」。默认仍只做
// 四类计数，避免改变发布流水线的既有门禁；显式传入 integrity 摘要时按差异判定。
export function assertRestoredIntegrity(expected, actual) {
  const differences = compareIntegrity(expected, actual);
  if (differences.length) {
    const detail = differences
      .map((item) =>
        item.kind === "count"
          ? `${item.object}:${item.before}->${item.after}`
          : `${item.object}:rows ${item.beforeRows}->${item.afterRows}`,
      )
      .join(", ");
    throw new Error("Restored business integrity differs: " + detail);
  }
  return { differences: [] };
}

// A dump is retained only after pg_dump has exited successfully.
export function backup(tag, context) {
  mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  const file = join(
    backupDirectory,
    `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID()}.dump`,
  );
  const fd = openSync(file, "wx", 0o600);
  try {
    compose(
      [
        "exec",
        "-T",
        "db",
        "sh",
        "-ec",
        'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl',
      ],
      tag,
      { stdio: ["ignore", fd, "pipe"], release: context },
    );
  } catch (error) {
    closeSync(fd);
    unlinkSync(file);
    throw error;
  }
  closeSync(fd);
  verifyBackup(file);
  return file;
}

// Restore only into a new container with no network and its own disposable anonymous volume.
// There is deliberately no automatic restore-into-production command.
// `integrity` 是需要对照的业务摘要（见 deploy/integrity.mjs）；省略时保持四类计数门禁。
export function verifyBackup(file, operations = {}) {
  const run = operations.docker || docker;
  const wait = operations.waitFor || waitFor;
  const container = `hehuoda-restore-${randomUUID()}`;
  const password = randomUUID();
  let created = false;
  try {
    run(
      [
        "run",
        "-d",
        "--name",
        container,
        "--label",
        `hehuoda.task=${RESTORE_CONTAINER_LABEL}`,
        "--network",
        "none",
        "--memory",
        "512m",
        "-e",
        "POSTGRES_USER=restore",
        "-e",
        "POSTGRES_DB=restore",
        "-e",
        "POSTGRES_PASSWORD",
        "postgres:17.10-bookworm",
      ],
      { env: { ...process.env, POSTGRES_PASSWORD: password } },
    );
    created = true;
    wait(() =>
      run([
        "exec",
        container,
        "pg_isready",
        // The image's temporary init server accepts sockets before restarting.
        "-h",
        "127.0.0.1",
        "-U",
        "restore",
        "-d",
        "restore",
      ]).includes("accepting connections"),
    );
    const fd = openSync(file, "r");
    try {
      run(
        [
          "exec",
          "-i",
          container,
          "pg_restore",
          "-U",
          "restore",
          "-d",
          "restore",
          "--exit-on-error",
          "--no-owner",
          "--no-acl",
        ],
        { stdio: [fd, "pipe", "pipe"] },
      );
    } finally {
      closeSync(fd);
    }
    const counts = JSON.parse(
      run([
        "exec",
        container,
        "psql",
        "-U",
        "restore",
        "-d",
        "restore",
        "-v",
        "ON_ERROR_STOP=1",
        "-Atc",
        "SELECT json_build_object('migrations', (SELECT count(*) FROM schema_migrations), 'colleges', (SELECT count(*) FROM colleges), 'competitions', (SELECT count(*) FROM competitions), 'ingestionRuns', (SELECT count(*) FROM ingestion_runs));",
      ]),
    );
    if (operations.integrity) {
      const actual = readBusinessIntegrity(container, { docker: run });
      assertRestoredIntegrity(operations.integrity, actual);
      return { ...counts, integrity: actual };
    }
    return counts;
  } finally {
    if (created) removeVerificationContainer(container, run);
  }
}

/**
 * 对一个在线数据库读取业务摘要，用于与隔离恢复结果比较。
 * 只接受可执行 psql 的容器名；不接受任意连接串，避免误连生产库。
 */
export function readIntegrityFromContainer(container, operations = {}) {
  return readBusinessIntegrity(container, {
    docker: operations.docker || docker,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "verify" && process.argv[3]) {
      verifyBackup(process.argv[3]);
      console.log("Isolated backup restore verified");
    } else if (process.argv.length === 2) {
      console.log(`Verified backup: ${backup()}`);
    } else {
      throw new Error(
        "Usage: node deploy/backup.mjs [verify /absolute/backup.dump]",
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
