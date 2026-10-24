import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  existsSync,
  rmSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
} from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { parse } from "yaml";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createArchiveManifest } from "../archive.mjs";

function workflow(name) {
  return parse(
    readFileSync(
      new URL(`../../.github/workflows/${name}.yml`, import.meta.url),
      "utf8",
    ),
  );
}

function condition(expression, github, vars = {}) {
  if (typeof expression === "boolean") return expression;
  return runInNewContext(expression.replace(/^\$\{\{\s*|\s*\}\}$/g, ""), {
    github,
    vars,
  });
}

function which(name) {
  try {
    return execFileSync("where.exe", [name], { encoding: "utf8" })
      .trim()
      .split(/\r?\n/)[0];
  } catch {
    return "";
  }
}

function bashPath() {
  if (process.platform !== "win32") return "bash";
  const candidates = [];
  const direct = which("bash");
  if (direct) candidates.push(direct);
  const git = which("git");
  if (git) {
    const bin = dirname(git);
    candidates.push(
      resolve(bin, "../bin/bash.exe"),
      resolve(bin, "bash.exe"),
      resolve(bin, "../../bin/bash.exe"),
    );
  }
  return candidates.find((candidate) => existsSync(candidate)) || "bash";
}

function runBash(input, env = {}) {
  return spawnSync(bashPath(), ["--noprofile", "--norc", "-s"], {
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, ...env },
    input,
  });
}

test("CI job environment does not reference runner context before runner allocation", () => {
  for (const [name, job] of Object.entries(workflow("ci").jobs)) {
    for (const value of Object.values(job.env || {})) {
      assert.doesNotMatch(
        String(value),
        /\$\{\{[^}]*\brunner\s*\./,
        `${name}: runner context is available in step env, not job env`,
      );
    }
  }
});

test("main CI archives the verified images without publishing to a registry", () => {
  const ci = workflow("ci");
  assert.deepEqual(ci.on.push.branches, ["main"]);
  assert.ok(Object.hasOwn(ci.on, "workflow_dispatch"));
  assert.equal(ci.jobs["publish-images"], undefined);
  assert.deepEqual(ci.jobs["ci-gate"].needs, ["quality", "image-smoke"]);
  for (const [name, job] of Object.entries(ci.jobs)) {
    assert.equal(job.permissions?.packages, undefined, name);
    assert.doesNotMatch(JSON.stringify(job), /ghcr\.io|TCR_|tencentyun/, name);
  }
  const smoke = ci.jobs["image-smoke"];
  assert.equal(smoke.env.IMAGE_PREFIX, "hehuoda-local");
  for (const event_name of ["push", "workflow_dispatch"]) {
    for (const step of smoke.steps.filter(
      (step) => step.if && step.if !== "failure()",
    )) {
      assert.equal(
        condition(step.if, { event_name, ref: "refs/heads/main" }),
        true,
        step.name || step.uses,
      );
      assert.equal(
        condition(step.if, { event_name, ref: "refs/heads/fix/example" }),
        false,
        step.name || step.uses,
      );
    }
  }
  for (const step of smoke.steps.filter(
    (step) => step.if && step.if !== "failure()",
  )) {
    assert.equal(
      condition(step.if, {
        event_name: "pull_request",
        ref: "refs/heads/main",
      }),
      false,
      step.name || step.uses,
    );
  }
});

test("the deployable archive is attempt-scoped, self-describing and retained for seven days", () => {
  const smoke = workflow("ci").jobs["image-smoke"];
  const upload = smoke.steps.find(
    (step) =>
      step.uses?.startsWith("actions/upload-artifact") &&
      step.with.name.startsWith("release-archive-"),
  );
  assert.ok(upload, "image-smoke must upload the deployable archive");
  assert.ok(upload.with.name.includes("github.sha"));
  assert.ok(upload.with.name.includes("github.run_attempt"));
  assert.equal(upload.with["retention-days"], 7);
  assert.equal(upload.with["if-no-files-found"], "error");
  const save = smoke.steps.find((step) =>
    step.name?.startsWith("Save the verified images"),
  );
  assert.match(save.run, /docker image save/);
  assert.match(save.run, /node deploy\/archive\.mjs create/);
});

test("deployment requires a retained archive from a successful image-smoke job", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "hehuoda-ci-proof-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const script = workflow("deploy").jobs.deploy.steps.find(
    (step) => step.id === "verified",
  ).run;
  for (const [event, archived, expected, artifact = true] of [
    ["push", "1", 0],
    ["workflow_dispatch", "1", 0],
    ["workflow_dispatch", "0", 1],
    ["pull_request", "1", 1],
    ["workflow_dispatch", "1", 1, false],
    ["workflow_dispatch", "1", 1, "wrong-attempt"],
  ]) {
    const output = join(
      directory,
      `${event}-${archived}-${artifact}`,
    ).replaceAll("\\", "/");
    const result = runBash(
      `
      gh() {
        case "$*" in
          *"head_sha=$CANDIDATE_SHA&branch=main&event=$RUN_EVENT&status=success"*) echo 17 ;;
          *"/runs/17/attempts/1/jobs?per_page=100"*) printf '%s\\n' "$SMOKE_COUNT" ;;
          *"/runs/17/attempts/2/jobs?per_page=100"*) echo 0 ;;
          *"/runs/17/artifacts?per_page=100"*) printf '%s\\n' "$ARCHIVE_ARTIFACT" ;;
          *"/workflows/ci.yml/runs?"*) return 0 ;;
          *) echo "Unexpected API call" >&2; return 1 ;;
        esac
      }
      ${script}
    `,
      {
        GH_REPO: "HeHuoDa/HeHuoDa",
        CANDIDATE_SHA: "a".repeat(40),
        DEPLOY_ACTION: "prepare",
        RUN_EVENT: event,
        RELEASE_EVENT: "workflow_dispatch",
        SMOKE_COUNT: archived,
        ARCHIVE_ARTIFACT:
          artifact === "wrong-attempt"
            ? `release-archive-${"a".repeat(40)}-2`
            : artifact
              ? `release-archive-${"a".repeat(40)}-1`
              : "smoke-diagnostics-17-1",
        GITHUB_OUTPUT: output,
      },
    );
    assert.equal(
      result.status,
      expected,
      `${event}/${archived}: ${result.stderr}`,
    );
    if (expected === 0)
      assert.equal(
        readFileSync(output, "utf8"),
        `sha=${"a".repeat(40)}\nrun_id=17\nattempt=1\nartifact=release-archive-${"a".repeat(40)}-1\n`,
      );
    else assert.equal(existsSync(output), false);
  }
});

