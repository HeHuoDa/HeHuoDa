import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { colleges } from "../packages/client-domain/src/colleges.ts";

const temporary = mkdtempSync(join(tmpdir(), "hehuoda-image-smoke-"));
const project = `hehuoda-smoke-${randomBytes(6).toString("hex")}`;
const password = randomBytes(24).toString("hex");
Object.assign(process.env, {
  COMPOSE_PROJECT_NAME: project,
  POSTGRES_USER: "smoke",
  POSTGRES_DB: "hehuoda_smoke_test",
  POSTGRES_PASSWORD: password,
  DATABASE_URL: `postgresql://smoke:${password}@db:5432/hehuoda_smoke_test`,
  HTTP_BIND: "127.0.0.1",
  HTTP_PORT: "0",
  INGESTION_ENABLED: "false",
  DEPLOY_TLS: "false",
  DEPLOY_PUBLIC_URL: "",
  IMAGE_PREFIX: process.env.IMAGE_PREFIX || "hehuoda-local",
  IMAGE_TAG: process.env.IMAGE_TAG || "0".repeat(40),
  DEPLOY_ENV_FILE: join(temporary, ".env"),
  DEPLOY_BACKUP_DIR: join(temporary, "backups"),
  DEPLOY_STATE_DIR:
    process.env.DEPLOY_STATE_DIR || join(import.meta.dirname, "state", project),
});
writeFileSync(process.env.DEPLOY_ENV_FILE, "# isolated smoke configuration\n", {
  mode: 0o600,
});
const { compose, docker, waitFor } = await import("./runtime.mjs");
const { validateDeploymentConfig, verifyApplication, verifyPublicApplication } =
  await import("./runtime.mjs");
