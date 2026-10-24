import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyLocalImages, ensureReleaseImages } from "../images.mjs";

const context = {
  delivery: "archive",
  platform: "linux/amd64",
  images: {
    api: `hehuoda-local/api:${"a".repeat(40)}`,
    web: `hehuoda-local/web:${"a".repeat(40)}`,
  },
  imageIds: {
    api: `sha256:${"1".repeat(64)}`,
    web: `sha256:${"2".repeat(64)}`,
  },
};
test("local image identity and platform are checked without falling back to pulls", () => {
  const commands = [];
  const run = (args) => {
    commands.push(args);
    const service = args.at(-1).includes("/api:") ? "api" : "web";
    return JSON.stringify([
      { Id: context.imageIds[service], Os: "linux", Architecture: "amd64" },
    ]);
  };
  assert.deepEqual(verifyLocalImages(context, run), context.imageIds);
  assert.deepEqual(ensureReleaseImages(context, run), context.imageIds);
  assert.equal(
    commands.some((c) => c.includes("pull")),
    false,
  );
  assert.throws(() =>
    verifyLocalImages(context, () =>
      JSON.stringify([
        { Id: context.imageIds.api, Os: "linux", Architecture: "arm64" },
      ]),
    ),
  );
  assert.throws(() =>
    verifyLocalImages(context, () =>
      JSON.stringify([
        { Id: `sha256:${"3".repeat(64)}`, Os: "linux", Architecture: "amd64" },
      ]),
    ),
  );
});
