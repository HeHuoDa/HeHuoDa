// Issue #206 阶段二：云端隔离测试环境的启动、验证、停止与精确清理。
//
// 设计约束：
//   - 只操作本任务创建的资源：所有资源带 hehuoda.task=issue206-stage2 标签，
//     且 Compose 项目名必须是独立测试项目名；
//   - 不执行全局 prune，不删除任何未纳管卷或目录；
//   - 读不到标签、标签不符或项目名疑似生产时立即中止，不做「可能正确」的删除；
//   - 只打印资源名称与计数，不打印环境变量值。
//
// 在服务器上以受控目录为工作目录执行，例如：
//   cd /opt/hehuoda-test && node deploy/stage2.mjs preflight
//   cd /opt/hehuoda-test && node deploy/stage2.mjs up
//   cd /opt/hehuoda-test && node deploy/stage2.mjs verify
//   cd /opt/hehuoda-test && node deploy/stage2.mjs down
//   cd /opt/hehuoda-test && node deploy/stage2.mjs cleanup

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const STAGE2_TASK = "issue206-stage2";
export const STAGE_TASK_LABEL = "hehuoda.task";
export const COMPOSE_PROJECT_LABEL = "com.docker.compose.project";
export const PRODUCTION_PROJECT = "hehuoda-deploy";

export function docker(args, options = {}) {
  const result = spawnSync(process.env.DOCKER_BIN || "docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 300_000,
    ...options,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `docker ${args[0]} failed (exit ${result.status ?? "error"}); see local diagnostics`,
    );
  return (result.stdout ?? "").trim();
}

/** 解析 .env 为键值映射；只用于校验，不写日志。 */
export function parseEnv(text) {
  const values = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    values[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }
  return values;
}

const REQUIRED_KEYS = [
  "COMPOSE_PROJECT_NAME",
  "IMAGE_PREFIX",
  "IMAGE_TAG",
  "POSTGRES_USER",
  "POSTGRES_DB",
  "POSTGRES_PASSWORD",
  "DATABASE_URL",
  "HTTP_BIND",
  "HTTP_PORT",
];

/**
 * 校验测试环境配置与生产隔离。返回 { ok, failures, warnings }；
 * 失败信息只说变量名与原因，不回显值。
 */
export function checkStage2Env(env) {
  const failures = [];
  const warnings = [];
  for (const key of REQUIRED_KEYS)
    if (!env[key]) failures.push(`缺少必要变量 ${key}`);

  const project = env.COMPOSE_PROJECT_NAME ?? "";
  if (!project) failures.push("缺少 COMPOSE_PROJECT_NAME");
  else if (project === PRODUCTION_PROJECT)
    failures.push("COMPOSE_PROJECT_NAME 不能复用生产项目名");
  else if (!/^[a-z0-9][a-z0-9_-]*$/.test(project))
    failures.push("COMPOSE_PROJECT_NAME 只允许小写字母、数字、下划线与连字符");

  const tag = env.IMAGE_TAG ?? "";
  if (tag && !/^[a-f0-9]{40}$/.test(tag))
    failures.push("IMAGE_TAG 必须是完整 40 位小写提交 SHA");

  if ((env.HTTP_BIND ?? "") !== "127.0.0.1")
    failures.push("HTTP_BIND 必须为 127.0.0.1，测试入口不得绑定公网地址");
  if ((env.HTTP_PORT ?? "") === "80" || (env.HTTP_PORT ?? "") === "443")
    failures.push("HTTP_PORT 不能占用生产端口 80/443");

  if ((env.INGESTION_ENABLED ?? "false") !== "false")
    failures.push("INGESTION_ENABLED 必须为 false（本阶段不做长期后台采集）");
  if ((env.WECHAT_LOGIN_ENABLED ?? "false") !== "false")
    failures.push("WECHAT_LOGIN_ENABLED 必须为 false");
  if ((env.CAMPUS_VERIFICATION_ENABLED ?? "false") !== "false")
    failures.push("CAMPUS_VERIFICATION_ENABLED 必须为 false");
  if (env.WECHAT_APP_SECRET)
    failures.push("测试环境不得填写 WECHAT_APP_SECRET");
  if (env.CAMPUS_SUBJECT_HMAC_KEY)
    failures.push("测试环境不得填写 CAMPUS_SUBJECT_HMAC_KEY");
  if (env.CAMPUS_PROFILE_KEYS && env.CAMPUS_PROFILE_KEYS !== "{}")
    failures.push("测试环境不得填写 CAMPUS_PROFILE_KEYS");
  if (
    env.ADMIN_ALLOWED_ORIGINS &&
    !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(env.ADMIN_ALLOWED_ORIGINS)
  )
    warnings.push("ADMIN_ALLOWED_ORIGINS 不是精确 HTTPS Origin");

  if (!(env.POSTGRES_DB ?? "").endsWith("_test"))
    warnings.push("POSTGRES_DB 建议以 _test 结尾，便于区分生产库");
  if ((env.POSTGRES_DB ?? "") === "hehuoda")
    failures.push("POSTGRES_DB 不能与生产库同名");

  const url = env.DATABASE_URL;
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== "db" || parsed.port !== "5432")
        failures.push("DATABASE_URL 必须指向 db:5432");
      if (
        env.POSTGRES_USER &&
        decodeURIComponent(parsed.username) !== env.POSTGRES_USER
      )
        failures.push("DATABASE_URL 用户名与 POSTGRES_USER 不一致");
      if (
        env.POSTGRES_DB &&
        decodeURIComponent(parsed.pathname.slice(1)) !== env.POSTGRES_DB
      )
        failures.push("DATABASE_URL 库名与 POSTGRES_DB 不一致");
      if (
        env.POSTGRES_PASSWORD &&
        decodeURIComponent(parsed.password) !== env.POSTGRES_PASSWORD
      )
        failures.push("DATABASE_URL 密码与 POSTGRES_PASSWORD 不一致");
    } catch {
      failures.push("DATABASE_URL 不是合法 URL");
    }
  }
  return { ok: failures.length === 0, failures, warnings };
}

