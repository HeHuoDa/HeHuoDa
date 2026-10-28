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

test("API image smoke exercises the packaged, fail-closed attachment sandbox", () => {
  const smoke = readFileSync(new URL("../smoke.mjs", import.meta.url), "utf8");
  assert.match(smoke, /INGESTION_ENABLED:\s*"false"/);
  assert.match(smoke, /parseAttachmentIsolated/);
  for (const marker of [
    "isolated-Chinese-PDF-ok",
    "isolated-Chinese-DOCX-ok",
    "parse-timeout",
    "file=",
    "network=EPERM",
    "Landlock ABI 3",
  ])
    assert.ok(smoke.includes(marker), `image smoke must cover ${marker}`);

  const sectionStart = smoke.indexOf("// Run the real packaged parser");
  const sectionEnd = smoke.indexOf("const fixture =", sectionStart);
  assert.ok(sectionStart >= 0 && sectionEnd > sectionStart);
  const section = smoke.slice(sectionStart, sectionEnd);
  const templateStart = section.indexOf("`");
  const templateEnd = section.lastIndexOf("`");
  assert.ok(templateStart >= 0 && templateEnd > templateStart);
  const inlineScript = runInNewContext(
    section.slice(templateStart, templateEnd + 1),
  );
  const syntax = spawnSync(
    process.execPath,
    ["--check", "--input-type=module"],
    { encoding: "utf8", input: inlineScript },
  );
  assert.equal(syntax.status, 0, syntax.stderr);
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
  assert.equal(deploy["timeout-minutes"], 75);
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

test("rsync uploads share verified SSH and bounded retry and delivery windows", () => {
  const deploy = workflow("deploy").jobs.deploy;
  const steps = deploy.steps;
  const uploads = steps.filter((step) =>
    step.run?.startsWith("bash controller/deploy/scp.sh upload "),
  );
  assert.equal(uploads.length, 3);
  assert.deepEqual(
    uploads.map((step) => step.run),
    [
      "bash controller/deploy/scp.sh upload probe",
      "bash controller/deploy/scp.sh upload payload 1",
      "bash controller/deploy/scp.sh upload payload 2",
    ],
  );
  assert.deepEqual(
    uploads.map((step) => step["timeout-minutes"]),
    [2, 25, 15],
  );
  assert.equal(uploads[1]["continue-on-error"], true);
  assert.equal(uploads[2]["continue-on-error"], true);
  assert.match(uploads[2].if, /steps.received.outputs.valid == 'false'/);
  assert.doesNotMatch(
    JSON.stringify(deploy),
    /appleboy\/scp-action|SCP_FINGERPRINT|command_timeout/,
  );
  assert.equal(
    steps.find((step) => step.run?.endsWith("scp.sh deliver"))[
      "timeout-minutes"
    ],
    22,
  );
  const index = (suffix) =>
    steps.findIndex((step) => step.run?.endsWith("scp.sh " + suffix));
  assert.ok(index("setup") < steps.indexOf(uploads[0]));
  assert.ok(index("probe") > steps.indexOf(uploads[0]));
  assert.ok(index("probe") < steps.indexOf(uploads[1]));
  assert.ok(index("received") > steps.indexOf(uploads[1]));
  assert.ok(index("received") < steps.indexOf(uploads[2]));
  assert.ok(index("verify") > steps.indexOf(uploads[2]));
  assert.ok(index("deliver") > index("verify"));
  assert.match(steps[index("cleanup")].if, /always\(\)/);
  assert.equal(steps[index("cleanup")]["timeout-minutes"], 2);
  assert.doesNotMatch(
    JSON.stringify(deploy),
    /estimated_payload_seconds|insufficient-throughput|cat > \/dev\/null/,
  );
});

test("rsync failure and cancellation gates prevent delivery and still request staging cleanup", () => {
  const steps = workflow("deploy").jobs.deploy.steps;
  const retry = steps.find((step) => step.name?.includes("attempt 2"));
  const received = steps.find((step) => step.id === "received");
  const verify = steps.find((step) => step.run?.endsWith("scp.sh verify"));
  const deliver = steps.find((step) => step.run?.endsWith("scp.sh deliver"));
  const cleanup = steps.find((step) => step.run?.endsWith("scp.sh cleanup"));
  const allowed = (step, success, cancelled, outcome, valid) => {
    if (!/always\(|cancelled\(/.test(step.if) && !success) return false;
    return runInNewContext(step.if.replace(/^\$\{\{\s*|\s*\}\}$/g, ""), {
      always: () => true,
      cancelled: () => cancelled,
      steps: {
        verified: { outputs: { sha: "a".repeat(40) } },
        transport: { outcome: "success" },
        upload: { outcome },
        received: { outputs: { valid } },
      },
    });
  };
  assert.equal(allowed(received, false, false, "skipped", ""), false);
  assert.equal(allowed(received, true, false, "failure", ""), true);
  assert.equal(allowed(retry, true, false, "failure", "false"), true);
  assert.equal(allowed(retry, true, false, "failure", "true"), false);
  assert.equal(allowed(verify, true, false, "failure", "true"), true);
  for (const cancelled of [false, true]) {
    assert.equal(allowed(deliver, false, cancelled, "failure", "false"), false);
    assert.equal(allowed(cleanup, false, cancelled, "failure", "false"), true);
  }
  assert.equal(allowed(received, false, true, "failure", ""), false);
});

test("second rsync responses never bypass final verification or discard a complete reception", () => {
  const steps = workflow("deploy").jobs.deploy.steps;
  const retry = steps.find((step) => step.name?.includes("attempt 2"));
  const verify = steps.find((step) => step.run?.endsWith("scp.sh verify"));
  const deliver = steps.find((step) => step.run?.endsWith("scp.sh deliver"));
  const cleanup = steps.find((step) => step.run?.endsWith("scp.sh cleanup"));
  for (const upload of ["success", "failure"]) {
    for (const receipt of ["success", "failure"]) {
      let success = true;
      const executed = [];
      for (const [step, outcome] of [
        [retry, upload],
        [verify, receipt],
        [deliver, "success"],
        [cleanup, "success"],
      ]) {
        // GitHub adds success() when a condition has no status-check function.
        if (!/always\(|cancelled\(/.test(step.if) && !success) continue;
        const allowed = runInNewContext(
          step.if.replace(/^\$\{\{\s*|\s*\}\}$/g, ""),
          {
            steps: {
              verified: { outputs: { sha: "a".repeat(40) } },
              transport: { outcome: "success" },
              received: { outputs: { valid: "false" } },
            },
            always: () => true,
          },
        );
        if (!allowed) continue;
        executed.push(step);
        if (outcome === "failure" && !step["continue-on-error"])
          success = false;
      }
      const scenario = `upload=${upload} receipt=${receipt}`;
      assert.ok(executed.includes(verify), scenario);
      assert.equal(executed.includes(deliver), receipt === "success", scenario);
      assert.ok(executed.includes(cleanup), scenario);
      assert.equal(success, receipt === "success", scenario);
    }
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
    steps: {
      verified: { outputs: { sha, artifact } },
      upload: { outcome: "success" },
      received: { outputs: { valid: "false" } },
      transport: { outcome: "success" },
    },
    always: () => true,
    cancelled: () => false,
  });
  for (const step of deploy.steps.slice(
    deploy.steps.findIndex((step) => step.id === "verified") + 1,
  )) {
    assert.ok(
      step.if,
      "Checkout and SSH must be skipped without a verified SHA",
    );
    assert.equal(step.if.includes("outputs.sha"), true, step.name);
    assert.equal(
      runInNewContext(
        step.if.replace(/^\$\{\{\s*|\s*\}\}$/g, ""),
        outputs("", ""),
      ),
      false,
      step.name,
    );
    assert.equal(
      runInNewContext(
        step.if.replace(/^\$\{\{\s*|\s*\}\}$/g, ""),
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
