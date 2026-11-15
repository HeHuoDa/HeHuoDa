import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMPOSE_PROJECT_LABEL,
  PRODUCTION_PROJECT,
  STAGE2_TASK,
  belongsToProject,
  checkStage2Env,
  cleanupStage2,
  listTaskResources,
  parseEnv,
  readLabel,
  readTaskLabel,
} from "../stage2.mjs";

const valid = {
  COMPOSE_PROJECT_NAME: "hehuoda-stage2",
  IMAGE_PREFIX: "hehuoda-local",
  IMAGE_TAG: "b".repeat(40),
  POSTGRES_USER: "stage2",
  POSTGRES_DB: "hehuoda_stage2_test",
  POSTGRES_PASSWORD: "synthetic-password",
  DATABASE_URL:
    "postgresql://stage2:synthetic-password@db:5432/hehuoda_stage2_test",
  HTTP_BIND: "127.0.0.1",
  HTTP_PORT: "18080",
  INGESTION_ENABLED: "false",
  WECHAT_LOGIN_ENABLED: "false",
  CAMPUS_VERIFICATION_ENABLED: "false",
  CAMPUS_PROFILE_KEYS: "{}",
};

test("env parsing ignores comments and keeps values verbatim", () => {
  const env = parseEnv("# note\nA=1\n\nB=two=three\nC=\n");
  assert.deepEqual(env, { A: "1", B: "two=three", C: "" });
});

test("a compliant isolated test env passes", () => {
  const result = checkStage2Env(valid);
  assert.equal(result.ok, true, result.failures.join(";"));
  assert.deepEqual(result.failures, []);
});

test("production identity, public binding and enabled integrations are rejected", () => {
  const cases = [
    [{ COMPOSE_PROJECT_NAME: PRODUCTION_PROJECT }, /生产项目名/],
    [{ COMPOSE_PROJECT_NAME: "HeHuoDa-Stage2" }, /小写字母/],
    [{ HTTP_BIND: "0.0.0.0" }, /127\.0\.0\.1/],
    [{ HTTP_PORT: "80" }, /生产端口/],
    [{ HTTP_PORT: "443" }, /生产端口/],
    [{ INGESTION_ENABLED: "true" }, /INGESTION_ENABLED/],
    [{ WECHAT_LOGIN_ENABLED: "true" }, /WECHAT_LOGIN_ENABLED/],
    [{ CAMPUS_VERIFICATION_ENABLED: "true" }, /CAMPUS_VERIFICATION_ENABLED/],
    [{ WECHAT_APP_SECRET: "x" }, /WECHAT_APP_SECRET/],
    [{ CAMPUS_SUBJECT_HMAC_KEY: "x" }, /CAMPUS_SUBJECT_HMAC_KEY/],
    [{ CAMPUS_PROFILE_KEYS: '{"v1":"x"}' }, /CAMPUS_PROFILE_KEYS/],
    [{ POSTGRES_DB: "hehuoda" }, /生产库同名/],
    [
      {
        DATABASE_URL:
          "postgresql://stage2:p@localhost:5432/hehuoda_stage2_test",
      },
      /db:5432/,
    ],
    [
      { DATABASE_URL: "postgresql://other:p@db:5432/hehuoda_stage2_test" },
      /POSTGRES_USER/,
    ],
    [{ IMAGE_TAG: "abc" }, /40 位/],
  ];
  for (const [patch, pattern] of cases) {
    const result = checkStage2Env({ ...valid, ...patch });
    assert.equal(result.ok, false, JSON.stringify(patch));
    assert.match(result.failures.join("；"), pattern);
  }
});

test("missing required keys are all reported without values", () => {
  const result = checkStage2Env({ COMPOSE_PROJECT_NAME: "hehuoda-stage2" });
  assert.equal(result.ok, false);
  assert.ok(result.failures.length >= 8);
  assert.ok(
    result.failures.every((item) => !item.includes("synthetic-password")),
    "failures must never echo secret values",
  );
});

