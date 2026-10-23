import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  existsSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { parse } from "yaml";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";

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

test("main manual CI publishes the same verified images and requires publishing at the gate", () => {
  const ci = workflow("ci");
  assert.deepEqual(ci.on.push.branches, ["main"]);
  assert.ok(Object.hasOwn(ci.on, "workflow_dispatch"));
  for (const event_name of ["push", "workflow_dispatch"]) {
    const github = { event_name, ref: "refs/heads/main" };
    assert.equal(
      condition(ci.jobs["publish-images"].if, github),
      true,
      event_name,
    );
    for (const step of ci.jobs["image-smoke"].steps.filter(
      (step) => step.if && step.if !== "failure()",
    )) {
      assert.equal(condition(step.if, github), true, step.name || step.uses);
    }
    const gate = ci.jobs["ci-gate"].steps.find(
      (step) => step.env?.PUBLISH_REQUIRED,
    );
    assert.equal(condition(gate.env.PUBLISH_REQUIRED, github), true);
  }
});

test("CI reruns keep separate verified image artifacts and publisher consumes the successful producer's artifact ID", () => {
  const ci = workflow("ci");
  const smoke = ci.jobs["image-smoke"];
  const upload = smoke.steps.find(
    (step) =>
      step.uses?.startsWith("actions/upload-artifact") &&
      step.with.name.startsWith("verified-images-"),
  );
  assert.ok(upload.with.name.includes("github.run_attempt"));
  assert.ok(upload.id);
  assert.equal(
    smoke.outputs["images-artifact-id"],
    `\u0024{{ steps.${upload.id}.outputs.artifact-id }}`,
  );
  const download = ci.jobs["publish-images"].steps.find((step) =>
    step.uses?.startsWith("actions/download-artifact"),
  );
  assert.equal(
    download.with["artifact-ids"],
    "${{ needs.image-smoke.outputs.images-artifact-id }}",
  );
  assert.equal(download.with["merge-multiple"], true);
  assert.equal(download.with.name, undefined);
  const guard = ci.jobs["publish-images"].steps.find(
    (step) => step.env?.VERIFIED_ARTIFACT_ID,
  );
  for (const [value, expected] of [
    ["123", 0],
    ["", 1],
    ["all", 1],
  ]) {
    assert.equal(
      runBash(guard.run, { VERIFIED_ARTIFACT_ID: value }).status,
      expected,
    );
  }
});

function runBash(input, env = {}) {
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
  return spawnSync(bash, ["--noprofile", "--norc", "-s"], {
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, ...env },
    input,
  });
}

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