test("explicit rollback does not require an artifact that may have expired", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "hehuoda-ci-rollback-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = join(directory, "output").replaceAll("\\", "/");
  const result = runBash(
    `
    gh() { echo "Rollback must not query GitHub" >&2; return 1; }
    ${workflow("deploy").jobs.deploy.steps.find((step) => step.id === "verified").run}
  `,
    {
      GH_REPO: "HeHuoDa/HeHuoDa",
      CANDIDATE_SHA: "a".repeat(40),
      DEPLOY_ACTION: "rollback",
      RELEASE_EVENT: "workflow_dispatch",
      GITHUB_OUTPUT: output,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(output, "utf8"), `sha=${"a".repeat(40)}\n`);
});

test("the deploy controller comes from trusted main and the target only supplies its config", () => {
  const deploy = workflow("deploy").jobs.deploy;
  assert.equal(deploy["timeout-minutes"], 45);
  assert.equal(deploy.environment, "production");
  const checkouts = deploy.steps.filter((step) =>
    step.uses?.startsWith("actions/checkout"),
  );
  assert.equal(checkouts.length, 2);
  assert.equal(checkouts[0].with.ref, "main");
  assert.equal(checkouts[0].with.path, "controller");
  assert.equal(checkouts[1].with.ref, "${{ steps.verified.outputs.sha }}");
  assert.equal(checkouts[1].with.path, "target");
  const assemble = deploy.steps.find((step) =>
    step.name?.startsWith("Assemble"),
  );
  assert.match(assemble.run, /cp controller\/deploy\/\*\.mjs/);
  assert.match(assemble.run, /cp target\/compose\.deploy\.yaml/);
  assert.match(assemble.run, /node controller\/deploy\/archive\.mjs verify/);
});

