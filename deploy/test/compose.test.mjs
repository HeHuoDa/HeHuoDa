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
        config.services.api.environment.API_TRUSTED_PROXY_CIDRS,
        "172.30.135.3/32",
      );
      assert.equal(config.services.api.ports, undefined);
      assert.deepEqual(Object.keys(config.services.db.networks), ["database"]);
      assert.deepEqual(Object.keys(config.services.web.networks), ["proxy"]);
      assert.equal(
        config.services.web.networks.proxy.ipv4_address,
        "172.30.135.3",
      );
      assert.equal(config.services.api.networks.proxy.ipv4_address, undefined);
      assert.equal(config.networks.database.internal, true);
      assert.equal(config.services.web.image, images.web);
      assert.equal(config.services.api.stop_grace_period, `${seconds}s`);
    }
  },
);
