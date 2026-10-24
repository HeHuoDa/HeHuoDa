import { realpathSync, rmSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";

export function successfulHistory(candidate, previous) {
  const records = [
    candidate,
    ...(previous ? [previous, ...(previous.history || [])] : []),
  ];
  const unique = new Map();
  for (const value of records) {
    const record = { ...value };
    delete record.history;
    delete record.previous;
    if (!unique.has(record.sha)) unique.set(record.sha, record);
  }
  return [...unique.values()].slice(0, 3);
}

// Only explicitly recorded, canonical children of this project's releases tree.
export function managedReleaseDirectory(
  directory,
  base = process.env.DEPLOY_ROOT,
) {
  if (!base || !isAbsolute(directory))
    throw new Error("Unmanaged release directory");
  const releases = realpathSync(resolve(base, "releases"));
  const actual = realpathSync(directory);
  const child = relative(releases, actual);
  if (
    !child ||
    child.startsWith("..") ||
    isAbsolute(child) ||
    resolve(directory) !== actual
  )
    throw new Error("Unmanaged release directory");
  return actual;
}

export function cleanRetired(
  previous,
  retained,
  run,
  base = process.env.DEPLOY_ROOT,
) {
  if (!base || !previous) return;
  const protectedDirectories = new Set(retained.map((r) => r.releaseDirectory));
  const protectedImages = new Set(
    retained.flatMap((r) => Object.values(r.images || {})),
  );
  const protectedIds = new Set(
    retained.flatMap((r) => Object.values(r.imageIds || {})),
  );
  for (const record of [previous, ...(previous.history || [])]) {
    if (
      retained.some((r) => r.sha === record.sha) ||
      protectedDirectories.has(record.releaseDirectory)
    )
      continue;
    try {
      const directory = managedReleaseDirectory(record.releaseDirectory, base);
      // Do not remove registry references or IDs shared by any retained release.
      if (record.delivery === "archive") {
        for (const component of ["api", "web"]) {
          const image = record.images?.[component];
          if (
            image &&
            !protectedImages.has(image) &&
            !protectedIds.has(record.imageIds?.[component]) &&
            image.endsWith(`:${record.sha}`)
          ) {
            const id = run(["image", "inspect", "--format", "{{.Id}}", image]);
            if (id !== record.imageIds?.[component])
              throw new Error("Retired image identity changed");
            run(["image", "rm", image]);
          }
        }
      }
      rmSync(directory, { recursive: true });
    } catch {
      console.warn("phase=retention status=cleanup-deferred");
    }
  }
}
