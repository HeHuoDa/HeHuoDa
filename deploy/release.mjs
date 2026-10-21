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
import {
  compose,
  docker,
  sha,
  stateDirectory,
  validateDeploymentConfig,
  verifyApplication,
  verifyPublicApplication,
} from "./runtime.mjs";
import { backup } from "./backup.mjs";

export async function release(
  input,
  operations = {
    compose,
    docker,
    backup,
    validateDeploymentConfig,
    verifyApplication,
    verifyPublicApplication,
  },
  directory = stateDirectory,
) {
  const tag = sha(input);
  const {
    compose,
    docker,
    backup,
    validateDeploymentConfig,
    verifyApplication,
    verifyPublicApplication,
  } = operations;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, "release.lock");
  const state = join(directory, "current.json");
  let locked = false;
  let changed = false;
  let previous;
  try {
    mkdirSync(lock);
    locked = true;
    validateDeploymentConfig(tag);
    if (existsSync(state))
      previous = sha(JSON.parse(readFileSync(state, "utf8")).sha);
    const existing = compose(["ps", "--all", "-q", "api"], tag);
    if (existing && !previous)
      throw new Error(
        "Existing deployment has no release state; verify and adopt its exact SHA before updating",
      );
    if (previous && existing) {
      const expected = JSON.parse(
        compose(["config", "--format", "json"], previous),
      ).services.api.image;
      if (
        docker(["inspect", "--format", "{{.Config.Image}}", existing]) !==
        expected
      )
        throw new Error("Running API does not match recorded release");
    }
    if (previous === tag) {
      verifyApplication(tag);
      await verifyPublicApplication();
      console.log(`Already deployed and healthy: ${tag}`);
      return;
    }
    compose(["pull", "api", "web", "db"], tag);
    compose(["up", "-d", "--wait", "--wait-timeout", "120", "db"], tag);
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
    );
    if (previous || Number(populated) > 0)
      console.log(`Verified pre-migration backup: ${backup(previous || tag)}`);
    compose(
      [
        "run",
        "--rm",
        "--no-deps",
        "api",
        "node",
        "dist-openapi/scripts/migrate.js",
      ],
      tag,
    );
    changed = true;
    compose(
      [
        "up",
        "-d",
        "--no-deps",
        "--wait",
        "--wait-timeout",
        "180",
        "api",
        "web",
      ],
      tag,
    );
    verifyApplication(tag);
    await verifyPublicApplication();
    writeFileSync(
      `${state}.tmp`,
      JSON.stringify({
        sha: tag,
        previous: previous || null,
        deployedAt: new Date().toISOString(),
      }) + "\n",
      { mode: 0o600 },
    );
    renameSync(`${state}.tmp`, state);
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
            "-d",
            "--no-deps",
            "--wait",
            "--wait-timeout",
            "180",
            "api",
            "web",
          ],
          previous,
        );
        verifyApplication(previous);
        await verifyPublicApplication();
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
