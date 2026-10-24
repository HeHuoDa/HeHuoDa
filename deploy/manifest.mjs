import { readFileSync } from "node:fs";
import { join } from "node:path";

const commitSha = /^[a-f0-9]{40}$/;
const digest = /^sha256:[a-f0-9]{64}$/;
const legacyImage =
  /^((?:ghcr\.io|ccr\.ccs\.tencentyun\.com|[a-z0-9][a-z0-9-]*\.tencentcloudcr\.com)\/[a-z0-9][a-z0-9._/-]*)\/(api|web)@sha256:[a-f0-9]{64}$/;
const archiveImage = /^([a-z0-9][a-z0-9._:/-]*)\/(api|web):([a-f0-9]{40})$/;

function validateLegacy(manifest, requestedSha) {
  const { sha, images } = manifest;
  if (!commitSha.test(requestedSha || "") || sha !== requestedSha)
    throw new Error("Release manifest does not match the requested commit");
  const api = legacyImage.exec(images?.api || "");
  const web = legacyImage.exec(images?.web || "");
  if (!api || !web || api[1] !== web[1] || api[2] !== "api" || web[2] !== "web")
    throw new Error(
      "Release manifest requires API/Web digests from the same repository",
    );
  return {
    version: 1,
    delivery: "registry",
    sha,
    images: { api: images.api, web: images.web },
  };
}

function validateArchive(manifest, requestedSha) {
  const {
    sha,
    repository,
    runId,
    runAttempt,
    platform,
    archive,
    images,
    imageIds,
  } = manifest;
  if (!commitSha.test(requestedSha || "") || sha !== requestedSha)
    throw new Error("Release manifest does not match the requested commit");
  const repositoryParts = (repository || "").split("/");
  if (
    repositoryParts.length !== 2 ||
    repositoryParts.some(
      (part) =>
        !/^[A-Za-z0-9_.-]+$/.test(part) ||
        part.startsWith(".") ||
        part.endsWith(".") ||
        part.includes(".."),
    )
  )
    throw new Error("Archive manifest has an invalid repository");
  if (
    !/^[1-9][0-9]*$/.test(runId || "") ||
    !/^[1-9][0-9]*$/.test(runAttempt || "")
  )
    throw new Error("Archive manifest has invalid workflow run metadata");
  if (!/^linux\/[a-z0-9_]+(?:\/[a-zA-Z0-9._-]+)?$/.test(platform || ""))
    throw new Error("Archive manifest has an unsupported platform");
  if (
    archive?.file !== "images.tar.gz" ||
    !/^[a-f0-9]{64}$/.test(archive.sha256 || "") ||
    !Number.isSafeInteger(archive.bytes) ||
    archive.bytes <= 0
  )
    throw new Error("Archive manifest has invalid archive metadata");
  if (!digest.test(imageIds?.api || "") || !digest.test(imageIds?.web || ""))
    throw new Error("Archive manifest has invalid image identities");
  const api = archiveImage.exec(images?.api || "");
  const web = archiveImage.exec(images?.web || "");
  if (
    !api ||
    !web ||
    api[1] !== web[1] ||
    api[1] !== "hehuoda-local" ||
    api[2] !== "api" ||
    web[2] !== "web" ||
    api[3] !== sha ||
    web[3] !== sha ||
    api[1].includes("..")
  )
    throw new Error(
      "Archive manifest requires API/Web SHA tags from the same image prefix",
    );
  return manifest;
}

export function validateManifest(manifest, requestedSha) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
    throw new Error("Release manifest must be an object");
  if (manifest.version === undefined)
    return validateLegacy(manifest, requestedSha);
  if (manifest.version !== 2 || manifest.delivery !== "archive")
    throw new Error(
      "Release manifest has an unsupported version or delivery type",
    );
  return validateArchive(manifest, requestedSha);
}

export function readManifest(directory, sha) {
  const manifest = JSON.parse(
    readFileSync(join(directory, "release.json"), "utf8"),
  );
  return validateManifest(manifest, sha);
}

export function readReleaseManifest(directory, sha) {
  return readManifest(directory, sha).images;
}