test("assembled payload retains the TLS bind source at its Compose path", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "hehuoda-payload-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const child of [
    "controller/deploy",
    "target/deploy/nginx",
    "runner/release-archive",
  ])
    mkdirSync(join(directory, child), { recursive: true });
  for (const name of readdirSync(new URL("../", import.meta.url)).filter(
    (name) => name.endsWith(".mjs"),
  ))
    copyFileSync(
      new URL(`../${name}`, import.meta.url),
      join(directory, "controller/deploy", name),
    );
  for (const name of [
    "compose.deploy.yaml",
    "compose.tls.yaml",
    "deploy/nginx/https.conf",
  ])
    copyFileSync(
      new URL(`../../${name}`, import.meta.url),
      join(directory, "target", name),
    );
  const sha = "a".repeat(40);
  const archive = join(directory, "runner/release-archive");
  writeFileSync(join(archive, "images.tar.gz"), "verified fixture archive");
  await createArchiveManifest({
    directory: archive,
    sha,
    repository: "HeHuoDa/HeHuoDa",
    runId: "17",
    runAttempt: "1",
    imagePrefix: "hehuoda-local",
    inspectImage: () => ({
      id: `sha256:${"b".repeat(64)}`,
      platform: "linux/amd64",
    }),
  });
  const assemble = workflow("deploy").jobs.deploy.steps.find((step) =>
    step.name?.startsWith("Assemble"),
  );
  const result = runBash(
    `cd "$ASSEMBLY_ROOT"\nRUNNER_TEMP=$(cd "$RUNNER_TEMP" && pwd)\n${assemble.run}\ntar -tzf "$RUNNER_TEMP/payload.tar.gz"`,
    {
      ASSEMBLY_ROOT: directory.replaceAll("\\", "/"),
      RUNNER_TEMP: join(directory, "runner").replaceAll("\\", "/"),
      DEPLOY_ACTION: "prepare",
      CANDIDATE_SHA: sha,
      GITHUB_REPOSITORY: "HeHuoDa/HeHuoDa",
      ARCHIVE_RUN_ID: "17",
      ARCHIVE_RUN_ATTEMPT: "1",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\.\/deploy\/nginx\/https\.conf/);
  assert.equal(
    readFileSync(
      join(directory, "runner/payload/deploy/nginx/https.conf"),
      "utf8",
    ),
    readFileSync(new URL("../nginx/https.conf", import.meta.url), "utf8"),
  );
});

