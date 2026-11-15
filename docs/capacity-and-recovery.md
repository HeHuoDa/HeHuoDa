# 容量、清理与隔离备份恢复操作

对应 Issue #206 阶段二。本文只描述**现行可执行操作**，历史演练过程见 Issue 与 PR 记录。
目标环境是单机云服务器上的**独立测试栈**，与生产 `hehuoda-deploy` 完全分离。

未执行生产恢复、异机备份或生产故障注入；这些仍属未验证范围（见文末）。

## 前置事实

- 原始 HTML 响应与附件 body 都存于 PostgreSQL（`ingestion_versions.raw_response`、
  `ingestion_attachment_versions.body`），依赖数据库卷，不是对象存储。
- 保留策略为单一的 30 天（`INGESTION_RAW_DAYS`）。清理只把字节列置空，
  不清除长期正文、版本记录、人工修正、审核、映射与正式比赛。
- `body=NULL` 只是逻辑清理：`bytea` 置空不会立即归还磁盘，物理回收取决于
  autovacuum/`VACUUM FULL`，本阶段不做在线重写。

## 资源命名与隔离边界

| 类型   | 生产             | 本阶段测试                                   |
| ------ | ---------------- | -------------------------------------------- |
| 目录   | `/opt/hehuoda`   | `/opt/hehuoda-test`                          |
| 项目   | `hehuoda-deploy` | `hehuoda-stage2`                             |
| 入口   | `0.0.0.0:80`     | `127.0.0.1:18080`（仅回环）                  |
| 数据库 | `hehuoda`        | `hehuoda_stage2_test`（独立卷 `*_database`） |
| 标签   | 无统一任务标签   | `hehuoda.task=issue206-stage2`               |

测试栈的每个容器、网络与卷都带 `hehuoda.task=issue206-stage2`，清理工具据此精确匹配，
不执行全局 prune。

## 启动与验证

在服务器上执行（`deploy/` 已随发布配置复制到 `/opt/hehuoda-test`）：

```bash
cd /opt/hehuoda-test
STAGE2_ENV_FILE=.env node deploy/stage2.mjs check-env .env   # 校验生产隔离
STAGE2_ENV_FILE=.env node deploy/stage2.mjs preflight        # 镜像平台、端口、既有资源
STAGE2_ENV_FILE=.env node deploy/stage2.mjs migrate          # 空库执行迁移（幂等，跑两次）
STAGE2_ENV_FILE=.env node deploy/stage2.mjs up               # 启动并等待健康
STAGE2_ENV_FILE=.env node deploy/stage2.mjs verify           # API/Web 就绪检查
STAGE2_ENV_FILE=.env node deploy/stage2.mjs resources        # 列出本任务资源
```

`check-env` 会拒绝：复用生产项目名或库名、绑定非回环地址、占用 80/443、
开启调度/微信登录/校园核验、填写生产身份密钥、`IMAGE_TAG` 非 40 位 SHA。

开发机通过 SSH 隧道查看测试 H5，不新增公网端口：

```bash
ssh -N -L 18080:127.0.0.1:18080 <已核实SSH目标>
# 浏览器访问 http://127.0.0.1:18080
```

管理端没有独立线上镜像。需要管理接口时，用同一隧道把开发机 `apps/admin` 指向
`http://127.0.0.1:18080/api/v1`，并注意测试 `.env` 的 `ADMIN_ALLOWED_ORIGINS`
默认留空（关闭管理登录）。打开测试 H5 不等于能访问管理端。

## 容量测量

容量脚本在测试 API 容器内运行，只写测试库：

```bash
docker cp capacity-stage2.mjs hehuoda-stage2-api-1:/app/capacity-stage2.mjs
docker exec -e STAGE2_SHA=<完整SHA> hehuoda-stage2-api-1 node /app/capacity-stage2.mjs
docker cp hehuoda-stage2-api-1:/tmp/stage2-report/capacity.json ./capacity.json
```

环境变量控制样本规模（默认与实测值一致）：
`STAGE2_NOTICES=60`、`STAGE2_VERSIONS=3`、`STAGE2_ATTACHMENTS=60`、
`STAGE2_ATTACHMENT_BYTES=65536`、`STAGE2_PARSE_ROUNDS=3`、`STAGE2_THROUGHPUT_ROUNDS=20`。

报告分三块，必须分别引用，不得混为一条证据：

1. **逻辑与物理占用**：`ingestion_versions.article/extracted`、附件 `body`/`segments`
   的逻辑字节，以及 `pg_database_size`、各表 `table/index/toast` 物理字节。
2. **Linux 隔离解析**：真实 `attachment-sandbox` 子进程下 PDF/DOCX 的耗时与
   RSS 基线，以及并发 1 的串行吞吐。只代表本机本镜像本样本。
