import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upload } from "../rsync.mjs";

function fixture(t, script) {
  const directory = mkdtempSync(join(tmpdir(), "hehuoda-rsync-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, "source"), Buffer.alloc(4096));
  writeFileSync(join(directory, "client.mjs"), script);
  const events = [];
  return {
    source: join(directory, "source"),
    target: "fixture-private:/fixture-private/payload",
    ssh: join(directory, "private ssh wrapper"),
    logDirectory: directory,
    kind: "payload",
    attempt: 2,
    wallSeconds: 5,
    command: [process.execPath, join(directory, "client.mjs")],
    onEvent: (event) => events.push(event),
    events,
  };
}

test("rsync publishes only numeric progress and reuse statistics, retaining raw output privately", async (t) => {
  const options = fixture(
    t,
    `
process.stdout.write('fixture-private:/path password=fixture-private\\n');
process.stderr.write('fixture-private secret error\\n');
process.stdout.write('\\r          2,048  50%    1.25MB/s    0:00:01\\r');
process.stdout.write('Literal data: 1,024 bytes\\nMatched data: 3,072 bytes\\n');
`,
  );
  const result = await upload(options);
  assert.equal(result.code, 0);
  assert.equal(result.literalBytes, 1024);
  assert.equal(result.matchedBytes, 3072);
  assert.ok(
    options.events.some((event) => /bytes=2048 .*percent=50/.test(event)),
  );
  assert.doesNotMatch(
    options.events.join("\n"),
    /fixture-private|password=|\/path/,
  );
  assert.match(
    readFileSync(join(options.logDirectory, "rsync-payload-2.stdout"), "utf8"),
    /fixture-private/,
  );
});

test("rsync I/O timeout and missing binary have safe distinct categories", async (t) => {
  const timed = fixture(
    t,
    "process.stderr.write('fixture-private'); process.exit(30);",
  );
  assert.equal((await upload(timed)).category, "timeout");
  const missing = fixture(t, "");
  missing.command = [join(missing.logDirectory, "not-installed")];
  assert.equal((await upload(missing)).category, "dependency-missing");
  assert.doesNotMatch(
    [...timed.events, ...missing.events].join("\n"),
    /fixture-private/,
  );
});

test("the internal wall deadline stops a stalled transfer", async (t) => {
  const options = fixture(t, "setInterval(() => {}, 1000);");
  options.wallSeconds = 0.2;
  options.killGraceMs = 100;
  const result = await upload(options);
  assert.equal(result.code, 124);
  assert.equal(result.category, "timeout");
});

test(
  "the wall deadline also kills a descendant that ignores TERM",
  { skip: process.platform !== "linux" },
  async (t) => {
    const options = fixture(
      t,
      `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' });
writeFileSync(new URL('./child.pid', import.meta.url), String(child.pid));
process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);
`,
    );
    options.wallSeconds = 0.5;
    options.killGraceMs = 100;
    assert.equal((await upload(options)).code, 124);
    const pid = readFileSync(join(options.logDirectory, "child.pid"), "utf8");
    // Delivery of SIGKILL and init's reaping happen asynchronously after kill(2) returns.
    let stopped = false;
    for (let attempt = 0; attempt < 100 && !stopped; attempt++) {
      try {
        stopped = /\) Z /.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        stopped = true;
      }
      if (!stopped) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(stopped, true);
  },
);