function fakeDocker(labels) {
  return (args) => {
    const key = args.join(" ");
    if (key.startsWith("ps -a")) return labels.containers.join("\n");
    if (key.startsWith("network ls")) return labels.networks.join("\n");
    if (key.startsWith("volume ls")) return labels.volumes.join("\n");
    if (key.startsWith("image ls")) return (labels.images ?? []).join("\n");
    if (args.includes("--format")) {
      const format = args[args.indexOf("--format") + 1];
      const id = args[args.length - 1];
      const owners = labels.owners ?? {};
      const tasks = labels.labels ?? {};
      if (format.includes(COMPOSE_PROJECT_LABEL)) return owners[id] ?? "";
      return tasks[id] ?? "";
    }
    return "";
  };
}

test("cleanup only removes resources carrying the task label", () => {
  const calls = [];
  const base = fakeDocker({
    containers: ["hehuoda-stage2-api-1", "foreign-container"],
    networks: ["hehuoda-stage2_default"],
    volumes: ["hehuoda-stage2_database", "foreign-volume"],
    images: [],
    labels: {
      "hehuoda-stage2-api-1": STAGE2_TASK,
      "foreign-container": "someone-else",
      "hehuoda-stage2_default": STAGE2_TASK,
      "hehuoda-stage2_database": STAGE2_TASK,
      "foreign-volume": "someone-else",
    },
    owners: {
      "hehuoda-stage2-api-1": "hehuoda-stage2",
      "foreign-container": "someone-else",
      "hehuoda-stage2_default": "hehuoda-stage2",
      "hehuoda-stage2_database": "hehuoda-stage2",
      "foreign-volume": "someone-else",
    },
  });
  const run = (args) => {
    calls.push(args.join(" "));
    return base(args);
  };
  const result = cleanupStage2("hehuoda-stage2", { docker: run });
  assert.deepEqual(result.removed.containers, ["hehuoda-stage2-api-1"]);
  assert.deepEqual(result.removed.networks, ["hehuoda-stage2_default"]);
  // 默认不删数据卷，也不去读取/删除未要求清理的卷。
  assert.deepEqual(result.removed.volumes, []);
  assert.deepEqual(result.retainedVolumes, [
    "hehuoda-stage2_database",
    "foreign-volume",
  ]);
  assert.deepEqual(result.refused, ["container:foreign-container"]);
  assert.ok(!calls.some((call) => call.startsWith("rm -f foreign-container")));
  assert.ok(
    !calls.some((call) => call.includes("prune")),
    "never prune globally",
  );
});

test("cleanup refuses a resource whose label cannot be read", () => {
  const run = (args) => {
    if (args[0] === "ps") return "hehuoda-stage2-api-1";
    if (args[0] === "network") return "";
    if (args[0] === "volume") return "";
    if (args[0] === "image") return "";
    // 标签读取失败（空字符串）时必须拒绝删除。
    return "";
  };
  const result = cleanupStage2("hehuoda-stage2", { docker: run });
  assert.deepEqual(result.removed.containers, []);
  assert.deepEqual(result.refused, ["container:hehuoda-stage2-api-1"]);
});

test("cleanup with --volumes still refuses a foreign volume", () => {
  const base = fakeDocker({
    containers: [],
    networks: [],
    volumes: ["hehuoda-stage2_database", "foreign-volume"],
    images: [],
    labels: {
      "hehuoda-stage2_database": STAGE2_TASK,
      "foreign-volume": "someone-else",
    },
    owners: {
      "hehuoda-stage2_database": "hehuoda-stage2",
      "foreign-volume": "someone-else",
    },
  });
  const calls = [];
  const run = (args) => {
    calls.push(args.join(" "));
    return base(args);
  };
  const result = cleanupStage2("hehuoda-stage2", {
    docker: run,
    volumes: true,
  });
  assert.deepEqual(result.removed.volumes, ["hehuoda-stage2_database"]);
  assert.deepEqual(result.refused, ["volume:foreign-volume"]);
  assert.deepEqual(result.retainedVolumes, []);
  assert.ok(!calls.some((call) => call.startsWith("volume rm foreign-volume")));
});

