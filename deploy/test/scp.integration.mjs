import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer, createConnection } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { upload } from "../rsync.mjs";

const large = process.env.RSYNC_TEST_LARGE_PAYLOAD === "true";
test(
  "rsync resumes interrupted real SSH transfers and enforces host trust, dependencies and sealed payloads",
  {
    skip: process.platform !== "linux",
    timeout: large ? 1_200_000 : 180_000,
  },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "hehuoda-rsync-integration-"));
    const helper = fileURLToPath(new URL("../scp.sh", import.meta.url));
    const run = (bin, args, options = {}) =>
      spawnSync(bin, args, { encoding: "utf8", timeout: 60_000, ...options });
    const ok = (result) => {
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      return result.stdout;
    };
    const listener = createServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    let server;
    try {
      for (const name of ["host", "client"])
        ok(
          run("ssh-keygen", [
            "-q",
            "-t",
            "ed25519",
            "-N",
            "",
            "-f",
            join(root, name),
          ]),
        );
      ok(
        run("ssh-keygen", [
          "-q",
          "-t",
          "ecdsa",
          "-N",
          "",
          "-f",
          join(root, "host-ecdsa"),
        ]),
      );
      // Fixture markers affect capability checks or rsync only, leaving all SSH trust/authentication real.
      writeFileSync(
        join(root, "remote-command"),
        `#!/bin/bash
if [[ "$SSH_ORIGINAL_COMMAND" == *'command -v rsync'* ]]; then
  if [[ -e '${root}/missing-rsync' ]]; then exit 44; fi
  if [[ -e '${root}/old-rsync' ]]; then echo 'rsync version 3.0.9 protocol version 30'; exit 0; fi
fi
if [[ "$SSH_ORIGINAL_COMMAND" == *'rsync --server'* && -e '${root}/stall' ]]; then sleep 5; exit 0; fi
exec bash -c "$SSH_ORIGINAL_COMMAND"
`,
        { mode: 0o700 },
      );
      writeFileSync(
        join(root, "sshd_config"),
        `Port ${port}
ListenAddress 127.0.0.1
HostKey ${root}/host
HostKey ${root}/host-ecdsa
PidFile ${root}/sshd.pid
AuthorizedKeysFile ${root}/client.pub
StrictModes no
PasswordAuthentication yes
PermitRootLogin yes
KbdInteractiveAuthentication no
UsePAM yes
AllowUsers ${userInfo().username}
ForceCommand ${root}/remote-command
LogLevel ERROR
`,
      );
      server = spawn(
        "sudo",
        ["-n", "/usr/sbin/sshd", "-D", "-e", "-f", join(root, "sshd_config")],
        { stdio: "ignore", detached: true },
      );
      let ready = false;
      for (let i = 0; i < 50 && !ready; i++) {
        ready = await new Promise((resolve) => {
          const socket = createConnection({ host: "127.0.0.1", port });
          socket.on("connect", () => {
            socket.destroy();
            resolve(true);
          });
          socket.on("error", () => resolve(false));
        });
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(ready, true);
      const deployRoot = join(root, "deployment"),
        runner = join(root, "runner with ' quote"),
        bin = join(root, "bin");
      for (const directory of [deployRoot, runner, bin, join(root, "source")])
        mkdirSync(directory);
      writeFileSync(join(deployRoot, ".env"), "");
      writeFileSync(
        join(root, "source/file"),
        randomBytes(large ? 129390874 : 8 * 1024 * 1024),
      );
      ok(
        run("tar", [
          "-czf",
          join(runner, "payload.tar.gz"),
          "-C",
          join(root, "source"),
          ".",
        ]),
      );
      // Limit the actual client for a repeatable interruption; production has no bandwidth test switches.
      writeFileSync(
        join(bin, "rsync"),
        `#!/bin/bash
if [[ "$1" == --version ]]; then exec /usr/bin/rsync "$@"; fi
exec /usr/bin/rsync --bwlimit=${large ? 128 : 256} "$@"
`,
        { mode: 0o700 },
      );
      const env = {
        ...process.env,
        PATH: bin + ":" + process.env.PATH,
        GITHUB_WORKSPACE: root,
        RUNNER_TEMP: runner,
        GITHUB_RUN_ID: "17",
        GITHUB_RUN_ATTEMPT: "2",
        RELEASE_SHA: "a".repeat(40),
        DEPLOY_ACTION: "prepare",
        DEPLOY_HOST: "127.0.0.1",
        DEPLOY_PORT: String(port),
        DEPLOY_USER: userInfo().username,
        DEPLOY_PATH: deployRoot,
        DEPLOY_PASSWORD: large ? process.env.RSYNC_TEST_PASSWORD || "" : "",
        DEPLOY_SSH_KEY:
          large && process.env.RSYNC_TEST_PASSWORD
            ? ""
            : readFileSync(join(root, "client"), "utf8"),
        DEPLOY_KNOWN_HOSTS: `[127.0.0.1]:${port} ${readFileSync(join(root, "host.pub"), "utf8")}`,
        GITHUB_ENV: join(root, "github-env"),
        GITHUB_OUTPUT: join(root, "github-output"),
      };
      const control = (args, extra = {}) =>
        run("bash", [helper, ...args], {
          env: { ...env, ...extra },
          timeout: large ? 1_150_000 : 90_000,
        });
      const badTrust = `[127.0.0.1]:${port} ${readFileSync(join(root, "client.pub"), "utf8")}`;
      const wrong = control(["setup"], { DEPLOY_KNOWN_HOSTS: badTrust });
      assert.notEqual(wrong.status, 0);
      assert.match(wrong.stderr, /category=host-key/);
      writeFileSync(join(root, "missing-rsync"), "");
      assert.equal(control(["setup"]).status, 44);
      rmSync(join(root, "missing-rsync"));
      writeFileSync(join(root, "old-rsync"), "");
      assert.equal(control(["setup"]).status, 45);
      rmSync(join(root, "old-rsync"));
      ok(control(["setup"]));
      ok(control(["upload", "probe"]));
      ok(control(["probe"]));
      // Password authentication is checked over the same trusted SSH connection, without a client key.
      const password = process.env.RSYNC_TEST_PASSWORD;
      if (password) {
        ok(
          control(["upload", "probe"], {
            DEPLOY_PASSWORD: password,
            DEPLOY_SSH_KEY: "",
          }),
        );
        const rejected = control(["upload", "probe"], {
          DEPLOY_PASSWORD: "wrong-fixture-password",
          DEPLOY_SSH_KEY: "",
        });
        assert.notEqual(rejected.status, 0);
        assert.match(rejected.stdout, /category=authentication/);
      }
      const staging = join(
        deployRoot,
        "releases",
        env.RELEASE_SHA,
        "17-2.incoming",
      );
      const partial = join(staging, "upload/.rsync-partial/payload.tar.gz");
      const receivedFile = join(staging, "upload/payload.tar.gz");
      const size = statSync(join(runner, "payload.tar.gz")).size;
      console.log(
        `rsync fixture payload_bytes=${size} bandwidth_kib=${large ? 128 : 256}`,
      );
      if (large) {
        const started = Date.now();
        const complete = control(["upload", "payload", "1"]);
        ok(complete);
        console.log(
          `rsync large payload_bytes=${size} elapsed_seconds=${Math.ceil((Date.now() - started) / 1000)}`,
        );
      } else {
        // Interrupt a transfer process, not its entire workflow; retry must reuse the same private staging.
        const child = spawn("bash", [helper, "upload", "payload", "1"], {
          env,
          detached: true,
        });
        let output = "",
          errors = "",
          interrupted = false;
        const deadline = setTimeout(() => {
          if (!interrupted) {
            interrupted = true;
            process.kill(-child.pid, "SIGTERM");
          }
        }, 10_000);
        child.stdout.on("data", (chunk) => {
          output += chunk;
          if (
            !interrupted &&
            [...output.matchAll(/status=progress bytes=(\d+)/g)].some(
              (match) => Number(match[1]) >= 524288,
            )
          ) {
            interrupted = true;
            process.kill(-child.pid, "SIGTERM");
          }
        });
        child.stderr.on("data", (chunk) => {
          errors += chunk;
        });
        await once(child, "close");
        clearTimeout(deadline);
        assert.ok(interrupted);
        assert.ok(existsSync(partial), output + errors);
        assert.ok(statSync(partial).size > 0 && statSync(partial).size < size);
        ok(control(["received"]));
        assert.match(readFileSync(env.GITHUB_OUTPUT, "utf8"), /valid=false/);
        assert.equal(control(["verify"]).status, 42);
        ok(control(["retry"]));
        assert.ok(existsSync(partial));
        const resumed = control(["upload", "payload", "2"]);
        ok(resumed);
        const matched = Number(resumed.stdout.match(/matched_bytes=(\d+)/)[1]);
        const literal = Number(resumed.stdout.match(/literal_bytes=(\d+)/)[1]);
        assert.ok(matched > 0);
        assert.ok(literal < size);
        console.log(
          `rsync fixture resumed matched_bytes=${matched} literal_bytes=${literal}`,
        );
      }
      // Independently detect same-length damage instead of trusting a client's successful exit alone.
      const original = readFileSync(receivedFile);
      const damaged = Buffer.from(original);
      damaged[0] ^= 1;
      writeFileSync(receivedFile, damaged);
      assert.equal(control(["verify"]).status, 42);
      assert.equal(existsSync(join(staging, "verified")), false);
      writeFileSync(receivedFile, original);
      ok(control(["received"]));
      assert.match(readFileSync(env.GITHUB_OUTPUT, "utf8"), /valid=true/);
      ok(control(["verify"]));
      const release = join(deployRoot, "releases", env.RELEASE_SHA, "17-2");
      assert.deepEqual(
        readFileSync(join(release, "file")),
        readFileSync(join(root, "source/file")),
      );
      // An authenticated peer that stops speaking rsync is bounded by the I/O deadline.
      writeFileSync(join(root, "stall"), "");
      const io = await upload({
        source: join(root, ".scp-upload-17-2/probe"),
        target: `${env.DEPLOY_USER}@127.0.0.1:${staging}/probe/probe`,
        ssh: join(runner, "hehuoda-scp-17-2/rsync-ssh"),
        logDirectory: runner,
        kind: "probe",
        attempt: 1,
        wallSeconds: 10,
        ioSeconds: 1,
        command: ["/usr/bin/rsync"],
        onEvent: () => {},
      });
      assert.equal(io.category, "timeout");
      rmSync(join(root, "stall"));
      mkdirSync(join(deployRoot, "releases", env.RELEASE_SHA, "18-1.incoming"));
      ok(control(["cleanup"]));
      assert.equal(existsSync(staging), false);
      assert.ok(existsSync(join(release, ".payload")));
      assert.ok(
        existsSync(
          join(deployRoot, "releases", env.RELEASE_SHA, "18-1.incoming"),
        ),
      );
    } finally {
      if (server) {
        spawnSync("sudo", ["-n", "kill", "-TERM", "--", `-${server.pid}`], {
          stdio: "ignore",
        });
        if (server.exitCode === null && server.signalCode === null)
          await once(server, "close");
      }
      rmSync(root, { recursive: true, force: true });
    }
  },
);
