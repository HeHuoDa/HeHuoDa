import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, existsSync, rmSync } from "node:fs";
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
  return runInNewContext(expression.replace(/^\$\{\{\s*|\s*\}\}$/g, ""), {
    github,
    vars,
  });
}

test("main manual CI publishes the same verified images and requires publishing at the gate", () => {
  const ci = workflow("ci");
  for (const event_name of ["push", "workflow_dispatch"]) {
    const github = { event_name, ref: "refs/heads/main" };
    assert.equal(
      condition(ci.jobs["publish-images"].if, github),
      true,
      event_name,
    );
    for (const step of ci.jobs["image-smoke"].steps.filter((step) => step.if)) {
      assert.equal(condition(step.if, github), true, step.name || step.uses);
    }
    const gate = ci.jobs["ci-gate"].steps.find(
      (step) => step.env?.PUBLISH_REQUIRED,
    );
    assert.equal(condition(gate.env.PUBLISH_REQUIRED, github), true);
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
  for (const [event, published, expected] of [
    ["push", "1", 0],
    ["workflow_dispatch", "1", 0],
    ["workflow_dispatch", "0", 1],
    ["pull_request", "1", 1],
  ]) {
    const output = join(directory, `${event}-${published}`).replaceAll(
      "\\",
      "/",
    );
    const result = runBash(
      `
      gh() {
        case "$*" in
          *"head_sha=$CANDIDATE_SHA&branch=main&event=$RUN_EVENT&status=success"*) echo 17 ;;
          *"/runs/17/jobs?per_page=100"*) printf '%s\\n' "$PUBLISH_COUNT" ;;
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
        PUBLISH_COUNT: published,
        GITHUB_OUTPUT: output,
      },
    );
    assert.equal(
      result.status,
      expected,
      `${event}/${published}: ${result.stderr}`,
    );
    if (expected === 0)
      assert.equal(readFileSync(output, "utf8"), `sha=${"a".repeat(40)}\n`);
    else assert.equal(existsSync(output), false);
  }
});

test("PR and non-main manual CI cannot publish images or start automatic deployment", () => {
  const ci = workflow("ci");
  const deploy = workflow("deploy");
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
