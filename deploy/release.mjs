import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  compose,
  docker,
  sha,
  stateDirectory,
  validateDeploymentConfig,
  verifyApplication,
  verifyPublicApplication,
  releaseContext,
} from "./runtime.mjs";
import { backup } from "./backup.mjs";
import { successfulHistory, cleanRetired } from "./history.mjs";
import { ensureReleaseImages } from "./images.mjs";

export function configurationHash(config) {
  const ordered = (value) =>
    Array.isArray(value)
      ? value.map(ordered)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, ordered(value[key])]),
          )
        : value;
  return createHash("sha256")
    .update(JSON.stringify(ordered(config)))
    .digest("hex");
}

export async function release(
  input,
  operations = {
    compose,
    docker,
    backup,
    validateDeploymentConfig,
    verifyApplication,
    verifyPublicApplication,
    releaseContext,
    ensureReleaseImages,
  },
  directory = stateDirectory,
  options = {},
) {
  const tag = sha(input);
  const {
    compose,
    docker,
    backup,
    validateDeploymentConfig,
    verifyApplication,
    verifyPublicApplication,
    releaseContext,
  } = operations;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, "release.lock");
  const state = join(directory, "current.json");
  let locked = false;
  let changed = false;
  let previous;
  let candidate;
  let prior;
  let priorRecord;
  try {
    mkdirSync(lock);
    locked = true;
    candidate = options.candidate || releaseContext(tag);
    validateDeploymentConfig(tag, candidate);
    const candidateConfig = JSON.parse(
      compose(["config", "--format", "json"], tag, { release: candidate }),
    );
    if (existsSync(state)) {
      const record = JSON.parse(readFileSync(state, "utf8"));
      priorRecord = record;
      previous = sha(record.sha);
      prior = releaseContext(previous, record);
      validateDeploymentConfig(previous, prior);
    }
    const existing = compose(["ps", "--all", "-q", "api"], tag, {
      release: candidate,
    });
    if (existing && !previous)
      throw new Error(
        "Existing deployment has no release state; verify and adopt its exact SHA before updating",
      );
    if (previous) {
      const previousConfig = JSON.parse(
        compose(["config", "--format", "json"], previous, { release: prior }),
      );
      if (prior.configurationHash !== configurationHash(previousConfig))
        throw new Error(
          "Previous effective configuration changed or lacks a fingerprint; use a reviewed host maintenance plan",
        );
      if (
        previousConfig.name !== candidateConfig.name ||
        JSON.stringify(previousConfig.services.db) !==
          JSON.stringify(candidateConfig.services.db) ||
        JSON.stringify(previousConfig.volumes) !==
          JSON.stringify(candidateConfig.volumes) ||
        JSON.stringify(previousConfig.networks) !==
          JSON.stringify(candidateConfig.networks)
      )
        throw new Error(
          "Database or project configuration changed; use a separate reviewed maintenance plan",
        );
      const expected = previousConfig.services.api.image;
      if (
        existing &&
        docker(["inspect", "--format", "{{.Config.Image}}", existing]) !==
          expected
      )
        throw new Error("Running API does not match recorded release");
    }
    if (previous === tag) {
      if (
        candidate.tls !== prior.tls ||
        candidate.publicUrl !== prior.publicUrl
      )
        throw new Error(
          "Same commit cannot silently change TLS or the check URL; use a reviewed configuration maintenance plan",
        );
      if (JSON.stringify(candidate.images) !== JSON.stringify(prior.images))
        throw new Error(
          "Same commit cannot replace its recorded image digests",
        );
      verifyApplication(tag, prior);
      await verifyPublicApplication(prior);
      console.log(`Already deployed and healthy: ${tag}`);
      return;
    }
    if (operations.ensureReleaseImages) {
      if (prior) prior.imageIds = operations.ensureReleaseImages(prior, docker);
      candidate.imageIds = operations.ensureReleaseImages(candidate, docker);
    }
    if (candidate.delivery === "archive") {
      const dbImage = candidateConfig.services.db.image;
      if (!docker(["image", "ls", "--quiet", "--no-trunc", dbImage]))
        docker(["pull", dbImage]);
    } else compose(["pull", "api", "web", "db"], tag, { release: candidate });
    const local =
      candidate.delivery === "archive" ? ["--pull", "never", "--no-build"] : [];
    compose(
      ["up", ...local, "-d", "--wait", "--wait-timeout", "120", "db"],
      tag,
      {
        release: candidate,
      },
    );
    const populated = compose(
      [
        "exec",
        "-T",
        "db",
        "sh",
        "-ec",
        'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema=\u0027public\u0027"',
      ],
      tag,
      { release: candidate },
    );
    if (previous || Number(populated) > 0)
      console.log(`Verified pre-migration backup: ${backup(tag, candidate)}`);
    if (!options.rollback)
      compose(
        [
          "run",
          ...(candidate.delivery === "archive" ? ["--pull", "never"] : []),
          "--rm",
          "--no-deps",
          "api",
          "node",
          "dist-openapi/scripts/migrate.js",
        ],
        tag,
        { release: candidate },
      );
    changed = true;
    compose(
      [
        "up",
        ...local,
        "-d",
        "--no-deps",
        "--force-recreate",
        "--wait",
        "--wait-timeout",
        "180",
        "api",
        "web",
      ],
      tag,
      { release: candidate },
    );
    verifyApplication(tag, candidate);
    await verifyPublicApplication(candidate);
    const current = {
      sha: tag,
      ...candidate,
      configurationHash: configurationHash(candidateConfig),
      previous: previous || null,
      deployedAt: new Date().toISOString(),
    };
    const history = successfulHistory(
      current,
      priorRecord ? { ...priorRecord, ...prior } : undefined,
    );
    writeFileSync(
      `${state}.tmp`,
      JSON.stringify({ ...current, history }) + "\n",
      { mode: 0o600 },
    );
    renameSync(`${state}.tmp`, state);
    cleanRetired(priorRecord, history, docker);
    console.log(`Deployed and verified: ${tag}`);
  } catch (error) {
    if (!locked)
      throw new Error(
        "Another release owns the deployment lock; inspect it before retrying",
        { cause: error },
      );
    console.error(error.message);
    if (changed && previous) {
      try {
        compose(
          [
            "up",
            ...(prior.delivery === "archive"
              ? ["--pull", "never", "--no-build"]
              : []),
            "-d",
            "--no-deps",
            "--force-recreate",
            "--wait",
            "--wait-timeout",
            "180",
            "api",
            "web",
          ],
          previous,
          { release: prior },
        );
        verifyApplication(previous, prior);
        await verifyPublicApplication(prior);
        console.error(
          `Deployment failed; previous application restored: ${previous}. Database was not downgraded.`,
        );
      } catch {
        throw new Error(
          "ROLLBACK FAILED: retain database and backups; inspect containers manually. Release state was not advanced.",
          { cause: error },
        );
      }
    } else if (!previous) {
      throw new Error(
        "FIRST DEPLOYMENT FAILED: no previous application exists. Database and diagnostics are retained.",
        { cause: error },
      );
    } else {
      console.error(
        "Deployment failed before application replacement. Verify the old application; database changes are never automatically reversed.",
      );
    }
    throw new Error("Deployment failed; release state was not advanced", {
      cause: error,
    });
  } finally {
    if (locked) rmdirSync(lock);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await release(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
