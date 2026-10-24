import {
  existsSync,
  readFileSync,
  statfsSync,
  accessSync,
  constants,
  mkdirSync,
  rmdirSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyArchive } from "./archive.mjs";
import { managedReleaseDirectory } from "./history.mjs";
import {
  rejectTagConflicts,
  verifyLocalImages,
  ensureReleaseImages,
} from "./images.mjs";
import { release, configurationHash } from "./release.mjs";
import {
  docker,
  compose,
  releaseContext,
  sha,
  stateDirectory,
  envFile,
  validateDeploymentConfig,
  verifyApplication,
  verifyPublicApplication,
} from "./runtime.mjs";

export function hostPreflight(context, bytes, run = docker) {
  accessSync(envFile, constants.R_OK);
  accessSync(process.env.DEPLOY_ROOT, constants.W_OK);
  const info = JSON.parse(run(["info", "--format", "{{json .}}"]));
  const arch =
    { x86_64: "amd64", aarch64: "arm64" }[info.Architecture] ||
    info.Architecture;
  if (context.platform && `${info.OSType}/${arch}` !== context.platform)
    throw new Error("Host platform differs from archive platform");
  const version = run(["compose", "version", "--short"])
    .replace(/^v/, "")
    .split(".")
    .map(Number);
  if (
    !version.every(Number.isFinite) ||
    version[0] < 2 ||
    (version[0] === 2 &&
      (version[1] < 24 || (version[1] === 24 && version[2] < 4)))
  )
    throw new Error("Docker Compose 2.24.4 or later is required");
  const dockerRoot = info.DockerRootDir;
  if (!dockerRoot) throw new Error("Docker storage location unavailable");
  for (const directory of [context.releaseDirectory, dockerRoot]) {
    const disk = statfsSync(directory);
    if (disk.bavail * disk.bsize < Math.max(bytes * 4, 1024 ** 3))
      throw new Error("Insufficient deployment storage headroom");
  }
}

function currentState() {
  const file = join(stateDirectory, "current.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
}

function runningSnapshot(context, tag) {
  return ["api", "web"].map((component) => {
    const container = compose(["ps", "-q", component], tag, {
      release: context,
    });
    if (!container) throw new Error("Recorded application is not running");
    const value = JSON.parse(
      docker(["inspect", "--format", "{{json .}}", container]),
    );
    if (!value.State.Running || value.State.Health?.Status !== "healthy")
      throw new Error("Recorded application is unhealthy");
    if (
      context.imageIds?.[component] &&
      value.Image !== context.imageIds[component]
    )
      throw new Error("Running application image differs from release state");
    if (value.Config.Image !== context.images[component])
      throw new Error(
        "Running application reference differs from release state",
      );
    return { component, container, image: value.Image, healthy: true };
  });
}

export async function deliver(action, input, targetDirectory) {
  const tag = sha(input);
  if (!["prepare", "deploy", "rollback"].includes(action))
    throw new Error("Unsupported deployment action");
  const record = currentState();
  let candidate;
  if (action === "rollback") {
    const target = [record, ...(record?.history || [])].find(
      (item) => item?.sha === tag,
    );
    if (!target)
      throw new Error(
        "Requested rollback is not a retained successful release",
      );
    managedReleaseDirectory(target.releaseDirectory);
    candidate = releaseContext(tag, target);
  } else {
    managedReleaseDirectory(targetDirectory);
    process.env.DEPLOY_RELEASE_DIR = targetDirectory;
    candidate = releaseContext(tag);
  }
  if (
    action !== "prepare" &&
    candidate.delivery === "archive" &&
    process.env.DEPLOY_ARCHIVE_ACTIVATE !== "true"
  )
    throw new Error("Archive activation is disabled; use prepare first");
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  const lock = join(stateDirectory, "release.lock");
  let locked = false;
  const before = record && JSON.stringify(record);
  let snapshot;
  try {
    mkdirSync(lock);
    locked = true;
    if (JSON.stringify(currentState()) !== before)
      throw new Error(
        "Release state changed before preparation acquired its lock",
      );
    validateDeploymentConfig(tag, candidate);
    if (record) {
      const prior = releaseContext(sha(record.sha), record);
      validateDeploymentConfig(record.sha, prior);
      if (
        configurationHash(
          JSON.parse(
            compose(["config", "--format", "json"], record.sha, {
              release: prior,
            }),
          ),
        ) !== record.configurationHash
      )
        throw new Error("Recorded configuration has changed");
      prior.imageIds = ensureReleaseImages(prior, docker);
      snapshot = runningSnapshot(prior, record.sha);
      verifyApplication(record.sha, prior);
      await verifyPublicApplication(prior);
    } else if (
      compose(["ps", "--all", "-q", "api"], tag, { release: candidate })
    )
      throw new Error("Existing application requires verified release state");
    if (candidate.delivery === "archive") {
      if (action !== "rollback") {
        const manifest = await verifyArchive(candidate.releaseDirectory, tag);
        hostPreflight(candidate, manifest.archive.bytes);
        rejectTagConflicts(candidate, docker);
        console.log("phase=import status=started");
        docker([
          "image",
          "load",
          "--input",
          join(candidate.releaseDirectory, manifest.archive.file),
        ]);
      }
      verifyLocalImages(candidate, docker);
    } else ensureReleaseImages(candidate, docker);
    if (record) {
      const prior = releaseContext(record.sha, record);
      if (
        JSON.stringify(runningSnapshot(prior, record.sha)) !==
        JSON.stringify(snapshot)
      )
        throw new Error("Running application changed during preparation");
      verifyApplication(record.sha, prior);
      await verifyPublicApplication(prior);
      if (JSON.stringify(currentState()) !== before)
        throw new Error("Successful history changed during preparation");
    }
    console.log("phase=prepare status=verified application_unchanged=true");
  } finally {
    if (locked) rmdirSync(lock);
  }
  if (action === "prepare") return;
  await release(tag, undefined, stateDirectory, {
    candidate,
    rollback: action === "rollback",
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await deliver(process.argv[2], process.argv[3], process.argv[4]);
  } catch (error) {
    const status = error.message.startsWith("ROLLBACK FAILED")
      ? "rollback-failed"
      : error.message.startsWith("Archive activation")
        ? "activation-disabled"
        : "failed";
    console.error(
      `phase=delivery status=${status}; inspect protected host diagnostics`,
    );
    process.exitCode = 1;
  }
}