/** 读取资源标签；读不到就视为不可清理。 */
export function readTaskLabel(id, kind, run = docker) {
  return readLabel(id, kind, STAGE_TASK_LABEL, run);
}

/** 读取任意标签；用于同时核对 Compose 项目归属。 */
export function readLabel(id, kind, label, run = docker) {
  // 容器与镜像的标签都在 .Config.Labels（镜像 inspect 没有顶层 .Labels，
  // 用错层级会渲染失败并 exit 1）；网络与卷在顶层 .Labels。
  const root =
    kind === "network" || kind === "volume" ? ".Labels" : ".Config.Labels";
  const format = `{{ index ${root} "${label}" }}`;
  const subcommand =
    kind === "volume"
      ? ["volume", "inspect"]
      : kind === "network"
        ? ["network", "inspect"]
        : kind === "image"
          ? ["image", "inspect"]
          : ["inspect"];
  return run([...subcommand, "--format", format, id]).trim();
}

/**
 * 列出属于某个 Compose 项目的本任务资源。
 * 任务标签单独使用不足以界定范围：同一主机上多个测试项目可以共用同一任务标签，
 * 只按任务标签过滤会跨项目清理。因此两个标签必须同时匹配。
 */
export function listTaskResources(project, run = docker) {
  if (!project) throw new Error("缺少 Compose 项目名，拒绝列出或清理资源");
  const filters = [
    "--filter",
    `label=${STAGE_TASK_LABEL}=${STAGE2_TASK}`,
    "--filter",
    `label=${COMPOSE_PROJECT_LABEL}=${project}`,
  ];
  const list = (command, format) =>
    run([...command, ...filters, "--format", format])
      .split("\n")
      .filter(Boolean);
  return {
    project,
    containers: list(["ps", "-a"], "{{.Names}}"),
    networks: list(["network", "ls"], "{{.Name}}"),
    volumes: list(["volume", "ls"], "{{.Name}}"),
    images: list(["image", "ls"], "{{.Repository}}:{{.Tag}}"),
  };
}

/** 资源是否同时带有本任务标签与目标 Compose 项目标签。 */
export function belongsToProject(id, kind, project, run = docker) {
  let task;
  let owner;
  try {
    task = readLabel(id, kind, STAGE_TASK_LABEL, run);
    owner = readLabel(id, kind, COMPOSE_PROJECT_LABEL, run);
  } catch {
    return false;
  }
  return task === STAGE2_TASK && owner === project;
}