test("archive transfer is bounded, reuses complete copies and cleans partial ones", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "hehuoda-transfer-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const script = workflow("deploy").jobs.deploy.steps.find(
    (step) => step.env?.DEPLOY_HOST,
  ).run;
  const transfer = script.slice(
    script.indexOf("transfer() {"),
    script.indexOf("# Measure the same SSH"),
  );
  const payload = join(directory, "payload.tar.gz");
  writeFileSync(payload, "fixture payload");
  const run = (scenario) =>
    runBash(
      `
      set -euo pipefail
      task_dir="$RUNNER_TEMP"
      transport=(ssh)
      ssh_args=()
      target="fixture@example"
      payload="$PAYLOAD"
      digest=$(sha256sum "$payload" | cut -d' ' -f1)
      bytes=$(wc -c < "$payload")
      expected="$digest $bytes"
      remote() { "\${transport[@]}" "\${ssh_args[@]}" "$target" "$1"; }
      ssh() {
        local command="\${*: -1}" count
        if [[ "$command" == *".payload"* && "$command" == *cat* ]]; then
          if [[ -f "$RUNNER_TEMP/remote.payload" ]]; then cat "$RUNNER_TEMP/remote.payload"; return 0; fi
          return 1
        fi
        if [[ "$command" == *"cat >"* ]]; then
          cat >/dev/null
          count=0
          [[ -f "$RUNNER_TEMP/transfers" ]] && count=$(cat "$RUNNER_TEMP/transfers")
          count=$((count + 1))
          echo "$count" > "$RUNNER_TEMP/transfers"
          if [[ "$SCENARIO" == always-fail ]]; then return 1; fi
          if [[ "$SCENARIO" == fail-once && "$count" == 1 ]]; then return 1; fi
          return 0
        fi
        if [[ "$command" == *".payload"* && "$command" == *mv* ]]; then
          printf '%s' "$expected" > "$RUNNER_TEMP/remote.payload"
          return 0
        fi
        return 1
      }
      timeout() { shift 3; "$@"; }
      sleep() { [[ "$1" == 30 ]] && command sleep 0.05; return 0; }
      ${transfer}
      transfer payload "$payload" "/remote/releases/\${SHA}/1-1"
      `,
      {
        RUNNER_TEMP: directory.replaceAll("\\", "/"),
        PAYLOAD: payload.replaceAll("\\", "/"),
        SCENARIO: scenario,
        SHA: "a".repeat(40),
      },
    );
  const transfers = () =>
    existsSync(join(directory, "transfers"))
      ? Number(readFileSync(join(directory, "transfers"), "utf8"))
      : 0;
  const reset = () => {
    rmSync(join(directory, "transfers"), { force: true });
    rmSync(join(directory, "remote.payload"), { force: true });
  };

  let result = run("fresh");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(transfers(), 1, "a first transfer must send the payload once");

  rmSync(join(directory, "transfers"), { force: true });
  result = run("reuse");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(transfers(), 0, "a complete remote copy must be reused");
  assert.match(result.stdout, /status=reused/);

  reset();
  result = run("fail-once");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(transfers(), 2, "a failed attempt must be retried exactly once");

  reset();
  result = run("always-fail");
  assert.equal(result.status, 1, "transfer must give up after two attempts");
  assert.equal(transfers(), 2);
  assert.match(result.stderr, /status=transfer-failed attempts=2/);
  assert.doesNotMatch(result.stdout + result.stderr, /fixture@example/);
});

test("a slow SSH probe rejects the archive before starting a full transfer", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "hehuoda-link-probe-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, "payload.tar.gz"), Buffer.alloc(2 * 1048576));
  const script = workflow("deploy").jobs.deploy.steps.find(
    (step) => step.env?.DEPLOY_HOST,
  ).run;
  const probe = script.slice(
    script.indexOf("# Measure the same SSH"),
    script.indexOf("transfer payload"),
  );
  for (const [scenario, expected] of [
    ["fast", 0],
    ["slow", 1],
    ["failed", 1],
  ]) {
    const result = runBash(
      `
      set -euo pipefail
      task_dir="$RUNNER_TEMP"
      transport=(ssh)
      ssh_args=()
      target="fixture@example"
      date() { if [[ -f "$RUNNER_TEMP/clock" ]]; then echo "$PROBE_END"; else touch "$RUNNER_TEMP/clock"; echo 0; fi; }
      timeout() { shift 3; "$@"; }
      ssh() { cat >/dev/null; [[ "$SCENARIO" != failed ]]; }
      ${probe}
      echo 'full-transfer-would-start'
    `,
      {
        RUNNER_TEMP: directory.replaceAll("\\", "/"),
        SCENARIO: scenario,
        PROBE_END: scenario === "slow" ? "400" : "1",
      },
    );
    rmSync(join(directory, "clock"), { force: true });
    assert.equal(result.status, expected, result.stderr);
    assert.equal(
      result.stdout.includes("full-transfer-would-start"),
      expected === 0,
    );
    assert.doesNotMatch(result.stdout + result.stderr, /fixture@example/);
    if (scenario === "slow")
      assert.match(result.stderr, /insufficient-throughput/);
  }
});