// 关键回归：同一主机上两个测试项目共用同一任务标签时，清理 A 必须保留 B。
// 只按任务标签过滤会跨项目删除，这是曾经的缺陷。
test("cleanup keeps resources of another project sharing the same task label", () => {
  const calls = [];
  const base = fakeDocker({
    containers: ["project-a-api-1", "project-b-api-1"],
    networks: ["project-a_default", "project-b_default"],
    volumes: ["project-a_database", "project-b_database"],
    images: [],
    labels: {
      "project-a-api-1": STAGE2_TASK,
      "project-b-api-1": STAGE2_TASK,
      "project-a_default": STAGE2_TASK,
      "project-b_default": STAGE2_TASK,
      "project-a_database": STAGE2_TASK,
      "project-b_database": STAGE2_TASK,
    },
    owners: {
      "project-a-api-1": "project-a",
      "project-b-api-1": "project-b",
      "project-a_default": "project-a",
      "project-b_default": "project-b",
      "project-a_database": "project-a",
      "project-b_database": "project-b",
    },
  });
  const run = (args) => {
    calls.push(args.join(" "));
    return base(args);
  };
  const result = cleanupStage2("project-a", { docker: run, volumes: true });
  assert.deepEqual(result.removed.containers, ["project-a-api-1"]);
  assert.deepEqual(result.removed.networks, ["project-a_default"]);
  assert.deepEqual(result.removed.volumes, ["project-a_database"]);
  assert.deepEqual(result.refused, [
    "container:project-b-api-1",
    "network:project-b_default",
    "volume:project-b_database",
  ]);
  assert.ok(
    !calls.some((call) => call.includes("project-b") && call.includes(" rm")),
  );
  assert.ok(
    !calls.some((call) =>
      /rm -f project-b-api-1|network rm project-b_default|volume rm project-b_database/.test(
        call,
      ),
    ),
  );
});

test("cleanup refuses production project and missing project name", () => {
  assert.throws(
    () => cleanupStage2(PRODUCTION_PROJECT, { docker: () => "" }),
    /生产项目/,
  );
  assert.throws(() => cleanupStage2("", { docker: () => "" }), /项目名/);
  assert.throws(() => listTaskResources("", () => ""), /项目名/);
});

test("resource listing carries the project name for the report", () => {
  const run = () => "";
  assert.deepEqual(listTaskResources("hehuoda-stage2", run), {
    project: "hehuoda-stage2",
    containers: [],
    networks: [],
    volumes: [],
    images: [],
  });
  assert.equal(
    readTaskLabel("x", "container", () => "  issue206-stage2  "),
    STAGE2_TASK,
  );
});

// 双标签判定本身：任务标签正确但项目不同，必须不算本任务资源。
test("belongsToProject requires both the task label and the project label", () => {
  const labels = {
    "ctr-ok": { task: STAGE2_TASK, project: "hehuoda-stage2" },
    "ctr-other": { task: STAGE2_TASK, project: "hehuoda-stage2-b" },
    "ctr-notask": { task: "other-task", project: "hehuoda-stage2" },
    "ctr-empty": { task: "", project: "" },
  };
  const run = (args) => {
    const format = args[args.indexOf("--format") + 1];
    const id = args[args.length - 1];
    const entry = labels[id];
    if (!entry) return "";
    return format.includes(COMPOSE_PROJECT_LABEL) ? entry.project : entry.task;
  };
  assert.equal(
    belongsToProject("ctr-ok", "container", "hehuoda-stage2", run),
    true,
  );
  assert.equal(
    belongsToProject("ctr-other", "container", "hehuoda-stage2", run),
    false,
  );
  assert.equal(
    belongsToProject("ctr-notask", "container", "hehuoda-stage2", run),
    false,
  );
  assert.equal(
    belongsToProject("ctr-empty", "container", "hehuoda-stage2", run),
    false,
  );
  // 标签读取抛错（资源已被删除等）时视为不属于本任务，不删。
  assert.equal(
    belongsToProject("missing", "container", "hehuoda-stage2", () => {
      throw new Error("no such object");
    }),
    false,
  );
  assert.equal(
    readLabel("ctr-ok", "container", COMPOSE_PROJECT_LABEL, run),
    "hehuoda-stage2",
  );
});
