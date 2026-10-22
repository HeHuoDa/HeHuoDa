import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { verifyBackup } from "../backup.mjs";

test("backup restore waits past the socket-only bootstrap server before restoring", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "hehuoda-backup-ready-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "backup.dump");
  writeFileSync(file, "fixture");
  let phase = "bootstrap";
  let removed = false;
  const result = verifyBackup(file, {
    docker(args) {
      if (args[0] === "run") return "container";
      if (args.includes("pg_isready")) {
        // Official Postgres bootstrap listens only on the Unix socket, then restarts.
        if (phase === "bootstrap" && args.includes("127.0.0.1")) {
          phase = "final";
          throw new Error("TCP is not accepting connections during bootstrap");
        }
        return "accepting connections";
      }
      if (args.includes("pg_restore")) {
        assert.equal(
          phase,
          "final",
          "Restore must not connect to the temporary bootstrap server",
        );
        return "";
      }
      if (args.includes("psql"))
        return JSON.stringify({
          migrations: 3,
          colleges: 27,
          competitions: 1,
          ingestionRuns: 0,
        });
      if (args[0] === "inspect") return "backup-verification";
      if (args[0] === "rm") {
        removed = true;
        return "";
      }
      throw new Error("Unexpected Docker operation");
    },
    waitFor(check) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (check()) return;
        } catch {
          /* wait for final server */
        }
      }
      throw new Error("Readiness never reached");
    },
  });
  assert.deepEqual(result, {
    migrations: 3,
    colleges: 27,
    competitions: 1,
    ingestionRuns: 0,
  });
  assert.equal(removed, true);
});
