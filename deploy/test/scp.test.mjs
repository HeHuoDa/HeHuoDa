import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const helper = fileURLToPath(new URL("../scp.sh", import.meta.url)).replaceAll(
  "\\",
  "/",
);
const bash =
  process.platform === "win32"
    ? resolve(
        dirname(
          execFileSync("where.exe", ["git"], { encoding: "utf8" })
            .trim()
            .split(/\r?\n/)[0],
        ),
        "../bin/bash.exe",
      )
    : "bash";

function fixture(t, body, extra = {}) {
  const directory = mkdtempSync(join(tmpdir(), "hehuoda-scp-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(
    join(directory, "environment.bash"),
    `
ssh() {
  if [[ "\${REMOTE_FAIL:-}" != '' ]]; then
    echo 'fixture-private server.example password=fixture-private' >&2
    return "$REMOTE_FAIL"
  fi
  bash -c "\${*: -1}"
}
sshpass() { [[ "$SSHPASS" == fixture-private ]]; shift; "$@"; }
docker() { return 0; }
sleep() { return 0; }
timeout() { shift 3; "$@"; }
export -f ssh sshpass docker sleep timeout
`,
  );
  const result = spawnSync(bash, ["--noprofile", "--norc", "-s"], {
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      FIXTURE_ROOT: directory.replaceAll("\\", "/"),
      HELPER: helper,
      ...extra,
    },
    input: `set -euo pipefail
export GITHUB_WORKSPACE=$(cd "$FIXTURE_ROOT" && pwd)
export RUNNER_TEMP="$GITHUB_WORKSPACE/runner"
export DEPLOY_PATH="$GITHUB_WORKSPACE/host"
export GITHUB_RUN_ID=17 GITHUB_RUN_ATTEMPT=2 RELEASE_SHA=${"a".repeat(40)} DEPLOY_ACTION=prepare
export DEPLOY_HOST=server.example DEPLOY_PORT=2222 DEPLOY_USER=fixture
export DEPLOY_PASSWORD=fixture-private DEPLOY_SSH_KEY=''
export GITHUB_ENV="$GITHUB_WORKSPACE/github-env" GITHUB_OUTPUT="$GITHUB_WORKSPACE/github-output"
export BASH_ENV="$GITHUB_WORKSPACE/environment.bash"
mkdir -p "$RUNNER_TEMP" "$DEPLOY_PATH" "$GITHUB_WORKSPACE/source"
touch "$DEPLOY_PATH/.env"
echo 'sealed verified contents' > "$GITHUB_WORKSPACE/source/file"
tar -czf "$RUNNER_TEMP/payload.tar.gz" -C "$GITHUB_WORKSPACE/source" .
ssh-keygen -q -t ed25519 -N '' -f "$GITHUB_WORKSPACE/hostkey"
export DEPLOY_KNOWN_HOSTS="[server.example]:2222 $(cat "$GITHUB_WORKSPACE/hostkey.pub")"
cd "$GITHUB_WORKSPACE"
${body}
`,
  });
  assert.ifError(result.error);
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-private/);
  return { ...result, directory };
}

