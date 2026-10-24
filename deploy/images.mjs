// Docker is injected at the boundary so failures can be exercised without production access.
export function verifyLocalImages(context, run) {
  const ids = {};
  for (const component of ["api", "web"]) {
    const values = JSON.parse(
      run(["image", "inspect", context.images[component]]),
    );
    const image = values[0];
    if (!/^sha256:[a-f0-9]{64}$/.test(image?.Id || ""))
      throw new Error("Invalid local image identity");
    if (
      context.imageIds?.[component] &&
      image.Id !== context.imageIds[component]
    )
      throw new Error("Local image identity conflict");
    if (
      context.platform &&
      `${image.Os}/${image.Architecture}${image.Variant ? `/${image.Variant}` : ""}` !==
        context.platform
    )
      throw new Error("Local image platform conflict");
    ids[component] = image.Id;
  }
  return ids;
}

export function ensureReleaseImages(context, run) {
  if (context.delivery !== "archive") {
    for (const component of ["api", "web"]) {
      const reference = context.images[component];
      if (!run(["image", "ls", "--quiet", "--no-trunc", reference]))
        run(["pull", reference]);
    }
  }
  return verifyLocalImages(context, run);
}

export function rejectTagConflicts(context, run) {
  for (const component of ["api", "web"]) {
    const reference = context.images[component];
    const id = run(["image", "ls", "--quiet", "--no-trunc", reference]);
    if (id && id !== context.imageIds[component])
      throw new Error("Existing SHA tag has a different identity");
  }
}