const { release, configurationHash } = await import("./release.mjs");
const { backup, verifyBackup } = await import("./backup.mjs");
let base;
const imageAliases = [];
try {
  if (!process.argv.includes("--no-build")) compose(["build", "api", "web"]);
  compose(["up", "-d", "--wait", "--wait-timeout", "120", "db"]);
  compose(["up", "-d", "--no-deps", "api"]);
  waitFor(() => {
    compose([
      "exec",
      "-T",
      "api",
      "node",
      "-e",
      "fetch('http://127.0.0.1:3001/api/v1/health/ready').then(r=>process.exit(r.status===503?0:1)).catch(()=>process.exit(1))",
    ]);
    return true;
  });
  for (let count = 0; count < 2; count++)
    compose([
      "run",
      "--rm",
      "--no-deps",
      "api",
      "node",
      "dist-openapi/scripts/migrate.js",
    ]);
  compose(["up", "-d", "--wait", "--wait-timeout", "180", "api", "web"]);
  const fixture = JSON.parse(
    readFileSync(new URL("./test/fixture.json", import.meta.url), "utf8"),
  );
  fixture.colleges = colleges.map((college, order) => ({ ...college, order }));
  compose(
    [
      "exec",
      "-T",
      "api",
      "node",
      "--input-type=module",
      "-e",
      `
    import { Pool } from 'pg';
    import { importBatch, validateInput } from './dist/competitions/import.js';
    let input = ''; for await (const chunk of process.stdin) input += chunk;
    const pool = new Pool({connectionString: process.env.DATABASE_URL});
    try { await importBatch(pool, validateInput(JSON.parse(input)), {production:true, confirmPublished:true}); }
    finally { await pool.end(); }
  `,
    ],
    undefined,
    { input: JSON.stringify(fixture), stdio: ["pipe", "pipe", "pipe"] },
  );
  base = `http://${compose(["port", "web", "80"]).trim()}`;

  async function json(path, status = 200) {
    const response = await fetch(`${base}${path}`, {
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, status, path);
    assert.match(
      response.headers.get("content-type") || "",
      /application\/json/,
      path,
    );
    return response.json();
  }
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.match(home.headers.get("cache-control") || "", /no-store/);
  const html = await home.text();
  assert.match(html, /<html/i);
  const assets = [
    ...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g),
  ].map((match) => match[1]);
  assert.ok(assets.length > 0, "H5 must reference built assets");
  for (const asset of assets) {
    const response = await fetch(new URL(asset, base));
    assert.equal(response.status, 200, asset);
    assert.match(
      response.headers.get("cache-control") || "",
      /immutable/,
      asset,
    );
  }
  for (const path of [
    "/assets/absent.js",
    "/static/absent.svg",
    "/absent.js",
    "/docs",
    "/docs-json",
  ]) {
    assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  }
  const legacy = await fetch(
    `${base}/home/competitions/smoke-competition?stage=smoke-stage`,
    { redirect: "manual" },
  );
  assert.equal(legacy.status, 302);
  assert.match(
    legacy.headers.get("location"),
    /^\/#\/pages\/home\/competition\?id=smoke-competition&stage=smoke-stage$/,
  );
  assert.equal((await fetch(`${base}/pages/home/competition`)).status, 200);
  for (const [path, expected] of [
    [
      "/home/competitions/smoke-competition/?id=other&%69d=third&stage=a&stage=b",
      "/#/pages/home/competition?id=smoke-competition&stage=a&stage=b",
    ],
    [
      "/my/teams/?section=applications&%73ection=other",
      "/#/pages/profile/index?section=teams",
    ],
    ["/teams/new/?next=%2Fhome", "/#/pages/teams/new?next=%2Fhome"],
    ["/teams/team-1/?id=other", "/#/pages/teams/detail?id=team-1"],
  ]) {
    const response = await fetch(`${base}${path}`, { redirect: "manual" });
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get("location"), expected, path);
  }
  assert.equal((await json("/api/v1/health/ready")).status, "ready");
  assert.equal((await json("/api/v1/health")).status, "ok");
  assert.ok((await json("/api/v1/colleges")).some((c) => c.id === "law"));
  assert.equal((await json("/api/v1/competitions")).totalCompetitions, 1);
  assert.equal(
    (await json("/api/v1/competitions/smoke-competition")).id,
    "smoke-competition",
  );
  for (const path of ["/api/v1/absent", "/api/v1/absent.js"])
    await json(path, 404);

  const dump = backup();
  assert.deepEqual(verifyBackup(dump), {
    migrations: 3,
    colleges: colleges.length,
    competitions: 1,
    ingestionRuns: 0,
  });
  console.log(
    "PASS: H5, assets, cache, deep links, JSON routing, real queries and isolated backup restore",
  );

  // Exercise actual replacement and failure recovery against the isolated stack.
  // The only test seam replaces registry pulls with local image existence checks.
  const originalTag = process.env.IMAGE_TAG;
  const successTag = randomBytes(20).toString("hex");
  const failedTag = randomBytes(20).toString("hex");
  const prefix = process.env.IMAGE_PREFIX;
  for (const [service, tag] of [
    ["api", successTag],
    ["web", successTag],
    ["api", failedTag],
  ]) {
    const image = `${prefix}/${service}:${tag}`;
    docker(["tag", `${prefix}/${service}:${originalTag}`, image]);
    imageAliases.push(image);
  }
  const failedImage = `${prefix}/web:${failedTag}`;
  docker(["build", "-t", failedImage, "-"], {
    input: `FROM ${prefix}/web:${originalTag}\nRUN printf 'invalid_directive;\\n' > /etc/nginx/conf.d/default.conf\n`,
    stdio: ["pipe", "pipe", "pipe"],
  });
  imageAliases.push(failedImage);
  const releaseState = join(temporary, "release-state");
  mkdirSync(releaseState);
  writeFileSync(
    join(releaseState, "current.json"),
    JSON.stringify({
      sha: originalTag,
      releaseDirectory: resolve(import.meta.dirname, ".."),
      configurationHash: configurationHash(
        JSON.parse(compose(["config", "--format", "json"], originalTag)),
      ),
    }),
  );
  const localOperations = {
    // The smoke seam uses locally built tags instead of a registry manifest.
    releaseContext(_tag, record) {
      return (
        record || {
          releaseDirectory: resolve(import.meta.dirname, ".."),
          tls: false,
          publicUrl: "",
        }
      );
    },
    compose(args, tag, options) {
      if (args[0] === "pull") {
        for (const service of ["api", "web"])
          docker(["image", "inspect", `${prefix}/${service}:${tag}`]);
        return "";
      }
      const adjusted = [...args];
      if (tag === failedTag && adjusted.includes("--wait-timeout"))
        adjusted[adjusted.indexOf("--wait-timeout") + 1] = "15";
      return compose(adjusted, tag, options);
    },
    docker,
    backup,
    validateDeploymentConfig,
    verifyApplication,
    verifyPublicApplication,
  };
  await release(successTag, localOperations, releaseState);
  assert.equal(
    JSON.parse(readFileSync(join(releaseState, "current.json"), "utf8")).sha,
    successTag,
  );
  await assert.rejects(release(failedTag, localOperations, releaseState));
  assert.equal(
    JSON.parse(readFileSync(join(releaseState, "current.json"), "utf8")).sha,
    successTag,
  );
  process.env.IMAGE_TAG = successTag;
  base = `http://${compose(["port", "web", "80"]).trim()}`;
  assert.equal(
    (await json("/api/v1/competitions/smoke-competition")).id,
    "smoke-competition",
  );
  console.log(
    "PASS: actual isolated release, failed candidate recovery and preserved business data",
  );

  compose(["stop", "db"]);
  assert.deepEqual(
    Object.keys(await json("/api/v1/health/ready", 503)).sort(),
    ["requestId", "status"],
  );
  assert.equal((await json("/api/v1/health")).status, "ok");
  compose(["up", "-d", "--wait", "--wait-timeout", "120", "db"]);
  waitFor(() => {
    compose([
      "exec",
      "-T",
      "api",
      "node",
      "-e",
      "fetch('http://127.0.0.1:3001/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
    ]);
    return true;
  });
  assert.equal(
    (await json("/api/v1/competitions/smoke-competition")).id,
    "smoke-competition",
  );

  const api = compose(["ps", "-q", "api"]);
  const before = Number(
    docker(["inspect", "--format", "{{.RestartCount}}", api]),
  );
  // Kill node, not an intentional docker stop, to exercise the runtime restart policy.
  try {
    compose(
      ["exec", "-T", "-u", "root", "api", "sh", "-c", "kill -9 $(pidof node)"],
      undefined,
    );
  } catch {
    /* Exec may lose its connection when the process exits; RestartCount below must increase. */
  }
  waitFor(
    () =>
      Number(docker(["inspect", "--format", "{{.RestartCount}}", api])) >
      before,
  );
  compose(["up", "-d", "--wait", "--wait-timeout", "180", "api"]);
  // Nginx upstream may still refer to a replaced API IP; a release always recreates web too.
  compose(["up", "-d", "--force-recreate", "--no-deps", "--wait", "web"]);
  base = `http://${compose(["port", "web", "80"]).trim()}`;
  assert.equal((await json("/api/v1/health/ready")).status, "ready");
  compose(["down"]);
  compose(["up", "-d", "--wait", "--wait-timeout", "180"]);
  base = `http://${compose(["port", "web", "80"]).trim()}`;
  assert.equal(
    (await json("/api/v1/competitions/smoke-competition")).id,
    "smoke-competition",
  );
  console.log(
    "PASS: database outage/recovery, process crash restart and persistent data after stack rebuild",
  );
} catch (error) {
  console.error(error);
  // Raw container logs may contain request data; only runtime's safe reports are exported.
  process.exitCode = 1;
} finally {
  // project is generated here, never supplied by the caller; cleanup affects only this test stack.
  try {
    compose(["down", "--volumes", "--remove-orphans"]);
  } catch {
    console.error(
      `Cleanup failed for isolated project ${project}; inspect it manually`,
    );
    process.exitCode = 1;
  }
  for (const alias of imageAliases) {
    try {
      docker(["image", "rm", alias]);
    } catch {
      console.error(`Could not remove temporary image alias ${alias}`);
      process.exitCode = 1;
    }
  }
  rmSync(temporary, { recursive: true, force: true });
}
