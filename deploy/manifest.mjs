import { readFileSync } from "node:fs";
import { join } from "node:path";

export function readReleaseManifest(directory, sha) {
  const manifest = JSON.parse(
    readFileSync(join(directory, "release.json"), "utf8"),
  );
  if (!/^[a-f0-9]{40}$/.test(sha) || manifest.sha !== sha)
    throw new Error("Release manifest does not match the requested commit");
  const images = manifest.images;
  const api =
    /^ghcr\.io\/([a-z0-9][a-z0-9._/-]*)\/api@sha256:[a-f0-9]{64}$/.exec(
      images?.api || "",
    );
  const web =
    /^ghcr\.io\/([a-z0-9][a-z0-9._/-]*)\/web@sha256:[a-f0-9]{64}$/.exec(
      images?.web || "",
    );
  if (!api || !web || api[1] !== web[1])
    throw new Error(
      "Release manifest requires API/Web digests from the same repository",
    );
  return { api: images.api, web: images.web };
}