test("automatic deployment skips superseded main SHA while explicit rollback still works", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "hehuoda-ci-latest-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const deploy = workflow("deploy").jobs.deploy;
  const script = deploy.steps.find((step) => step.id === "verified").run;
  for (const [event, current, allowed] of [
    ["workflow_run", "a", true],
    ["workflow_run", "b", false],
    ["workflow_dispatch", "b", true],
  ]) {
    const output = join(directory, `${event}-${current}`).replaceAll("\\", "/");
    const result = runBash(
      `
      gh() {
        case "$*" in
          *"git/ref/heads/main"*) printf '%s\\n' "$CURRENT_MAIN" ;;
          *"/workflows/ci.yml/runs?"*) echo 17 ;;
          *"/runs/17/attempts/1/jobs?"*) echo 1 ;;
          *"/runs/17/artifacts?"*) printf 'release-archive-%s-1\\n' "$CANDIDATE_SHA" ;;
          *) return 1 ;;
        esac
      }
      ${script}
    `,
      {
        GH_REPO: "HeHuoDa/HeHuoDa",
        CANDIDATE_SHA: "a".repeat(40),
        DEPLOY_ACTION: "deploy",
        CURRENT_MAIN: current.repeat(40),
        RELEASE_EVENT: event,
        GITHUB_OUTPUT: output,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(output), allowed, `${event}/${current}`);
  }
  const outputs = (sha, artifact) => ({
    steps: { verified: { outputs: { sha, artifact } } },
  });
  for (const step of deploy.steps.slice(
    deploy.steps.findIndex((step) => step.id === "verified") + 1,
  )) {
    assert.ok(
      step.if,
      "Checkout and SSH must be skipped without a verified SHA",
    );
    assert.equal(step.if.includes("outputs.sha"), true, step.name);
    assert.equal(runInNewContext(step.if, outputs("", "")), false, step.name);
    assert.equal(
      runInNewContext(
        step.if,
        outputs("a".repeat(40), `release-archive-${"a".repeat(40)}-1`),
      ),
      true,
      step.name,
    );
  }
});

test("PR and non-main manual CI cannot archive or start automatic deployment", () => {
  const ci = workflow("ci");
  const deploy = workflow("deploy");
  assert.deepEqual(deploy.on.workflow_run, {
    workflows: ["CI"],
    types: ["completed"],
    branches: ["main"],
  });
  assert.deepEqual(deploy.on.workflow_run.workflows, [ci.name]);
  assert.deepEqual(workflow("auto-merge").on.workflow_run.workflows, [ci.name]);
  const enabled = { DEPLOY_ENABLED: "true", DEPLOY_ARCHIVE_ACTIVATE: "true" };
  for (const [ref, allowed] of [
    ["refs/heads/main", true],
    ["refs/heads/fix/example", false],
  ]) {
    assert.equal(
      condition(
        deploy.jobs.deploy.if,
        { event_name: "workflow_dispatch", ref, event: {} },
        enabled,
      ),
      allowed,
    );
  }
  for (const event of ["push", "workflow_dispatch", "pull_request"]) {
    const github = {
      event_name: "workflow_run",
      event: {
        workflow_run: {
          conclusion: "success",
          event,
          head_branch: "main",
          head_repository: { full_name: "HeHuoDa/HeHuoDa" },
        },
      },
      repository: "HeHuoDa/HeHuoDa",
    };
    assert.equal(
      condition(deploy.jobs.deploy.if, github, enabled),
      event !== "pull_request",
      event,
    );
    assert.equal(
      condition(deploy.jobs.deploy.if, github, { DEPLOY_ENABLED: "true" }),
      false,
      `${event}: automatic updates stay off until activation is enabled`,
    );
    assert.equal(condition(deploy.jobs.deploy.if, github, {}), false);
  }
  for (const [event_name, ref] of [
    ["pull_request", "refs/heads/main"],
    ["workflow_dispatch", "refs/heads/fix/example"],
  ]) {
    const smoke = ci.jobs["image-smoke"];
    for (const step of smoke.steps.filter(
      (step) => step.if && step.if !== "failure()",
    )) {
      assert.equal(condition(step.if, { event_name, ref }), false, step.name);
    }
  }
});

