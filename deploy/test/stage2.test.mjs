import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PRODUCTION_PROJECT,
  STAGE2_TASK,
  checkStage2Env,
  cleanupStage2,
  listTaskResources,
  parseEnv,
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
    if (key.startsWith("inspect --format") || key.startsWith("volume inspect"))
      return labels.labels[args[args.length - 1]] ?? "";
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
