import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createArchiveManifest } from "../archive.mjs";

// Run after image smoke so the application images are reused, never rebuilt from workspace source.
test(
  "real archive prepare, replacement, failure recovery, offline rollback and retention",
  { timeout: 900_000 },
  async () => {
    const originalTag = process.env.IMAGE_TAG;
    assert.match(originalTag || "", /^[a-f0-9]{40}$/);
    const root = mkdtempSync(join(tmpdir(), "hehuoda-archive-integration-"));
    const project = `hehuoda-archive-${randomBytes(6).toString("hex")}`;
    const password = randomBytes(24).toString("hex");
    const env = {
      ...process.env,
      COMPOSE_PROJECT_NAME: project,
      POSTGRES_USER: "archive",
      POSTGRES_DB: "archive_test",
      POSTGRES_PASSWORD: password,
      DATABASE_URL: `postgresql://archive:${password}@db:5432/archive_test`,
      HTTP_BIND: "127.0.0.1",
      HTTP_PORT: "0",
      INGESTION_ENABLED: "false",
      DEPLOY_ROOT: root,
      DEPLOY_ENV_FILE: join(root, ".env"),
      DEPLOY_STATE_DIR: join(root, "state"),
      DEPLOY_BACKUP_DIR: join(root, "backups"),
      DEPLOY_TLS: "false",
      DEPLOY_PUBLIC_URL: "",
      DEPLOY_ARCHIVE_ACTIVATE: "true",
    };
    writeFileSync(
      env.DEPLOY_ENV_FILE,
      "# isolated integration configuration\n",
      { mode: 0o600 },
    );
    const aliases = [];
    const contexts = new Map();
    const run = (bin, args, options = {}) => {
      const result = spawnSync(bin, args, {
        env,
        encoding: "utf8",
        timeout: 300_000,
        ...options,
      });
      assert.equal(
        result.status,
        0,
        `${bin} ${args[0]} failed: ${result.stderr || result.error}`,
      );
      return result.stdout.trim();
    };
    const docker = (args, options) => run("docker", args, options);
    const state = () =>
      JSON.parse(
        readFileSync(join(env.DEPLOY_STATE_DIR, "current.json"), "utf8"),
      );
    const compose = (args, tag) =>
      docker(
        [
          "compose",
          "--env-file",
          env.DEPLOY_ENV_FILE,
          "-f",
          join(contexts.get(tag), "compose.deploy.yaml"),
          ...args,
        ],
        {
          env: {
            ...env,
            IMAGE_TAG: tag,
            API_IMAGE: `hehuoda-local/api:${tag}`,
            WEB_IMAGE: `hehuoda-local/web:${tag}`,
          },
        },
      );
    const deliver = (action, tag, expected = 0, extra = {}) => {
      const result = spawnSync(
        process.execPath,
        [
          new URL("../delivery.mjs", import.meta.url).pathname,
          action,
          tag,
          contexts.get(tag) || root,
        ],
        {
          env: { ...env, ...extra },
          encoding: "utf8",
          timeout: 300_000,
        },
      );
      assert.equal(result.status, expected, result.stdout + result.stderr);
      return result;
    };
    const snapshot = (tag) => ({
      state: readFileSync(join(env.DEPLOY_STATE_DIR, "current.json"), "utf8"),
      containers: ["api", "web", "db"].map((component) =>
        compose(["ps", "-q", component], tag),
      ),
      migrations: compose(
        [
          "exec",
          "-T",
          "db",
          "psql",
          "-U",
          "archive",
          "-d",
          "archive_test",
          "-Atc",
          "SELECT count(*) FROM schema_migrations",
        ],
        tag,
      ),
    });
    const candidate = async (broken = false) => {
      const tag = randomBytes(20).toString("hex");
      const directory = join(root, "releases", tag, "1-1");
      mkdirSync(directory, { recursive: true });
      copyFileSync(
        new URL("../../compose.deploy.yaml", import.meta.url),
        join(directory, "compose.deploy.yaml"),
      );
      contexts.set(tag, directory);
      for (const component of ["api", "web"]) {
        const image = `hehuoda-local/${component}:${tag}`;
        docker(["build", "-t", image, "-"], {
          input: `FROM hehuoda-local/${component}:${originalTag}\nLABEL hehuoda.acceptance=${tag}\n${broken && component === "web" ? "RUN printf 'invalid_directive;\\n' > /etc/nginx/conf.d/default.conf\n" : ""}`,
        });
        aliases.push(image);
      }
      const raw = join(directory, "images.tar");
      docker([
        "image",
        "save",
        "-o",
        raw,
        `hehuoda-local/api:${tag}`,
        `hehuoda-local/web:${tag}`,
      ]);
      run("gzip", ["-f", raw]);
      renameSync(`${raw}.gz`, join(directory, "images.tar.gz"));
      await createArchiveManifest({
        directory,
        sha: tag,
        repository: "HeHuoDa/HeHuoDa",
        runId: "1",
        runAttempt: "1",
        imagePrefix: "hehuoda-local",
        inspectImage: (image) => {
          const value = JSON.parse(docker(["image", "inspect", image]))[0];
          return {
            id: value.Id,
            platform: `${value.Os}/${value.Architecture}`,
          };
        },
      });
      return tag;
    };
    let cleanupTag;
    try {
      const first = await candidate();
      cleanupTag = first;
      deliver("prepare", first);
      assert.equal(
        existsSync(join(env.DEPLOY_STATE_DIR, "current.json")),
        false,
      );
      deliver("deploy", first);
      const second = await candidate();
      const before = snapshot(first);
      deliver("prepare", second);
      assert.deepEqual(
        snapshot(first),
        before,
        "prepare must preserve containers, state and migration count",
      );
      deliver("deploy", second, 1, { DEPLOY_ARCHIVE_ACTIVATE: "false" });
      assert.deepEqual(snapshot(first), before);
      const archive = join(contexts.get(second), "images.tar.gz");
      renameSync(archive, `${archive}.saved`);
      writeFileSync(archive, "corrupted archive");
      deliver("prepare", second, 1);
      assert.deepEqual(snapshot(first), before);
      rmSync(archive);
      renameSync(`${archive}.saved`, archive);
      deliver("deploy", second);
      cleanupTag = second;
      const failed = await candidate(true);
      const committed = readFileSync(
        join(env.DEPLOY_STATE_DIR, "current.json"),
        "utf8",
      );
      deliver("deploy", failed, 1);
      assert.equal(
        readFileSync(join(env.DEPLOY_STATE_DIR, "current.json"), "utf8"),
        committed,
      );
      assert.equal(state().sha, second);
      assert.equal(
        compose(
          [
            "exec",
            "-T",
            "web",
            "wget",
            "-q",
            "-O",
            "-",
            "http://127.0.0.1/api/v1/health/ready",
          ],
          second,
        ).includes('"ready"'),
        true,
      );
      rmSync(join(contexts.get(first), "images.tar.gz"));
      deliver("rollback", first);
      cleanupTag = first;
      assert.equal(
        state().sha,
        first,
        "rollback works without the archive or any artifact lookup",
      );
      deliver("rollback", second);
      cleanupTag = second;
      const backups = readdirSync(env.DEPLOY_BACKUP_DIR);
      for (let index = 0; index < 2; index++) {
        const tag = await candidate();
        deliver("deploy", tag);
        cleanupTag = tag;
      }
      assert.equal(state().history.length, 3);
      assert.equal(
        state().history.some((record) => record.sha === first),
        false,
      );
      assert.equal(
        existsSync(contexts.get(first)),
        false,
        "fourth success retires only the oldest successful release",
      );
      for (const file of backups)
        assert.equal(existsSync(join(env.DEPLOY_BACKUP_DIR, file)), true);
      deliver("rollback", first, 1);
      rmSync(join(contexts.get(second), "images.tar.gz"));
      deliver("rollback", second);
      cleanupTag = second;
      assert.equal(state().sha, second);
      console.log(
        "PASS: real archive delivery, unchanged prepare, rejected corruption/activation, failure recovery, offline rollback and three-version retention",
      );
    } finally {
      try {
        if (cleanupTag)
          compose(["down", "--volumes", "--remove-orphans"], cleanupTag);
      } finally {
        for (const alias of aliases)
          spawnSync("docker", ["image", "rm", alias], { env, stdio: "ignore" });
        rmSync(root, { recursive: true, force: true });
      }
    }
  },
);