function autoMerge(state, referenced = "") {
  const result = runBash(
    `
      gh() {
        case "$1 $2" in
          'pr list') echo 120 ;;
          'repo view') echo main ;;
          'pr merge') return 0 ;;
          'pr view') printf '%s\\t%s\\t%s\\tfalse\\n' "$PR_STATE" "$HEAD_SHA" "$HEAD_BRANCH" ;;
          'workflow run') printf 'DISPATCH:%s\\n' "$*" ;;
          'api --paginate') echo fixture ;;
          *) echo "Unexpected gh call: $*" >&2; return 1 ;;
        esac
      }
      jq() { cat >/dev/null; printf '%s' "$REFERENCED"; }
      ${workflow("auto-merge").jobs["auto-merge"].steps[0].run}
    `,
    {
      GH_REPO: "HeHuoDa/HeHuoDa",
      HEAD_SHA: "a".repeat(40),
      HEAD_BRANCH: "fix/example",
      PR_STATE: state,
      REFERENCED: referenced,
    },
  );
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}

test("confirmed automatic merge explicitly dispatches main CI before optional branch cleanup", () => {
  assert.match(
    autoMerge("MERGED", "another-pr"),
    /DISPATCH:workflow run ci.yml --repo HeHuoDa\/HeHuoDa --ref main/,
  );
  assert.doesNotMatch(autoMerge("OPEN"), /DISPATCH:/);
  assert.equal(workflow("auto-merge").permissions.actions, "write");
});

test("delayed merge recovery dispatches missing main CI once and leaves existing runs alone", () => {
  const recovery = workflow("release-recovery");
  assert.deepEqual(recovery.on.schedule, [{ cron: "*/15 * * * *" }]);
  assert.ok(Object.hasOwn(recovery.on, "workflow_dispatch"));
  assert.equal(recovery.permissions.actions, "write");
  const job = recovery.jobs.recover;
  assert.equal(condition(job.if, { ref: "refs/heads/fix/example" }), false);
  for (const [push, manual, dispatch] of [
    ["0", "0", true],
    ["1", "0", false],
    ["0", "1", false],
  ]) {
    const result = runBash(
      `
      gh() {
        case "$*" in
          *"git/ref/heads/main"*) printf '%s\\n' "$MAIN_SHA" ;;
          *"head_sha=$MAIN_SHA&branch=main&event=push"*) printf '%s\\n' "$PUSH_RUNS" ;;
          *"head_sha=$MAIN_SHA&branch=main&event=workflow_dispatch"*) printf '%s\\n' "$MANUAL_RUNS" ;;
          'workflow run ci.yml --repo HeHuoDa/HeHuoDa --ref main') echo DISPATCH ;;
          *) echo 'Unexpected GitHub operation' >&2; return 1 ;;
        esac
      }
      ${job.steps[0].run}
    `,
      {
        GH_REPO: "HeHuoDa/HeHuoDa",
        MAIN_SHA: "b".repeat(40),
        PUSH_RUNS: push,
        MANUAL_RUNS: manual,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout.includes("DISPATCH"),
      dispatch,
      `push=${push}, manual=${manual}`,
    );
  }
});

test("rerunning an old SHA cannot displace newer main or PR checks", () => {
  const ci = workflow("ci");
  const group = (sha, number) =>
    ci.concurrency.group.replace(/\$\{\{(.*?)\}\}/g, (_, expression) =>
      condition(expression, {
        sha,
        workflow: "CI",
        ref: "refs/heads/main",
        event: { pull_request: { number } },
      }),
    );
  assert.notEqual(group("a".repeat(40)), group("b".repeat(40)));
  assert.notEqual(group("a".repeat(40), 121), group("b".repeat(40), 121));
  assert.equal(
    condition(ci.concurrency["cancel-in-progress"], {
      event_name: "workflow_dispatch",
    }),
    false,
  );
  assert.equal(
    condition(ci.concurrency["cancel-in-progress"], {
      event_name: "pull_request",
    }),
    true,
  );
  assert.equal(
    workflow("deploy").concurrency.queue,
    "max",
    "Old reruns must not replace a newer pending deployment",
  );
});