test("deployment requires successful image publishing for the exact main SHA", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "hehuoda-ci-proof-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const script = workflow("deploy").jobs.deploy.steps.find(
    (step) => step.id === "verified",
  ).run;
  for (const [event, published, expected, manifest = true] of [
    ["push", "1", 0],
    ["workflow_dispatch", "1", 0],
    ["workflow_dispatch", "0", 1],
    ["pull_request", "1", 1],
    ["workflow_dispatch", "1", 1, false],
    ["workflow_dispatch", "1", 1, "wrong-attempt"],
  ]) {
    const output = join(
      directory,
      `${event}-${published}-${manifest}`,
    ).replaceAll("\\", "/");
    const result = runBash(
      `
      gh() {
        case "$*" in
          *"head_sha=$CANDIDATE_SHA&branch=main&event=$RUN_EVENT&status=success"*) echo 17 ;;
          *"/runs/17/attempts/1/jobs?per_page=100"*) printf '%s\\n' "$PUBLISH_COUNT" ;;
          *"/runs/17/attempts/2/jobs?per_page=100"*) echo 0 ;;
          *"/runs/17/artifacts?per_page=100"*) printf '%s\\n' "$MANIFEST_ARTIFACT" ;;
          *"/workflows/ci.yml/runs?"*) return 0 ;;
          *) echo "Unexpected API call" >&2; return 1 ;;
        esac
      }
      ${script}
    `,
      {
        GH_REPO: "HeHuoDa/HeHuoDa",
        CANDIDATE_SHA: "a".repeat(40),
        RUN_EVENT: event,
        RELEASE_EVENT: "workflow_dispatch",
        PUBLISH_COUNT: published,
        MANIFEST_ARTIFACT:
          manifest === "wrong-attempt"
            ? `release-images-${"a".repeat(40)}-2`
            : manifest
              ? `release-images-${"a".repeat(40)}-1`
              : "unrelated-artifact",
        GITHUB_OUTPUT: output,
      },
    );
    assert.equal(
      result.status,
      expected,
      `${event}/${published}: ${result.stderr}`,
    );
    if (expected === 0)
      assert.equal(
        readFileSync(output, "utf8"),
        `sha=${"a".repeat(40)}\nrun_id=17\nartifact=release-images-${"a".repeat(40)}-1\n`,
      );
    else assert.equal(existsSync(output), false);
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
          *"/runs/17/artifacts?"*) printf 'release-images-%s-1\\n' "$CANDIDATE_SHA" ;;
          *) return 1 ;;
        esac
      }
      ${script}
    `,
      {
        GH_REPO: "HeHuoDa/HeHuoDa",
        CANDIDATE_SHA: "a".repeat(40),
        CURRENT_MAIN: current.repeat(40),
        RELEASE_EVENT: event,
        GITHUB_OUTPUT: output,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(output), allowed, `${event}/${current}`);
  }
  for (const step of deploy.steps.slice(
    deploy.steps.findIndex((step) => step.id === "verified") + 1,
  )) {
    assert.ok(
      step.if,
      "Checkout and SSH must be skipped without a verified SHA",
    );
    assert.equal(
      runInNewContext(step.if, {
        steps: { verified: { outputs: { sha: "" } } },
      }),
      false,
    );
    assert.equal(
      runInNewContext(step.if, {
        steps: { verified: { outputs: { sha: "a".repeat(40) } } },
      }),
      true,
    );
  }
});

test("PR and non-main manual CI cannot publish images or start automatic deployment", () => {
  const ci = workflow("ci");
  const deploy = workflow("deploy");
  assert.deepEqual(deploy.on.workflow_run, {
    workflows: ["CI"],
    types: ["completed"],
    branches: ["main"],
  });
  assert.deepEqual(deploy.on.workflow_run.workflows, [ci.name]);
  assert.deepEqual(workflow("auto-merge").on.workflow_run.workflows, [ci.name]);
  for (const [ref, allowed] of [
    ["refs/heads/main", true],
    ["refs/heads/fix/example", false],
  ]) {
    assert.equal(
      condition(
        deploy.jobs.deploy.if,
        { event_name: "workflow_dispatch", ref, event: {} },
        { DEPLOY_ENABLED: "true" },
      ),
      allowed,
    );
  }
  for (const [event_name, ref] of [
    ["pull_request", "refs/heads/main"],
    ["workflow_dispatch", "refs/heads/fix/example"],
  ]) {
    assert.equal(
      condition(ci.jobs["publish-images"].if, { event_name, ref }),
      false,
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
      condition(deploy.jobs.deploy.if, github, { DEPLOY_ENABLED: "true" }),
      event !== "pull_request",
      event,
    );
    assert.equal(condition(deploy.jobs.deploy.if, github, {}), false);
  }
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

test("published SHA images are preserved, and partial retries cannot overwrite a different image", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "hehuoda-image-publish-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const script = workflow("ci").jobs["publish-images"].steps.find(
    (step) => step.env?.REGISTRY_TOKEN,
  ).run;
  for (const [api, web, same, expectedStatus, pushes, digestMatches = true] of [
    ["0", "0", "true", 0, 2],
    ["1", "1", "true", 0, 0],
    ["1", "1", "false", 1, 0],
    ["1", "0", "true", 0, 1],
    ["0", "1", "true", 0, 1],
    ["1", "0", "false", 1, 0],
    ["error", "0", "true", 1, 0],
    ["401", "0", "true", 1, 0],
    ["403", "0", "true", 1, 0],
    ["500", "0", "true", 1, 0],
    ["0", "0", "true", 1, 2, false],
  ]) {
    const attempt = mkdtempSync(join(directory, "attempt-"));
    const result = runBash(
      `
      gzip() { echo archive; }
      jq() { cat >/dev/null; echo fixture-registry-token; }
      curl() {
        cat >/dev/null
        if [[ "$*" == *https://ghcr.io/token* ]]; then echo '{"token":"fixture"}'; return 0; fi
        local exists="$EXISTING_WEB"
        [[ "$*" == */api/manifests/* ]] && exists="$EXISTING_API"
        case "$exists" in
          1) printf 200 ;;
          0) printf 404 ;;
          error) echo 'connection timed out' >&2; return 1 ;;
          *) printf '%s' "$exists" ;;
        esac
      }
      remote_loaded=false
      docker() {
        case "$1 $2" in
          'image load'|'login ghcr.io') cat >/dev/null ;;
          'logout ghcr.io') return 0 ;;
          'image inspect')
            if [[ "$*" == *@sha256:* && "$MATCHING_DIGEST" == false ]]; then echo moved; return 0; fi
            if [[ "$*" == *RepoDigests* ]]; then
              if [[ "$*" == */api:* ]]; then component=api; else component=web; fi
              printf '%s/%s@sha256:%064d\\n' "$IMAGE_PREFIX" "$component" 1
              return 0
            fi
            if [[ "$remote_loaded" == true && "$MATCHING_IMAGE" == false ]]; then echo different; else echo candidate; fi ;;
          pull*) remote_loaded=true ;;
          push*) echo "PUSH:$*" ;;
          *) echo "Unexpected Docker operation: $*" >&2; return 1 ;;
        esac
      }
      ${script}
    `,
      {
        EXISTING_API: api,
        EXISTING_WEB: web,
        MATCHING_IMAGE: same,
        MATCHING_DIGEST: String(digestMatches),
        IMAGE_TAG: "a".repeat(40),
        GITHUB_REPOSITORY: "HeHuoDa/HeHuoDa",
        RUNNER_TEMP: attempt.replaceAll("\\", "/"),
        REGISTRY_TOKEN: "test-only",
        REGISTRY_USER: "test-only",
      },
    );
    assert.equal(
      result.status,
      expectedStatus,
      `${api}/${web}/${same}: ${result.stderr}`,
    );
    assert.equal((result.stdout.match(/^PUSH:/gm) || []).length, pushes);
    if (expectedStatus === 0) {
      const manifest = JSON.parse(
        readFileSync(join(attempt, "release-manifest", "release.json"), "utf8"),
      );
      assert.equal(manifest.sha, "a".repeat(40));
      assert.equal(
        manifest.images.api,
        `ghcr.io/hehuoda/hehuoda/api@sha256:${"0".repeat(63)}1`,
      );
      assert.equal(
        manifest.images.web,
        `ghcr.io/hehuoda/hehuoda/web@sha256:${"0".repeat(63)}1`,
      );
    } else
      assert.equal(
        existsSync(join(attempt, "release-manifest", "release.json")),
        false,
      );
  }
});

test("TCR publishing preserves verified image identity and refuses uncertain or conflicting releases", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "hehuoda-tcr-publish-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const step = workflow("ci").jobs["publish-images"].steps.find(
    (step) => step.env?.TCR_IMAGE_PREFIX,
  );
  const sha = "a".repeat(40);
  const source = {
    sha,
    images: {
      api: `ghcr.io/hehuoda/hehuoda/api@sha256:${"1".repeat(64)}`,
      web: `ghcr.io/hehuoda/hehuoda/web@sha256:${"2".repeat(64)}`,
    },
  };
  for (const [api, web, same, expected, pushes, digestMatches = true] of [
    ["missing", "missing", "true", 0, 2],
    ["present", "present", "true", 0, 0],
    ["present", "missing", "true", 0, 1],
    ["missing", "present", "false", 1, 0],
    ["denied", "missing", "true", 1, 0],
    ["timeout", "missing", "true", 1, 0],
    ["missing", "missing", "true", 1, 2, false],
  ]) {
    const attempt = mkdtempSync(join(directory, "attempt-"));
    mkdirSync(join(attempt, "release-manifest"));
    const file = join(attempt, "release-manifest", "release.json");
    writeFileSync(file, JSON.stringify(source));
    const result = runBash(
      `
      jq() { printf 'ghcr.io/hehuoda/hehuoda/%s@sha256:%064d\\n' "$3" 1; }
      docker() {
        case "$1 $2" in
          'login ccr.ccs.tencentyun.com') cat >/dev/null ;;
          'logout ccr.ccs.tencentyun.com') return 0 ;;
          'manifest inspect')
            local state="$WEB_STATE"
            [[ "$3" == */api:* ]] && state="$API_STATE"
            case "$state" in
              present) return 0 ;;
              missing) echo 'manifest unknown' >&2; return 1 ;;
              denied) echo 'unauthorized' >&2; return 1 ;;
              *) echo 'connection timed out' >&2; return 1 ;;
            esac ;;
          'image inspect')
            if [[ "$*" == *RepoDigests* ]]; then
              local component=web
              [[ "$*" == */api:* ]] && component=api
              printf '%s/%s@sha256:%064d\\n' "$TCR_IMAGE_PREFIX" "$component" 1
            elif [[ "$*" == *ccr.ccs.tencentyun.com* && "$MATCHING_IMAGE" == false ]] ||
                 [[ "$*" == *ccr.ccs.tencentyun.com*'@sha256:'* && "$MATCHING_DIGEST" == false ]]; then echo different
            else echo candidate; fi ;;
          pull*|tag*) return 0 ;;
          push*) echo "PUSH:$*" ;;
          *) echo "Unexpected operation: $*" >&2; return 1 ;;
        esac
      }
      ${step.run}
      `,
      {
        IMAGE_TAG: sha,
        TCR_IMAGE_PREFIX: "ccr.ccs.tencentyun.com/hehuoda",
        TCR_USERNAME: "test-user",
        TCR_PASSWORD: "test-only",
        RUNNER_TEMP: attempt.replaceAll("\\", "/"),
        API_STATE: api,
        WEB_STATE: web,
        MATCHING_IMAGE: same,
        MATCHING_DIGEST: String(digestMatches),
      },
    );
    assert.equal(
      result.status,
      expected,
      `${api}/${web}/${same}: ${result.stderr}`,
    );
    assert.equal((result.stdout.match(/^PUSH:/gm) || []).length, pushes);
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    if (expected === 0) {
      assert.equal(manifest.sha, sha);
      for (const component of ["api", "web"])
        assert.equal(
          manifest.images[component],
          `ccr.ccs.tencentyun.com/hehuoda/${component}@sha256:${"0".repeat(63)}1`,
        );
    } else assert.deepEqual(manifest, source);
  }
  for (const [prefix, user, password, expected] of [
    ["", "", "", 0],
    ["", "user", "secret", 1],
    ["evil.example/ns", "user", "secret", 1],
    ["ccr.ccs.tencentyun.com/hehuoda", "", "", 1],
  ]) {
    const result = runBash(step.run, {
      TCR_IMAGE_PREFIX: prefix,
      TCR_USERNAME: user,
      TCR_PASSWORD: password,
    });
    assert.equal(result.status, expected, result.stderr);
  }
});

test("deployment accepts only configured TCR namespaces and retains the original GHCR rollback path", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "hehuoda-tcr-deploy-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const step = workflow("deploy").jobs.deploy.steps.find(
    (step) => step.env?.MANIFEST_DIR,
  );
  const script = step.run.match(/node --input-type=module -e '([\s\S]*?)'/)[1];
  const sha = "a".repeat(40);
  for (const [prefix, configured, expected] of [
    ["ghcr.io/hehuoda/hehuoda", "", 0],
    ["ghcr.io/hehuoda/hehuoda", "ccr.ccs.tencentyun.com/hehuoda", 0],
    ["ccr.ccs.tencentyun.com/hehuoda", "ccr.ccs.tencentyun.com/hehuoda", 0],
    [
      "hehuoda.tencentcloudcr.com/production",
      "hehuoda.tencentcloudcr.com/production",
      0,
    ],
    ["ccr.ccs.tencentyun.com/hehuoda", "", 1],
    ["ccr.ccs.tencentyun.com/other", "ccr.ccs.tencentyun.com/hehuoda", 1],
    ["ghcr.io/other/repo", "ccr.ccs.tencentyun.com/hehuoda", 1],
  ]) {
    writeFileSync(
      join(directory, "release.json"),
      JSON.stringify({
        sha,
        images: {
          api: `${prefix}/api@sha256:${"1".repeat(64)}`,
          web: `${prefix}/web@sha256:${"2".repeat(64)}`,
        },
      }),
    );
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        encoding: "utf8",
        cwd: resolve(import.meta.dirname, "../.."),
        env: {
          ...process.env,
          MANIFEST_DIR: directory,
          CANDIDATE_SHA: sha,
          GH_REPO: "HeHuoDa/HeHuoDa",
          TCR_IMAGE_PREFIX: configured,
        },
      },
    );
    assert.equal(result.status, expected, `${prefix}: ${result.stderr}`);
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
