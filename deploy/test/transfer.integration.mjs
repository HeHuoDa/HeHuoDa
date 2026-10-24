import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { createServer, createConnection } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { parse } from "yaml";

test(
  "real SSH transfer handles truncation, timeout, lost response, reuse and cancellation",
  { skip: process.platform !== "linux", timeout: 90_000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "hehuoda-ssh-integration-"));
    const run = (bin, args, options = {}) => {
      const result = spawnSync(bin, args, {
        encoding: "utf8",
        timeout: 30_000,
        ...options,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr || String(result.error));
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
        run("ssh-keygen", [
          "-q",
          "-t",
          "ed25519",
          "-N",
          "",
          "-f",
          join(root, name),
        ]);
      const host = readFileSync(join(root, "host.pub"), "utf8")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .join(" ");
      writeFileSync(join(root, "known_hosts"), `[127.0.0.1]:${port} ${host}\n`);
      writeFileSync(
        join(root, "sshd_config"),
        `Port ${port}\nListenAddress 127.0.0.1\nHostKey ${root}/host\nPidFile ${root}/sshd.pid\nAuthorizedKeysFile ${root}/client.pub\nStrictModes no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM yes\nAllowUsers ${userInfo().username}\nLogLevel ERROR\n`,
      );
      server = spawn(
        "sudo",
        ["-n", "/usr/sbin/sshd", "-D", "-e", "-f", join(root, "sshd_config")],
        { stdio: "ignore", detached: true },
      );
      let ready = false;
      for (let attempt = 0; attempt < 50 && !ready; attempt++) {
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
      assert.equal(ready, true, "isolated SSH daemon must start");
      mkdirSync(join(root, "source"));
      writeFileSync(
        join(root, "source", "file"),
        "verified contents\n".repeat(1000),
      );
      run("tar", [
        "-czf",
        join(root, "payload.tar.gz"),
        "-C",
        join(root, "source"),
        ".",
      ]);
      const workflow = parse(
        readFileSync(
          new URL("../../.github/workflows/deploy.yml", import.meta.url),
          "utf8",
        ),
      );
      const script = workflow.jobs.deploy.steps.find(
        (step) => step.env?.DEPLOY_HOST,
      ).run;
      const transfer = script
        .slice(
          script.indexOf("transfer() {"),
          script.indexOf("# Measure the same SSH"),
        )
        .replace("then sleep 10;", "then sleep 0.1;");
      const remote = script
        .split("\n")
        .find((line) => line.trim().startsWith("remote()"));
      writeFileSync(
        join(root, "transport.sh"),
        `#!/usr/bin/env bash
set -euo pipefail
command="\${*: -1}"
if [[ "$command" == *"cat >"* ]]; then
  count=0; [[ ! -f "$CASE_ROOT/count" ]] || count=$(cat "$CASE_ROOT/count")
  count=$((count + 1)); echo "$count" > "$CASE_ROOT/count"
  if [[ "$SCENARIO" == truncated && "$count" == 1 ]]; then head -c 64 | command ssh "$@"; exit; fi
  if [[ "$SCENARIO" == timeout || "$SCENARIO" == cancel ]]; then { head -c 64; sleep 20; cat; } | command ssh "$@"; exit; fi
fi
command ssh "$@"
if [[ "$SCENARIO" == lost && "$command" == *"mv "* && ! -f "$CASE_ROOT/lost" ]]; then touch "$CASE_ROOT/lost"; exit 1; fi
`,
        { mode: 0o700 },
      );
      const setup = `set -euo pipefail
task_dir="$CASE_ROOT"
transport=(bash "$ROOT/transport.sh")
ssh_args=(-F /dev/null -p "$PORT" -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$ROOT/known_hosts" -o IdentitiesOnly=yes -i "$ROOT/client")
target="$SSH_USER@127.0.0.1"
timeout() { local signal="$1" grace="$2" seconds="$3"; shift 3; [[ "$seconds" != 600 || "$SCENARIO" != timeout ]] || seconds=1; command timeout "$signal" "$grace" "$seconds" "$@"; }
${remote}
${transfer}
transfer payload "$ROOT/payload.tar.gz" "$CASE_ROOT/release"
`;
      for (const scenario of [
        "fresh",
        "truncated",
        "lost",
        "timeout",
        "cancel",
      ]) {
        console.log(`SSH scenario started: ${scenario}`);
        const caseRoot = join(root, scenario);
        mkdirSync(caseRoot);
        const env = {
          ...process.env,
          ROOT: root,
          CASE_ROOT: caseRoot,
          PORT: String(port),
          SSH_USER: userInfo().username,
          SCENARIO: scenario,
        };
        if (scenario === "cancel") {
          const child = spawn("bash", ["-c", setup], {
            env,
            detached: true,
            stdio: "ignore",
          });
          const closed = once(child, "close");
          for (
            let attempt = 0;
            attempt < 50 &&
            !existsSync(join(caseRoot, "release.incoming", "payload.tar.gz"));
            attempt++
          )
            await new Promise((resolve) => setTimeout(resolve, 100));
          assert.equal(
            existsSync(join(caseRoot, "release.incoming", "payload.tar.gz")),
            true,
          );
          process.kill(-child.pid, "SIGTERM");
          await closed;
          assert.equal(
            existsSync(join(caseRoot, "release.incoming")),
            false,
            "cancelled transfer removes its staging directory",
          );
        } else {
          const result = spawnSync("bash", ["-c", setup], {
            env,
            encoding: "utf8",
            timeout: 30_000,
          });
          assert.ifError(result.error);
          assert.equal(
            result.status,
            scenario === "timeout" ? 1 : 0,
            result.stdout + result.stderr,
          );
          assert.equal(existsSync(join(caseRoot, "release.incoming")), false);
          if (scenario !== "timeout") {
            assert.equal(
              readFileSync(join(caseRoot, "release", "file"), "utf8"),
              readFileSync(join(root, "source", "file"), "utf8"),
            );
            const reused = spawnSync("bash", ["-c", setup], {
              env,
              encoding: "utf8",
              timeout: 30_000,
            });
            assert.ifError(reused.error);
            assert.equal(reused.status, 0, reused.stderr);
            assert.match(reused.stdout, /status=reused/);
          }
        }
        console.log(`SSH scenario passed: ${scenario}`);
      }
    } finally {
      if (server)
        spawnSync("sudo", ["-n", "kill", "-TERM", "--", `-${server.pid}`], {
          stdio: "ignore",
        });
      if (server) {
        if (server.exitCode === null && server.signalCode === null)
          await Promise.race([
            once(server, "close"),
            new Promise((_, reject) => {
              const timer = setTimeout(
                () => reject(new Error("Isolated SSH daemon did not stop")),
                5_000,
              );
              timer.unref();
            }),
          ]);
      }
      rmSync(root, { recursive: true, force: true });
    }
  },
);
