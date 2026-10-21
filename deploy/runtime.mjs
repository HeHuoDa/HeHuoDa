import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export const root = resolve(import.meta.dirname, "..");
export const stateDirectory = resolve(
  process.env.DEPLOY_STATE_DIR || resolve(import.meta.dirname, "state"),
);
export const backupDirectory = resolve(
  process.env.DEPLOY_BACKUP_DIR || resolve(import.meta.dirname, "backups"),
);
export const envFile = resolve(
  process.env.DEPLOY_ENV_FILE || resolve(import.meta.dirname, ".env"),
);

export function docker(args, options = {}) {
  const result = spawnSync(process.env.DOCKER_BIN || "docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 600_000,
    ...options,
  });
  if (result.error || result.status !== 0) {
    // Do not print Docker arguments, environment values or captured stderr: they may contain secrets.
    const logs = resolve(stateDirectory, "logs");
    mkdirSync(logs, { recursive: true, mode: 0o700 });
    const log = resolve(logs, `${Date.now()}-${randomUUID()}.log`);
    writeFileSync(
      log,
      result.stderr ||
        result.error?.message ||
        "Docker exited without diagnostics",
      { mode: 0o600 },
    );
    throw new Error(
      `Docker operation failed (${args[0]}); diagnostics: ${log}`,
    );
  }
  return result.stdout?.trim() || "";
}

function activeTag() {
  if (process.env.IMAGE_TAG) return sha(process.env.IMAGE_TAG);
  const state = resolve(stateDirectory, "current.json");
  return existsSync(state)
    ? sha(JSON.parse(readFileSync(state, "utf8")).sha)
    : undefined;
}

export function compose(args, tag = activeTag(), options = {}) {
  const files = ["-f", resolve(root, "compose.deploy.yaml")];
  if (process.env.DEPLOY_TLS === "true")
    files.push("-f", resolve(root, "compose.tls.yaml"));
  return docker(["compose", "--env-file", envFile, ...files, ...args], {
    ...options,
    env: { ...process.env, ...(tag ? { IMAGE_TAG: tag } : {}) },
  });
}

export function sha(value) {
  if (!/^[a-f0-9]{40}$/.test(value || ""))
    throw new Error("Release requires a full lowercase commit SHA");
  return value;
}

export function waitFor(check, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      if (check()) return;
    } catch {
      // A starting dependency may temporarily fail.
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  }
  throw new Error("Service did not become ready before the deadline");
}

export function verifyApplication(tag) {
  compose(
    [
      "exec",
      "-T",
      "api",
      "node",
      "--input-type=module",
      "-e",
      `
    for (const path of ['/health/ready', '/colleges', '/competitions']) {
      const r = await fetch('http://127.0.0.1:3001/api/v1' + path);
      if (!r.ok || !(r.headers.get('content-type') || '').includes('application/json')) process.exit(1);
      const value = await r.json();
      if (path === '/health/ready' && value.status !== 'ready') process.exit(1);
      if (path === '/colleges' && !Array.isArray(value)) process.exit(1);
      if (path === '/competitions' && !Array.isArray(value.items)) process.exit(1);
    }
  `,
    ],
    tag,
  );
  compose(["exec", "-T", "web", "nginx", "-t"], tag);
  compose(
    ["exec", "-T", "web", "wget", "-q", "--spider", "http://127.0.0.1/_health"],
    tag,
  );
  if (process.env.DEPLOY_TLS !== "true") {
    compose(
      [
        "exec",
        "-T",
        "web",
        "wget",
        "-q",
        "-O",
        "/dev/null",
        "http://127.0.0.1/api/v1/health/ready",
      ],
      tag,
    );
  }
}

export function validateDeploymentConfig(tag) {
  const config = JSON.parse(compose(["config", "--format", "json"], tag));
  const db = config.services.db.environment;
  const connection = new URL(config.services.api.environment.DATABASE_URL);
  if (
    connection.hostname !== "db" ||
    connection.port !== "5432" ||
    decodeURIComponent(connection.username) !== db.POSTGRES_USER ||
    decodeURIComponent(connection.password) !== db.POSTGRES_PASSWORD ||
    decodeURIComponent(connection.pathname.slice(1)) !== db.POSTGRES_DB
  ) {
    throw new Error(
      "DATABASE_URL must match POSTGRES_* and connect to db:5432",
    );
  }
  if (
    process.env.DEPLOY_TLS === "true" &&
    !process.env.DEPLOY_PUBLIC_URL?.startsWith("https://")
  ) {
    throw new Error(
      "TLS deployment requires DEPLOY_PUBLIC_URL=https://your-host",
    );
  }
}

export async function verifyPublicApplication() {
  if (!process.env.DEPLOY_PUBLIC_URL) return;
  const base = new URL(process.env.DEPLOY_PUBLIC_URL);
  if (base.username || base.password || base.search || base.hash)
    throw new Error("Invalid public deployment URL");
  for (const path of [
    "/",
    "/api/v1/health/ready",
    "/api/v1/colleges",
    "/api/v1/competitions",
  ]) {
    const response = await fetch(new URL(path, base), {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Public application check failed");
    if (path !== "/") {
      if (
        !(response.headers.get("content-type") || "").includes(
          "application/json",
        )
      )
        throw new Error("Public API returned non-JSON");
      const value = await response.json();
      if (path.endsWith("/ready") && value.status !== "ready")
        throw new Error("Public API is not ready");
      if (path.endsWith("/colleges") && !Array.isArray(value))
        throw new Error("Public college query returned an invalid shape");
      if (path.endsWith("/competitions") && !Array.isArray(value.items))
        throw new Error("Public competition query returned an invalid shape");
    } else {
      if (
        !(response.headers.get("content-type") || "").includes("text/html") ||
        !(await response.text()).includes("<html")
      )
        throw new Error("Public H5 entry is not HTML");
    }
  }
}
