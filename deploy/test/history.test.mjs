import assert from "node:assert/strict";
import { test } from "node:test";
import {
  successfulHistory,
  cleanRetired,
  managedReleaseDirectory,
} from "../history.mjs";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("successful history retains three unique verified versions and promotes explicit rollback", () => {
  const record = (n) => ({
    sha: String(n).repeat(40),
    releaseDirectory: `/managed/releases/${n}`,
    images: { api: `api:${n}`, web: `web:${n}` },
  });
  const one = record(1),
    two = record(2),
    three = record(3),
    four = record(4);
  assert.deepEqual(successfulHistory(two, one), [two, one]);
  const previous = { ...three, history: [three, two, one] };
  assert.deepEqual(successfulHistory(four, previous), [four, three, two]);
  assert.deepEqual(successfulHistory(two, previous), [two, three, one]);
  assert.equal(previous.history.length, 3);
});

test("retention removes only recorded canonical release directories and protects backups and unknown data", (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "hehuoda-retention-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const records = [1, 2, 3, 4].map((n) => {
    const directory = join(base, "releases", String(n));
    mkdirSync(directory, { recursive: true });
    return { sha: String(n).repeat(40), releaseDirectory: directory };
  });
  mkdirSync(join(base, "backups"));
  writeFileSync(join(base, "backups", "protected.dump"), "backup");
  mkdirSync(join(base, "releases", "unmanaged"));
  assert.throws(() => managedReleaseDirectory(join(base, "backups"), base));
  assert.throws(() => managedReleaseDirectory(join(base, "releases"), base));
  cleanRetired(
    { ...records[2], history: [records[2], records[1], records[0]] },
    [records[3], records[2], records[1]],
    () => {
      throw new Error("No docker removal expected");
    },
    base,
  );
  assert.equal(existsSync(records[0].releaseDirectory), false);
  assert.equal(existsSync(records[1].releaseDirectory), true);
  assert.equal(existsSync(join(base, "backups", "protected.dump")), true);
  assert.equal(existsSync(join(base, "releases", "unmanaged")), true);
});
