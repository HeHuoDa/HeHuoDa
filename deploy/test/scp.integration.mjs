import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  copyFileSync,
  chmodSync,
  statSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer, createConnection } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

test(
  "the Action's drone-scp image enforces fingerprints and delivers sealed archives over real SSH",
  {
    skip: process.platform !== "linux",
    timeout: 180_000,
  },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "hehuoda-scp-integration-"));
    chmodSync(root, 0o755);
    // A shared volume/network also lets Docker Desktop run this Linux harness in a container.
    const network = process.env.SCP_TEST_NETWORK || "host";
    const host = process.env.SCP_TEST_HOST || "127.0.0.1";
    const password = process.env.SCP_TEST_PASSWORD || "";
    const mount = process.env.SCP_TEST_VOLUME
      ? `${process.env.SCP_TEST_VOLUME}:/scp-test`
      : `${root}:${root}`;
    const helper = fileURLToPath(new URL("../scp.sh", import.meta.url));
    const image = "ghcr.io/appleboy/drone-scp:1.6.14";
    const run = (bin, args, options = {}) =>
      spawnSync(bin, args, {
        encoding: "utf8",
        timeout: 60_000,
        ...options,
      });
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
    let env;
    try {
      ok(run("docker", ["pull", image]));
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
      // Only this isolated fixture key is shared with the Action's default UID 1000.
      chmodSync(join(root, "client"), 0o644);
      const hostKey = readFileSync(join(root, "host.pub"), "utf8")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .join(" ");
      const fingerprint = ok(
        run("ssh-keygen", ["-lf", join(root, "host.pub"), "-E", "sha256"]),
      )
        .trim()
        .split(/\s+/)[1];
      const wrongFingerprint = ok(
        run("ssh-keygen", ["-lf", join(root, "client.pub"), "-E", "sha256"]),
      )
        .trim()
        .split(/\s+/)[1];
      writeFileSync(
        join(root, "sshd_config"),
        `Port ${port}\nListenAddress ${network === "host" ? "127.0.0.1" : "0.0.0.0"}\nHostKey ${root}/host\nPidFile ${root}/sshd.pid\nAuthorizedKeysFile ${root}/client.pub\nStrictModes no\nPasswordAuthentication ${password ? "yes" : "no"}\nPermitRootLogin ${password ? "yes" : "prohibit-password"}\nKbdInteractiveAuthentication no\nUsePAM yes\nAllowUsers ${userInfo().username}\nLogLevel ERROR\n`,
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
      const deployRoot = join(root, "deployment");
      const runner = join(root, "runner");
      mkdirSync(deployRoot);
      mkdirSync(runner);
      mkdirSync(join(root, "source"));
      writeFileSync(join(deployRoot, ".env"), "");
      writeFileSync(
        join(root, "source/file"),
        randomBytes(
          process.env.SCP_TEST_LARGE_PAYLOAD === "true" ? 129390874 : 1048576,
        ),
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
      console.log(
        `SCP fixture authentication=${password ? "password" : "key"} payload_bytes=${statSync(join(runner, "payload.tar.gz")).size}`,
      );
      env = {
        ...process.env,
        GITHUB_WORKSPACE: root,
        RUNNER_TEMP: runner,
        GITHUB_RUN_ID: "17",
        GITHUB_RUN_ATTEMPT: "2",
        RELEASE_SHA: "a".repeat(40),
        DEPLOY_ACTION: "prepare",
        DEPLOY_HOST: host,
        DEPLOY_PORT: String(port),
        DEPLOY_USER: userInfo().username,
        DEPLOY_PATH: deployRoot,
        DEPLOY_PASSWORD: password,
        DEPLOY_SSH_KEY: password
          ? ""
          : readFileSync(join(root, "client"), "utf8"),
        DEPLOY_KNOWN_HOSTS: `[${host}]:${port} ${hostKey}`,
        GITHUB_ENV: join(root, "github-env"),
        GITHUB_OUTPUT: join(root, "github-output"),
      };
      const control = (operation) => run("bash", [helper, operation], { env });
      ok(control("setup"));
      const staging = join(
        deployRoot,
        "releases",
        env.RELEASE_SHA,
        "17-2.incoming",
      );
      const upload = (
        name,
        pin = fingerprint,
        endpoint = port,
        timeout = "30s",
      ) => {
        const variables = {
          PLUGIN_HOST: host,
          PLUGIN_PORT: String(endpoint),
          PLUGIN_USERNAME: userInfo().username,
          PLUGIN_KEY_PATH: password ? "" : `${root}/client`,
          PLUGIN_PASSWORD: password,
          PLUGIN_FINGERPRINT: pin,
          PLUGIN_SOURCE: `.scp-upload-17-2/${name}`,
          PLUGIN_TARGET: `${staging}/${name === "probe" ? "probe" : "upload"}`,
          PLUGIN_TAR_TMP_PATH: `${staging}/`,
          PLUGIN_STRIP_COMPONENTS: "1",
          PLUGIN_OVERWRITE: "true",
          PLUGIN_TIMEOUT: timeout,
          PLUGIN_COMMAND_TIMEOUT: "10s",
        };
        return run("docker", [
          "run",
          "--rm",
          "--network",
          network,
          "-v",
          mount,
          "-w",
          root,
          "--entrypoint",
          "/bin/drone-scp",
          ...Object.entries(variables).flatMap(([key, value]) => [
            "-e",
            `${key}=${value}`,
          ]),
          image,
        ]);
      };
      const rejected = upload("probe", wrongFingerprint);
      assert.ifError(rejected.error);
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stdout + rejected.stderr, /fingerprint mismatch/);
      assert.equal(existsSync(join(staging, "probe/probe")), false);
      ok(upload("probe"));
      ok(control("probe"));

      // This old client can stall after TCP connect; an outer step deadline must stop it.
      const sockets = new Set();
      let connections = 0;
      const stalled = createServer((socket) => {
        connections++;
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
      });
      stalled.listen(0, network === "host" ? "127.0.0.1" : "0.0.0.0");
      await once(stalled, "listening");
      try {
        // Keep Node's event loop alive while the Docker client waits on the isolated stalled peer.
        const args = [
          "run",
          "--rm",
          "--name",
          `hehuoda-scp-timeout-${process.pid}`,
          "--network",
          network,
          "--entrypoint",
          "/bin/drone-scp",
          "-e",
          `PLUGIN_HOST=${host}`,
          "-e",
          `PLUGIN_PORT=${stalled.address().port}`,
          "-e",
          "PLUGIN_TIMEOUT=1s",
          "-e",
          "PLUGIN_COMMAND_TIMEOUT=1s",
          "-e",
          `PLUGIN_FINGERPRINT=${fingerprint}`,
          "-e",
          "PLUGIN_SOURCE=client.pub",
          "-e",
          "PLUGIN_TARGET=/tmp/unused",
          "-e",
          "PLUGIN_PASSWORD=isolated-fixture",
          "-v",
          mount,
          "-w",
          root,
          image,
        ];
        const started = Date.now();
        const child = spawn("docker", args, { stdio: "ignore" });
        let forced = false;
        const timer = setTimeout(() => {
          forced = true;
          spawnSync(
            "docker",
            ["rm", "-f", `hehuoda-scp-timeout-${process.pid}`],
            { stdio: "ignore" },
          );
        }, 5_000);
        const [code] = await once(child, "close");
        clearTimeout(timer);
        assert.ok(
          connections > 0,
          "the client must reach the stalled SSH peer",
        );
        assert.equal(
          forced,
          true,
          "the outer deadline terminates the stalled Action container",
        );
        assert.ok(Date.now() - started < 15_000);
        assert.notEqual(code, 0);
      } finally {
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => stalled.close(resolve));
      }

      // A partial/corrupt upload cannot be extracted; the second attempt can replace it.
      writeFileSync(join(staging, "upload/payload.tar.gz"), "truncated");
      ok(control("received"));
      assert.match(readFileSync(env.GITHUB_OUTPUT, "utf8"), /valid=false/);
      assert.equal(control("verify").status, 42);
      assert.equal(existsSync(join(staging, "verified")), false);
      ok(control("retry"));
      ok(upload("payload.tar.gz"));
      // Lost Action responses are safe: the receiver verifies a completed copy before deciding to retry.
      ok(control("received"));
      assert.match(readFileSync(env.GITHUB_OUTPUT, "utf8"), /valid=true/);
      ok(control("verify"));
      const release = join(deployRoot, "releases", env.RELEASE_SHA, "17-2");
      assert.deepEqual(
        readFileSync(join(release, "file")),
        readFileSync(join(root, "source/file")),
      );
      ok(control("cleanup"));
      assert.equal(existsSync(staging), false);
      assert.equal(existsSync(join(release, ".payload")), true);
      // Cancellation cleanup must preserve other attempts and already verified releases.
      mkdirSync(join(staging, "upload"), { recursive: true });
      copyFileSync(
        join(runner, "payload.tar.gz"),
        join(staging, "upload/payload.tar.gz"),
      );
      ok(control("cleanup"));
      assert.equal(existsSync(staging), false);
      assert.equal(existsSync(join(release, "file")), true);
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
