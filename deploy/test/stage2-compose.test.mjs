import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const docker = process.env.DOCKER_BIN || "docker";
const available =
  spawnSync(docker, ["compose", "version"], { encoding: "utf8" }).status === 0;

// 真实 Compose 解析校验：覆盖文件必须与生产合并后仍然可用，且只引入
// 测试项目名、仅回环入口、资源上限与可清理标签。
test(
  "stage2 override keeps the stack isolated, bounded and labelled for exact cleanup",
  { skip: !available },
  (t) => {
    const directory = mkdtempSync(join(tmpdir(), "hehuoda-stage2-compose-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const envFile = join(directory, ".env");
    writeFileSync(
      envFile,
      [
        "COMPOSE_PROJECT_NAME=hehuoda-stage2",
        "IMAGE_PREFIX=hehuoda-local",
        "IMAGE_TAG=" + "b".repeat(40),
        "POSTGRES_USER=stage2",
        "POSTGRES_PASSWORD=synthetic-password",
        "POSTGRES_DB=hehuoda_stage2_test",
        "DATABASE_URL=postgresql://stage2:synthetic-password@db:5432/hehuoda_stage2_test",
        "HTTP_BIND=127.0.0.1",
        "HTTP_PORT=18080",
        "INGESTION_ENABLED=false",
        "",
      ].join("\n"),
    );
    const result = spawnSync(
      docker,
      [
        "compose",
        "--project-name",
        "hehuoda-stage2",
        "--env-file",
        envFile,
        "-f",
        fileURLToPath(new URL("../../compose.deploy.yaml", import.meta.url)),
        "-f",
        fileURLToPath(
          new URL("../stage2.compose.override.yaml", import.meta.url),
        ),
        "config",
        "--format",
        "json",
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(result.stdout);

    // 独立项目名；数据库不发布端口；入口只在回环地址。
    assert.equal(config.name, "hehuoda-stage2");
    assert.equal(config.services.db.ports, undefined);
    assert.equal(config.services.api.ports, undefined);
    assert.deepEqual(config.services.web.ports, [
      {
        mode: "ingress",
        host_ip: "127.0.0.1",
        target: 80,
        published: "18080",
        protocol: "tcp",
      },
    ]);

    // 资源上限合计不超过服务器余量的一小部分，并为生产留出空间。
    const limits = { db: 512, api: 768, web: 96 };
    let total = 0;
    for (const [service, mebibytes] of Object.entries(limits)) {
      const declared = Number(config.services[service].mem_limit);
      assert.equal(declared, mebibytes * 1024 * 1024, service);
      assert.ok(Number(config.services[service].cpus) > 0, service);
      total += mebibytes;
    }
    assert.ok(total <= 1536, `test stack memory ${total}MiB must stay small`);

    // 每个可清理资源都带固定任务标签，清理脚本以此精确匹配。
    for (const service of ["db", "api", "web"])
      assert.equal(
        config.services[service].labels["hehuoda.task"],
        "issue206-stage2",
      );
    assert.equal(
      config.networks.default.labels["hehuoda.task"],
      "issue206-stage2",
    );
    assert.equal(
      config.volumes.database.labels["hehuoda.task"],
      "issue206-stage2",
    );

    // 关闭项在合并后仍然关闭，不会被覆盖文件意外打开。
    assert.equal(config.services.api.environment.INGESTION_ENABLED, "false");
    assert.equal(config.services.api.environment.WECHAT_LOGIN_ENABLED, "false");
    assert.equal(
      config.services.api.environment.CAMPUS_VERIFICATION_ENABLED,
      "false",
    );
    // 生产项目名不会被覆盖文件写成默认值。
    assert.notEqual(config.name, "hehuoda-deploy");
  },
);