test("SCP preparation pins the endpoint key, verifies sealed uploads, reuses complete reception and preserves releases on cleanup", (t) => {
  const result = fixture(
    t,
    `
bash "$HELPER" setup
source "$GITHUB_ENV"
staging="$SCP_STAGING"
cp "$SCP_SOURCE_DIR/probe" "$staging/probe/probe"
bash "$HELPER" probe
printf corrupt > "$staging/upload/payload.tar.gz"
bash "$HELPER" received
grep -q 'valid=false' "$GITHUB_OUTPUT"
bash "$HELPER" retry
test ! -e "$staging/upload/payload.tar.gz"
cp "$SCP_SOURCE_DIR/payload.tar.gz" "$staging/upload/payload.tar.gz"
bash "$HELPER" received
grep -q 'valid=true' "$GITHUB_OUTPUT"
bash "$HELPER" verify
release="$DEPLOY_PATH/releases/$RELEASE_SHA/17-2"
cmp "$release/file" "$GITHUB_WORKSPACE/source/file"
test -s "$release/.payload"
bash "$HELPER" cleanup
test ! -e "$staging"
test -f "$release/file"
test ! -e "$SCP_SOURCE_DIR"
`,
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(
    result.stdout,
    /phase=link-probe status=verified bytes=1048576 transport=scp/,
  );
  assert.match(result.stdout, /phase=payload status=retrying attempt=2/);
  assert.match(result.stderr, /category=integrity-mismatch/);
});

test("corrupt archives never extract or become release directories", (t) => {
  const result = fixture(
    t,
    `
bash "$HELPER" setup
source "$GITHUB_ENV"
printf corrupt > "$SCP_STAGING/upload/payload.tar.gz"
bash "$HELPER" verify
`,
  );
  assert.equal(result.status, 42, result.stdout + result.stderr);
  assert.match(result.stderr, /category=integrity-mismatch/);
  assert.equal(
    existsSync(join(result.directory, "host/releases", "a".repeat(40), "17-2")),
    false,
  );
});

test("unknown endpoints fail before connecting, and SSH errors export only safe categories", (t) => {
  const unknown = fixture(t, `DEPLOY_HOST=other.example bash "$HELPER" setup`);
  assert.notEqual(unknown.status, 0);
  assert.doesNotMatch(unknown.stdout, /phase=connect/);
  const timedOut = fixture(t, `REMOTE_FAIL=124 bash "$HELPER" setup`);
  assert.equal(timedOut.status, 124);
  assert.match(timedOut.stderr, /exit_code=124 category=timeout/);
  const auth = fixture(t, `DEPLOY_SSH_KEY=fixture-key bash "$HELPER" setup`);
  assert.equal(auth.status, 1);
  assert.match(auth.stderr, /invalid-authentication/);
});

test("hashed known_hosts entries and key authentication are accepted without password fallback", (t) => {
  const result = fixture(
    t,
    `
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$GITHUB_WORKSPACE/hashed"
ssh-keygen -H -f "$GITHUB_WORKSPACE/hashed" >/dev/null 2>&1
export DEPLOY_KNOWN_HOSTS=$(cat "$GITHUB_WORKSPACE/hashed")
export DEPLOY_PASSWORD='' DEPLOY_SSH_KEY=fixture-key
bash "$HELPER" setup
`,
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("cleanup removes an interrupted attempt's staging without touching another run", (t) => {
  const result = fixture(
    t,
    `
bash "$HELPER" setup
source "$GITHUB_ENV"
mkdir -p "$DEPLOY_PATH/releases/$RELEASE_SHA/18-1.incoming"
touch "$DEPLOY_PATH/releases/$RELEASE_SHA/18-1.incoming/other"
printf partial > "$SCP_STAGING/upload/payload.tar.gz"
bash "$HELPER" cleanup
test ! -e "$SCP_STAGING"
test -f "$DEPLOY_PATH/releases/$RELEASE_SHA/18-1.incoming/other"
`,
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("multiple trusted key types follow the pinned SCP client's preference, while conflicting keys fail closed", (t) => {
  const multiple = fixture(
    t,
    `
ssh-keygen -q -t ecdsa -b 256 -N '' -f "$GITHUB_WORKSPACE/ecdsa"
export DEPLOY_KNOWN_HOSTS="$DEPLOY_KNOWN_HOSTS
[server.example]:2222 $(cat "$GITHUB_WORKSPACE/ecdsa.pub")"
bash "$HELPER" setup
source "$GITHUB_ENV"
expected=$(ssh-keygen -lf "$GITHUB_WORKSPACE/ecdsa.pub" -E sha256 | awk '{print $2}')
test "$SCP_FINGERPRINT" = "$expected"
`,
  );
  assert.equal(multiple.status, 0, multiple.stdout + multiple.stderr);
  const conflicting = fixture(
    t,
    `
ssh-keygen -q -t ed25519 -N '' -f "$GITHUB_WORKSPACE/rotated"
export DEPLOY_KNOWN_HOSTS="$DEPLOY_KNOWN_HOSTS
[server.example]:2222 $(cat "$GITHUB_WORKSPACE/rotated.pub")"
bash "$HELPER" setup
`,
  );
  assert.notEqual(conflicting.status, 0);
  assert.match(conflicting.stderr, /ambiguous-host-keys/);
  const revoked = fixture(
    t,
    `
export DEPLOY_KNOWN_HOSTS="$DEPLOY_KNOWN_HOSTS
@revoked [server.example]:2222 $(cat "$GITHUB_WORKSPACE/hostkey.pub")"
bash "$HELPER" setup
`,
  );
  assert.notEqual(revoked.status, 0);
  assert.match(revoked.stderr, /revoked-host-key/);
});