3. **清理边界**：见下节。

## 30 天清理边界

`cleanupResponses(pool, days, now)` 与 `cleanupAttachmentBodies(pool, days, now)`
接受显式参照时间；省略时沿用数据库时钟（调度器行为不变）。

判据是严格小于：`fetched_at < now - days`。

- 期限前（29.5 天）保留
- 正好 30 天保留
- 超过 1 毫秒即清理
- 重复清理返回 `removed: 0`
- 参数越界（0、366、1.5、-1）与无效参照时间直接报错，不会退化成照常清理
- 数据库/权限失败会抛出，不返回虚假的 `removed: 0`

集成测试：`apps/api/test/attachment-retention.integration-spec.ts`
（需要 `_test` 数据库与隔离 schema）。覆盖期限三态、幂等、失败路径、
清理后不可重新解析（`字节已清理`），以及清理不影响已批准材料、映射与 published 比赛。

清理后重新解析会失败并提示需要受控重新获取，这是预期行为，不是缺陷。

## 隔离备份恢复

导出与恢复都只走本任务资源，不写入生产备份目录 `/opt/hehuoda/backups`：

```bash
# 测试栈自身快照（推荐：可以覆盖候选/审核/映射/多版本附件）
node deploy/recovery-test.mjs

# 生产库只读副本（只读导出，不恢复回生产）
node deploy/recovery.mjs
```

两者的共同流程：`pg_dump --format=custom` → 新建无网络、独立匿名卷、
独立随机口令的 `postgres:17.10-bookworm` 容器 → `pg_restore --exit-on-error`
→ 对比业务完整性摘要 → 删除该容器。

完整性摘要由 `deploy/integrity.mjs` 生成，比较项包括：

- 计数：正式比赛（含 published）、stages/tracks/notices、候选与 approving/imported 状态、
  审核修订、操作审计、映射、附件与附件版本、含字节的版本数与总字节、原始响应用量
- 关系与稳定 ID：比赛 ID、候选状态与修订、映射关系、审核修订键、附件与版本键、证据状态
- 保留期内可恢复字节：`sha256(body)`/`sha256(raw_response)` 的还原哈希

`verifyBackup(file, { integrity })` 需要时可按摘要对照；省略时保持原有四类计数门禁，
不改变发布流水线既有判断。

差异以固定分类清单抛出（`count` / `content`），不打印字节或连接串。
负向对照已验证：删除一条正式通知后比较会报出差异，因此「0 差异」不是空断言。

## 停止与精确清理

```bash
STAGE2_ENV_FILE=.env node deploy/stage2.mjs down          # 停止（等价 compose stop，保留资源）
STAGE2_ENV_FILE=.env node deploy/stage2.mjs start         # 重新启动
STAGE2_ENV_FILE=.env node deploy/stage2.mjs cleanup        # 删容器/网络，保留数据卷
STAGE2_ENV_FILE=.env node deploy/stage2.mjs cleanup --volumes  # 连同测试卷一起删除
```

清理规则：

- 逐个读取资源标签，标签读不到或不是 `issue206-stage2` 时**拒绝删除**并列入 `refused`
- 默认不删数据卷；`--volumes` 也只删带本任务标签的卷
- 任何路径都不执行 `docker system prune`、`volume prune` 或 `down --volumes` 到生产
- 清理后仍需人工删除 `/opt/hehuoda-test`（含 `.env`、备份与报告），该目录不在工具范围内

## 失败处理

| 现象                                       | 处理                                                            |
| ------------------------------------------ | --------------------------------------------------------------- |
| `check-env` 报失败                         | 按提示修 `.env`；不要为通过校验而放宽隔离条件                   |
| `up` 后 API 不健康、日志报 relation 不存在 | 先跑 `migrate`，空库没有迁移不能启动                            |
| `preflight` 报端口占用                     | 换 `HTTP_PORT` 或先确认占用者；不要占用生产 80/443              |
| `docker ... failed` 只说固定类别           | 原始 stderr 不外泄，按类别（connection/oom/permission/sql）排查 |
| 恢复摘要出现差异                           | 差异即失败：保留报告，先查数据是否真的缺失，不要放宽比较        |
| 清理出现 `refused`                         | 手工核对标签来源；不属于本任务的资源不要删                      |

## 证据范围

- **本地（Windows）**：单元/集成/e2e 与 Compose 解析测试；不是 Linux 容器实测。
- **云端 Linux 容器**：隔离解析器、容量、清理边界、真实 `pg_dump`/`pg_restore`。
- **CI**：质量门禁与镜像冒烟。
- **生产**：只做了只读导出与身份核对，未执行恢复、清理、迁移或故障注入。
- **异机灾难恢复**：未执行。同机隔离恢复不等于异机恢复，也不覆盖磁盘或主机级故障。