/**
 * 精确清理：资源必须同时带有本任务标签与目标 Compose 项目标签，逐个复核后再删除。
 * 任何一项不符即列入 refused 并保留，不做「尽力删除」。默认不删除数据卷。
 */
export function cleanupStage2(project, options = {}) {
  if (!project) throw new Error("缺少 Compose 项目名，拒绝清理");
  if (project === PRODUCTION_PROJECT) throw new Error("拒绝清理生产项目资源");
  const run = options.docker || docker;
  const resources = listTaskResources(project, run);
  const removed = { containers: [], networks: [], volumes: [], images: [] };
  const refused = [];
  const failed = [];

  const remove = (kind, name, args) => {
    if (!belongsToProject(name, kind, project, run)) {
      refused.push(`${kind}:${name}`);
      return false;
    }
    try {
      run(args);
    } catch (error) {
      // 删除失败必须如实报出：已删除的体积计与真实残留都会误导清理结论。
      failed.push(`${kind}:${name}:${error.message}`);
      return false;
    }
    return true;
  };

  for (const name of resources.containers)
    if (remove("container", name, ["rm", "-f", name]))
      removed.containers.push(name);
  for (const name of resources.networks)
    if (remove("network", name, ["network", "rm", name]))
      removed.networks.push(name);
  for (const name of resources.images)
    if (remove("image", name, ["image", "rm", name])) removed.images.push(name);
  if (options.volumes) {
    for (const name of resources.volumes)
      if (remove("volume", name, ["volume", "rm", name]))
        removed.volumes.push(name);
  }
  return {
    removed,
    refused,
    failed,
    retainedVolumes: options.volumes ? [] : resources.volumes,
  };
}

function envPath() {
  const explicit = process.env.STAGE2_ENV_FILE;
  const candidates = [
    explicit,
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "hehuoda-test/.env"),
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("找不到测试 .env；用 STAGE2_ENV_FILE 指定路径");
  return found;
}

/**
 * 读取并强制校验测试 .env。每个会变更 Docker 状态的命令都必须先过这一步：
 * 不能依赖操作者记得先跑 preflight，也不能假设检查后 .env 未被修改。
 */
function loadGuardedEnv(envFile) {
  const env = parseEnv(readFileSync(envFile, "utf8"));
  const check = checkStage2Env(env);
  if (!check.ok)
    throw new Error("测试配置不合规：" + check.failures.join("；"));
  if (env.COMPOSE_PROJECT_NAME === PRODUCTION_PROJECT)
    throw new Error("拒绝在生产项目上执行测试栈命令");
  return env;
}

function composeArgs(envFile) {
  const override = resolve(
    process.cwd(),
    "deploy/stage2.compose.override.yaml",
  );
  const base = resolve(process.cwd(), "compose.deploy.yaml");
  // 发布流水线只把 controller/deploy/*.mjs 复制进 payload，两个 YAML 不在其中。
  // 因此这里给出需要显式上传的文件名，而不是一句笼统的「缺少文件」。
  if (!existsSync(base) || !existsSync(override))
    throw new Error(
      "缺少 compose.deploy.yaml 或 deploy/stage2.compose.override.yaml；" +
        "发布包只包含 deploy/*.mjs，这两个 YAML 需从仓库显式复制到测试目录",
    );
  return [
    "compose",
    "--project-name",
    parseEnv(readFileSync(envFile, "utf8")).COMPOSE_PROJECT_NAME,
    "--env-file",
    envFile,
    "-f",
    base,
    "-f",
    override,
  ];
}

