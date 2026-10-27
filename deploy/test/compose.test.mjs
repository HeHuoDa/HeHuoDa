import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const docker = process.env.DOCKER_BIN || "docker";
const available =
  spawnSync(docker, ["compose", "version"], { encoding: "utf8" }).status === 0;

test(
  "real Compose resolves retained configuration and digest references for each release",
  { skip: !available },
  (t) => {
    const directory = mkdtempSync(join(tmpdir(), "hehuoda-compose-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const envFile = join(directory, ".env");
    writeFileSync(
      envFile,
      "POSTGRES_USER=test\nPOSTGRES_PASSWORD=test-only\nPOSTGRES_DB=test\nDATABASE_URL=postgresql://test:test-only@db:5432/test\nIMAGE_PREFIX=ghcr.io/hehuoda/hehuoda\n",
    );
    const source = readFileSync(
      new URL("../../compose.deploy.yaml", import.meta.url),
      "utf8",
    );
    for (const [digit, seconds] of [
      ["1", 47],
      ["2", 51],
    ]) {
      const sha = digit.repeat(40);
      const snapshot = join(directory, sha);
      mkdirSync(snapshot);
      writeFileSync(
        join(snapshot, "compose.deploy.yaml"),
        source.replace(
          "stop_grace_period: 30s",
          `stop_grace_period: ${seconds}s`,
        ),
      );
      const images = {
        api: `ghcr.io/hehuoda/hehuoda/api@sha256:${digit.repeat(64)}`,
        web: `ghcr.io/hehuoda/hehuoda/web@sha256:${digit.repeat(64)}`,
      };
      writeFileSync(
        join(snapshot, "release.json"),
        JSON.stringify({ sha, images }),
      );
      const result = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
      const { releaseContext, compose, validateDeploymentConfig } = await import(${JSON.stringify(new URL("../runtime.mjs", import.meta.url).href)});
      const context = releaseContext(${JSON.stringify(sha)}, ${JSON.stringify({ releaseDirectory: snapshot, images, tls: false, publicUrl: "" })});
      validateDeploymentConfig(${JSON.stringify(sha)}, context);
      console.log(compose(['config', '--format', 'json'], ${JSON.stringify(sha)}, { release: context }));
    `,
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            DOCKER_BIN: docker,
            DEPLOY_ENV_FILE: envFile,
            DEPLOY_STATE_DIR: join(directory, "state"),
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const config = JSON.parse(result.stdout);
      assert.equal(config.services.api.image, images.api);
      assert.equal(
        config.services.api.environment.WECHAT_LOGIN_ENABLED,
        "false",
      );
      assert.equal(
        config.services.api.environment.WECHAT_LOGIN_ADAPTER,
        "real",
      );
      assert.equal(
        config.services.api.environment.CAMPUS_VERIFICATION_ENABLED,
        "false",
      );
      assert.equal(config.services.api.environment.CAMPUS_TERMS, "[]");
      assert.equal(config.services.api.environment.CAMPUS_PROFILE_KEYS, "{}");
      assert.equal(
        config.services.api.environment.API_TRUSTED_PROXY_CIDRS,
        undefined,
      );
      assert.equal(config.services.api.ports, undefined);
      for (const service of ["db", "api", "web"])
        assert.deepEqual(Object.keys(config.services[service].networks), [
          "default",
        ]);
      assert.deepEqual(Object.keys(config.networks), ["default"]);
      assert.equal(config.services.web.image, images.web);
      assert.equal(config.services.api.stop_grace_period, `${seconds}s`);
    }
  },
);

test(
  "real Compose injects protected auth settings without changing database or web",
  { skip: !available },
  (t) => {
    const directory = mkdtempSync(join(tmpdir(), "hehuoda-auth-compose-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const envFile = join(directory, ".env");
    const settings = {
      ADMIN_ALLOWED_ORIGINS: "https://admin.example",
      ADMIN_SESSION_HOURS: "12",
      ADMIN_RATE_LOGIN_ACCOUNT: "5",
      ADMIN_RATE_LOGIN_SOURCE: "30",
      ADMIN_RATE_LOGIN_GLOBAL: "100",
      WECHAT_LOGIN_ENABLED: "true",
      WECHAT_APP_ID: "wxsynthetic",
      WECHAT_APP_SECRET: "synthetic-secret",
      CAMPUS_VERIFICATION_ENABLED: "true",
      CAMPUS_TERMS: JSON.stringify([
        {
          id: "synthetic",
          startAt: "2026-09-07T00:00:00+08:00",
          endAt: "2027-01-19T00:00:00+08:00",
        },
      ]),
      CAMPUS_SUBJECT_HMAC_KEY: Buffer.alloc(32, 1).toString("base64"),
      CAMPUS_PROFILE_KEYS: JSON.stringify({
        v1: Buffer.alloc(32, 2).toString("base64"),
      }),
      CAMPUS_PROFILE_KEY_ID: "v1",
      CAMPUS_RATE_SUBMIT_USER: "7",
    };
    writeFileSync(
      envFile,
      "POSTGRES_USER=test\nPOSTGRES_PASSWORD=test-only\nPOSTGRES_DB=test\nDATABASE_URL=postgresql://test:test-only@db:5432/test\nIMAGE_PREFIX=synthetic\nIMAGE_TAG=" +
        "1".repeat(40) +
        "\n" +
        Object.entries(settings)
          .map(([key, value]) => key + "=" + value)
          .join("\n") +
        "\n",
    );
    const result = spawnSync(
      docker,
      [
        "compose",
        "--env-file",
        envFile,
        "-f",
        fileURLToPath(new URL("../../compose.deploy.yaml", import.meta.url)),
        "config",
        "--format",
        "json",
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(result.stdout);
    for (const [key, value] of Object.entries(settings)) {
      assert.equal(config.services.api.environment[key], value, key);
      assert.equal(config.services.db.environment[key], undefined, key);
      assert.equal(config.services.web.environment?.[key], undefined, key);
    }
  },
);
