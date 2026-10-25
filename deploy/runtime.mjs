import { spawnSync } from "node:child_process";
import { resolve, isAbsolute } from "node:path";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { readManifest } from "./manifest.mjs";

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

export function releaseContext(tag, record) {
  if (
    record &&
    (!record.releaseDirectory || !isAbsolute(record.releaseDirectory))
  )
    throw new Error(
      "Previous release lacks an absolute configuration directory; adopt its verified release metadata before updating",
    );
  const releaseDirectory =
    record?.releaseDirectory || process.env.DEPLOY_RELEASE_DIR || root;
  const manifest = readManifest(releaseDirectory, tag);
  const images = manifest.images;
  if (
    record?.images &&
    (record.images.api !== images.api || record.images.web !== images.web)
  )
    throw new Error(
      "Recorded release digests differ from its retained manifest",
    );
  if (record?.delivery && record.delivery !== (manifest.delivery || "registry"))
    throw new Error("Recorded delivery type differs from retained manifest");
  if (
    manifest.delivery === "archive" &&
    record?.imageIds &&
    ["api", "web"].some(
      (component) =>
        record.imageIds[component] !== manifest.imageIds[component],
    )
  )
    throw new Error("Recorded image identities differ from retained manifest");
  return {
    releaseDirectory,
    images,
    delivery: manifest.delivery || "registry",
    ...(manifest.delivery === "archive"
      ? { imageIds: manifest.imageIds, platform: manifest.platform }
      : record?.imageIds
        ? { imageIds: record.imageIds }
        : {}),
    configurationHash: record?.configurationHash,
    tls: record?.tls ?? process.env.DEPLOY_TLS === "true",
    publicUrl: record?.publicUrl ?? process.env.DEPLOY_PUBLIC_URL ?? "",
  };
}

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
    // Only fixed categories are exportable. Raw stderr can contain credentials or data.
    const categories = Object.entries({
      "connection-refused": /connection refused/i,
      "server-restarting": /shutting down|starting up|terminated abnormally/i,
      "out-of-memory": /out of memory|cannot allocate memory|oom/i,
      "permission-denied":
        /permission denied|authentication failed|unauthorized/i,
      "archive-invalid":
        /not a valid archive|unsupported version.*header|unexpected end of file/i,
      "sql-error": /pg_restore: error:|ERROR:|SQLSTATE/i,
      timeout: /timed out|timeout/i,
    })
      .filter(([, pattern]) => pattern.test(result.stderr || ""))
      .map(([name]) => name);
    writeFileSync(
      `${log}.json`,
      JSON.stringify({
        operation: [
          "compose",
          "exec",
          "run",
          "pull",
          "inspect",
          "build",
        ].includes(args[0])
          ? args[0]
          : "other",
        exitCode: result.status,
        categories: categories.length ? categories : ["unclassified"],
      }) + "\n",
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
  let { release: context, ...runOptions } = options;
  const state = resolve(stateDirectory, "current.json");
  if (!context && existsSync(state)) {
    const record = JSON.parse(readFileSync(state, "utf8"));
    if (record.sha === tag) context = releaseContext(tag, record);
  }
  const directory = context?.releaseDirectory || root;
  const files = ["-f", resolve(directory, "compose.deploy.yaml")];
  if (context ? context.tls : process.env.DEPLOY_TLS === "true")
    files.push("-f", resolve(directory, "compose.tls.yaml"));
  return docker(["compose", "--env-file", envFile, ...files, ...args], {
    ...runOptions,
    env: {
      ...process.env,
      ...(tag ? { IMAGE_TAG: tag } : {}),
      ...(context?.images
        ? { API_IMAGE: context.images.api, WEB_IMAGE: context.images.web }
        : {}),
    },
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

export function verifyApplication(tag, context) {
  const run = (args) => compose(args, tag, { release: context });
  run([
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
  ]);
  run(["exec", "-T", "web", "nginx", "-t"]);
  run([
    "exec",
    "-T",
    "web",
    "wget",
    "-q",
    "--spider",
    "http://127.0.0.1/_health",
  ]);
  if (!(context ? context.tls : process.env.DEPLOY_TLS === "true")) {
    run([
      "exec",
      "-T",
      "web",
      "wget",
      "-q",
      "-O",
      "/dev/null",
      "http://127.0.0.1/api/v1/health/ready",
    ]);
  }
}

export function validateDeploymentConfig(tag, context) {
  const config = JSON.parse(
    compose(["config", "--format", "json"], tag, { release: context }),
  );
  const db = config.services.db.environment;
  if (
    context?.images &&
    (config.services.api.image !== context.images.api ||
      config.services.web.image !== context.images.web)
  )
    throw new Error(
      "Release configuration must use its verified API/Web digests",
    );
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
    (context ? context.tls : process.env.DEPLOY_TLS === "true") &&
    !(context?.publicUrl ?? process.env.DEPLOY_PUBLIC_URL)?.startsWith(
      "https://",
    )
  ) {
    throw new Error(
      "TLS deployment requires DEPLOY_PUBLIC_URL=https://your-host",
    );
  }
}

const sleepFor = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

// One probe of a public path. Reasons are fixed strings so the log stays free
// of hosts, URLs and credentials.
async function probePublicPath(path, base, fetchImpl) {
  try {
    const response = await fetchImpl(new URL(path, base), {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      return {
        ok: false,
        reason: "status",
        code: String(response.status),
        message: "Public application check failed",
      };
    if (path === "/") {
      if (
        !(response.headers.get("content-type") || "").includes("text/html") ||
        !(await response.text()).includes("<html")
      )
        return {
          ok: false,
          reason: "not-html",
          message: "Public H5 entry is not HTML",
        };
      return { ok: true };
    }
    if (
      !(response.headers.get("content-type") || "").includes("application/json")
    )
      return {
        ok: false,
        reason: "non-json",
        message: "Public API returned non-JSON",
      };
    const value = await response.json();
    if (path.endsWith("/ready") && value.status !== "ready")
      return {
        ok: false,
        reason: "not-ready",
        message: "Public API is not ready",
      };
    if (path.endsWith("/colleges") && !Array.isArray(value))
      return {
        ok: false,
        deterministic: true,
        reason: "shape",
        message: "Public college query returned an invalid shape",
      };
    if (path.endsWith("/competitions") && !Array.isArray(value.items))
      return {
        ok: false,
        deterministic: true,
        reason: "shape",
        message: "Public competition query returned an invalid shape",
      };
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error?.name === "TimeoutError" ? "timeout" : "unreachable",
      message: "Public application check failed",
    };
  }
}

// A recreated web container can be briefly unreachable on its published port,
// so a transient failure is retried and a deterministic shape mismatch is not.
async function checkPublicPath(path, base, fetchImpl, attempts, delayMs) {
  const failure = {
    reason: "unreachable",
    code: "",
    message: "Public application check failed",
  };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await probePublicPath(path, base, fetchImpl);
    if (result.ok || result.deterministic) return result;
    failure.reason = result.reason;
    failure.code = result.code || "";
    failure.message = result.message;
    if (attempt < attempts - 1) await sleepFor(delayMs);
  }
  return { ok: false, ...failure };
}

export async function verifyPublicApplication(
  context,
  { attempts = 20, delayMs = 1500, fetchImpl = fetch, log = console.log } = {},
) {
  const publicUrl = context?.publicUrl ?? process.env.DEPLOY_PUBLIC_URL;
  if (!publicUrl) return;
  const base = new URL(publicUrl);
  if (base.username || base.password || base.search || base.hash)
    throw new Error("Invalid public deployment URL");
  for (const path of [
    "/",
    "/api/v1/health/ready",
    "/api/v1/colleges",
    "/api/v1/competitions",
  ]) {
    const result = await checkPublicPath(
      path,
      base,
      fetchImpl,
      attempts,
      delayMs,
    );
    if (!result.ok) {
      log(
        `phase=public-check status=failed path=${path} reason=${result.reason}${result.code ? ` code=${result.code}` : ""}`,
      );
      throw new Error(result.message);
    }
    log(`phase=public-check status=verified path=${path}`);
  }
}