function preflight(envFile) {
  const env = parseEnv(readFileSync(envFile, "utf8"));
  const check = checkStage2Env(env);
  const report = {
    env: { ok: check.ok, failures: check.failures, warnings: check.warnings },
  };
  if (check.failures.length)
    throw new Error("测试配置不合规：" + check.failures.join("；"));

  const run = docker;
  const identity = docker([
    "image",
    "inspect",
    "--format",
    "{{.Id}}|{{.Os}}/{{.Architecture}}",
    `${env.IMAGE_PREFIX}/api:${env.IMAGE_TAG}`,
    `${env.IMAGE_PREFIX}/web:${env.IMAGE_TAG}`,
  ])
    .split("\n")
    .filter(Boolean);
  report.images = identity;
  report.platforms = identity.map((line) => line.split("|")[1]);
  if (report.platforms.some((platform) => platform !== "linux/amd64"))
    throw new Error("测试镜像平台不是 linux/amd64");
  report.existing = listTaskResources(env.COMPOSE_PROJECT_NAME, run);
  report.inUse = {
    httpPort: docker(["ps", "--format", "{{.Ports}}"])
      .split("\n")
      .filter((ports) => ports.includes(`:${env.HTTP_PORT}->`)).length,
  };
  return report;
}

function composeStatus(envFile, args, options = {}) {
  return docker([...composeArgs(envFile), ...args], options);
}

/**
 * 全新测试库必须先启动 db 并等健康，再执行迁移，最后才能启动 api/web。
 * `compose run --no-deps` 不会拉起数据库，直接迁移在空环境上无法连接。
 * 迁移容器打同一任务标签，便于精确清理。
 */
function migrate(envFile) {
  loadGuardedEnv(envFile);
  composeStatus(
    envFile,
    ["up", "-d", "--wait", "--wait-timeout", "120", "db"],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  // 迁移会重写 schema，执行两次以验证幂等，与 deploy/smoke.mjs 的门禁一致。
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    composeStatus(
      envFile,
      [
        "run",
        "--rm",
        "--no-deps",
        "--label",
        `${STAGE_TASK_LABEL}=${STAGE2_TASK}`,
        "api",
        "node",
        "dist-openapi/scripts/migrate.js",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  }
  return { migrated: 2 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  try {
    if (command === "check-env" && process.argv[3]) {
      const check = checkStage2Env(
        parseEnv(readFileSync(process.argv[3], "utf8")),
      );
      console.log(JSON.stringify(check, null, 2));
      process.exitCode = check.ok ? 0 : 1;
    } else if (command === "preflight") {
      console.log(JSON.stringify(preflight(envPath()), null, 2));
    } else if (command === "migrate") {
      console.log(JSON.stringify(migrate(envPath())));
    } else if (command === "up") {
      const file = envPath();
      loadGuardedEnv(file);
      console.log(
        composeStatus(file, ["up", "-d", "--wait", "--wait-timeout", "180"]),
      );
      console.log(
        JSON.stringify(
          listTaskResources(loadGuardedEnv(file).COMPOSE_PROJECT_NAME),
          null,
          2,
        ),
      );
    } else if (command === "verify") {
      const file = envPath();
      loadGuardedEnv(file);
      console.log(
        composeStatus(file, [
          "exec",
          "-T",
          "api",
          "node",
          "-e",
          "fetch('http://127.0.0.1:3001/api/v1/health/ready').then(async r=>{const b=await r.json();console.log(JSON.stringify({status:b.status}));process.exit(r.ok?0:1)}).catch(()=>process.exit(1))",
        ]),
      );
      console.log(
        composeStatus(file, [
          "exec",
          "-T",
          "web",
          "wget",
          "-q",
          "-O",
          "-",
          "http://127.0.0.1/api/v1/health/ready",
        ]),
      );
    } else if (command === "down") {
      const file = envPath();
      loadGuardedEnv(file);
      console.log(composeStatus(file, ["stop"]));
    } else if (command === "start") {
      const file = envPath();
      loadGuardedEnv(file);
      console.log(composeStatus(file, ["start"]));
    } else if (command === "resources") {
      const env = loadGuardedEnv(envPath());
      console.log(
        JSON.stringify(listTaskResources(env.COMPOSE_PROJECT_NAME), null, 2),
      );
    } else if (command === "cleanup") {
      const env = loadGuardedEnv(envPath());
      console.log(
        JSON.stringify(
          cleanupStage2(env.COMPOSE_PROJECT_NAME, {
            volumes: process.argv.includes("--volumes"),
          }),
          null,
          2,
        ),
      );
    } else {
      throw new Error(
        "用法：stage2.mjs check-env <.env> | preflight | migrate | up | verify | down | start | resources | cleanup [--volumes]",
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
