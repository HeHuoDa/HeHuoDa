import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readManifest, validateManifest } from "./manifest.mjs";

const shaPattern = /^[a-f0-9]{40}$/;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function requireRunMetadata({
  sha,
  repository,
  runId,
  runAttempt,
  imagePrefix,
}) {
  if (
    !shaPattern.test(sha || "") ||
    !repositoryPattern.test(repository || "") ||
    !/^[1-9][0-9]*$/.test(runId || "") ||
    !/^[1-9][0-9]*$/.test(runAttempt || "") ||
    imagePrefix !== "hehuoda-local"
  )
    throw new Error(
      "Archive creation requires valid commit and workflow metadata",
    );
}

function hashFile(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(path);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function readImageMetadata(inspectImage, reference) {
  let image;
  try {
    image = inspectImage(reference);
  } catch {
    throw new Error("Verified Docker image metadata is unavailable");
  }
  if (
    !image ||
    !/^sha256:[a-f0-9]{64}$/.test(image.id || "") ||
    !/^linux\/[a-z0-9_]+(?:\/[a-zA-Z0-9._-]+)?$/.test(image.platform || "")
  )
    throw new Error("Verified Docker image metadata is invalid");
  return image;
}

export async function createArchiveManifest({
  directory,
  sha,
  repository,
  runId,
  runAttempt,
  imagePrefix,
  inspectImage,
}) {
  requireRunMetadata({ sha, repository, runId, runAttempt, imagePrefix });
  const archivePath = join(directory, "images.tar.gz");
  if (!existsSync(archivePath) || !statSync(archivePath).isFile())
    throw new Error("Verified image archive is unavailable");
  const archiveBytes = statSync(archivePath).size;
  if (!Number.isSafeInteger(archiveBytes) || archiveBytes <= 0)
    throw new Error("Verified image archive is empty or too large");

  const images = {
    api: `${imagePrefix}/api:${sha}`,
    web: `${imagePrefix}/web:${sha}`,
  };
  const api = readImageMetadata(inspectImage, images.api);
  const web = readImageMetadata(inspectImage, images.web);
  if (api.platform !== web.platform)
    throw new Error("API and Web images must have the same platform");

  const manifest = validateManifest(
    {
      version: 2,
      delivery: "archive",
      sha,
      repository,
      runId,
      runAttempt,
      platform: api.platform,
      archive: {
        file: "images.tar.gz",
        sha256: await hashFile(archivePath),
        bytes: archiveBytes,
      },
      images,
      imageIds: { api: api.id, web: web.id },
    },
    sha,
  );
  const manifestPath = join(directory, "release.json");
  const temporaryPath = `${manifestPath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporaryPath, manifestPath);
  return manifest;
}

export async function verifyArchive(directory, sha, expected = {}) {
  const manifest = readManifestFrom(directory, sha);
  if (manifest.delivery !== "archive")
    throw new Error("A version 2 archive manifest is required");
  for (const key of ["repository", "runId", "runAttempt"]) {
    if (expected[key] !== undefined && expected[key] !== manifest[key])
      throw new Error(`Archive manifest does not match the expected ${key}`);
  }
  const archivePath = join(directory, "images.tar.gz");
  if (!existsSync(archivePath) || !statSync(archivePath).isFile())
    throw new Error("Verified image archive is unavailable");
  const stats = statSync(archivePath);
  if (
    stats.size !== manifest.archive.bytes ||
    (await hashFile(archivePath)) !== manifest.archive.sha256
  )
    throw new Error(
      "Verified image archive checksum or size does not match its manifest",
    );
  return manifest;
}

function readManifestFrom(directory, sha) {
  return readManifest(directory, sha);
}

function inspectDockerImage(reference) {
  const result = spawnSync(
    process.env.DOCKER_BIN || "docker",
    [
      "image",
      "inspect",
      "--format",
      "{{.Id}} {{.Os}}/{{.Architecture}}",
      reference,
    ],
    { encoding: "utf8", timeout: 30_000, windowsHide: true },
  );
  if (result.error || result.status !== 0)
    throw new Error("Docker image inspection failed");
  const [id, platform, ...extra] = (result.stdout || "").trim().split(/\s+/);
  if (extra.length || !id || !platform)
    throw new Error("Docker image metadata is invalid");
  return { id, platform };
}

async function runCli(args) {
  const [operation, directory, sha] = args;
  if (!directory || !shaPattern.test(sha || ""))
    throw new Error("Invalid archive command arguments");
  const targetDirectory = resolve(directory);
  if (operation === "create") {
    mkdirSync(targetDirectory, { recursive: true, mode: 0o700 });
    await createArchiveManifest({
      directory: targetDirectory,
      sha,
      repository: process.env.GITHUB_REPOSITORY,
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      imagePrefix: process.env.IMAGE_PREFIX,
      inspectImage: inspectDockerImage,
    });
    process.stdout.write("Verified archive manifest created.\n");
    return;
  }
  if (operation === "verify") {
    await verifyArchive(targetDirectory, sha, {
      repository: process.env.GITHUB_REPOSITORY,
      runId: process.env.ARCHIVE_RUN_ID,
      runAttempt: process.env.ARCHIVE_RUN_ATTEMPT,
    });
    process.stdout.write("Verified archive and manifest.\n");
    return;
  }
  throw new Error("Unsupported archive operation");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await runCli(process.argv.slice(2));
  } catch {
    process.stderr.write(
      "Archive operation failed; inspect the fixed validation category.\n",
    );
    process.exitCode = 1;
  }
}
