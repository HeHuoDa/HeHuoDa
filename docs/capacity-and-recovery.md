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

发布流水线只把 `controller/deploy/*.mjs` 复制进发布包（`.github/workflows/deploy.yml`），
**不包含** `compose.deploy.yaml`、`deploy/stage2.compose.override.yaml` 与 `deploy/stage2.env.example`。
因此测试目录需要先从仓库显式准备这三类文件（命令中的 `$REPO` 指本仓库检出）：

```bash
sudo mkdir -p /opt/hehuoda-test/deploy && sudo chown -R "$USER" /opt/hehuoda-test
cp "$REPO"/compose.deploy.yaml /opt/hehuoda-test/
cp "$REPO"/deploy/stage2.compose.override.yaml /opt/hehuoda-test/deploy/
cp "$REPO"/deploy/stage2.mjs "$REPO"/deploy/integrity.mjs /opt/hehuoda-test/deploy/
cp "$REPO"/deploy/stage2.env.example /opt/hehuoda-test/deploy/
# 按模板填写 .env（权限 600）；密码在服务器本地生成，不回传不提交
install -m 600 /opt/hehuoda-test/deploy/stage2.env.example /opt/hehuoda-test/.env
chmod 700 /opt/hehuoda-test
```

准备好后在服务器上执行：

```bash
cd /opt/hehuoda-test
STAGE2_ENV_FILE=.env node deploy/stage2.mjs check-env .env   # 校验生产隔离
STAGE2_ENV_FILE=.env node deploy/stage2.mjs preflight        # 镜像平台、端口、既有资源
STAGE2_ENV_FILE=.env node deploy/stage2.mjs migrate          # 先启动 db 并等健康，再迁移（幂等，跑两次）
STAGE2_ENV_FILE=.env node deploy/stage2.mjs up               # 启动并等待健康
STAGE2_ENV_FILE=.env node deploy/stage2.mjs verify           # API/Web 就绪检查
STAGE2_ENV_FILE=.env node deploy/stage2.mjs resources        # 列出本任务资源
```

每个会变更 Docker 状态的命令（`migrate`/`up`/`down`/`start`/`verify`/`cleanup`）
都会重新读取并校验 `.env`，不合规立即拒绝；不依赖操作者记得先跑 `preflight`，
也覆盖「检查后修改了 `.env`」的情况。

`migrate` 会先 `compose up -d --wait db` 等测试数据库健康再迁移：
`compose run --no-deps` 不会拉起数据库，在全新空环境上直接迁移无法连接。
因此从无容器、无卷的状态也可按上述顺序一次走通。

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

仓库内现行、可维护的入口是 `deploy/integrity.mjs`（恢复摘要）与
`deploy/stage2.mjs`（启停与清理）。容量采样本阶段使用的是一次性测量脚本，
保留在本地 `.data/` 目录、**不在本仓库中**；下列步骤说明可复现的流程与产物形状，
仓库不提供 `capacity-stage2.mjs` 这类命令。

可复现流程（在测试栈已健康后执行）：

1. 把测量脚本复制进测试 API 容器，在容器内运行（只连测试 `.env` 指向的库），
   报告写到 `/tmp/stage2-report/capacity.json`（0600）；
2. 把报告复制出容器到 `/opt/hehuoda-test`，再取回本地；
3. 报告分三块，分别引用，不得混为一条证据（见下）。

测量参数（默认值与一次实测一致）：多条通知 × 多版本、多个附件 × 固定字节、
解析轮次与吞吐轮次。参数只影响样本规模，不改变判据。

报告分三块，必须分别引用，不得混为一条证据：

1. **逻辑与物理占用**：`ingestion_versions.article/extracted`、附件 `body`/`segments`
   的逻辑字节，以及 `pg_database_size`、各表 `table/index/toast` 物理字节。
2. **Linux 隔离解析**：真实 `attachment-sandbox` 子进程下 PDF/DOCX 的耗时、
   进程树内存峰值（含子进程）与容器 cgroup 水位，以及并发 1 的串行吞吐。
   只代表本机本镜像本样本。
3. **清理边界**：见下节。

容量数字的定位：这是**合成样本的诊断结果**，可用于判断增长由哪一项主导、
量级是否在服务器余量内；它不包括候选/审核/审计行增长与备份累积，
不是完整容量准入结论。

## 30 天清理边界

`cleanupResponses(pool, days, now)` 与 `cleanupAttachmentBodies(pool, days, now)`
接受显式参照时间；**省略 `now` 时仍用数据库时钟**（`now()`），与调度器原有行为一致，
避免应用与数据库时钟偏差改变到期结果。

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

导出与恢复都只走本任务资源，不写入生产备份目录 `/opt/hehuoda/backups`。
仓库提供的能力是 `deploy/integrity.mjs` 的摘要与 `deploy/backup.mjs` 的
`verifyBackup(file, { integrity })`；本阶段的恢复演练脚本（测试栈快照与
生产库只读副本）是一次性脚本，保存在本地 `.data/`，不在本仓库中。

可复现流程：

1. 从目标容器 `pg_dump --format=custom --no-owner --no-acl` 到测试目录
   （不写生产备份目录）；
2. 用 `readBusinessIntegrity(container, { user, database })` 读源库摘要；
3. 新建无网络、独立匿名卷、独立随机口令的 `postgres:17.10-bookworm` 容器，
   `pg_restore --exit-on-error`；
4. 再用同一函数读恢复库摘要，`compareIntegrity` 比对；
5. 仅当容器带 `hehuoda.task=backup-verification` 标签时才 `docker rm -f -v`。

生产库里没有 `restore` 角色，因此读源侧必须显式传 `user`/`database`，
否则会因角色不存在而失败（这是有意的失败，不是静默空结果）。

完整性摘要由 `deploy/integrity.mjs` 生成，比较项包括：

- 计数：正式比赛（含 published）、stages/tracks/notices、候选与 approved/imported 状态、
  审核修订、操作审计、映射、附件与附件版本、含字节的版本数与总字节、原始响应用量
- 关系与稳定 ID：比赛 ID、候选状态与修订、映射关系、审核修订键、附件与版本键、证据状态
- **人工与正式内容摘要**：候选 `data` 与 `approved_file`、审核修订 `review`、
  比赛/stage/track/notice 的 `data`、长期正文 `article`/`extracted`、附件 `segments`
  的 sha256；只改内容不改 ID/行数的恢复缺陷也能被检出
- 保留期内可恢复字节：`sha256(body)`/`sha256(raw_response)` 的还原哈希

`verifyBackup(file, { integrity })` 需要时可按摘要对照；省略时保持原有四类计数门禁，
不改变发布流水线既有判断。注意 `deploy/integrity.mjs` **没有命令行入口**，
它只导出函数；要生成摘要并在校验时使用，需在运维脚本里显式调用：

```js
import { readBusinessIntegrity } from "./deploy/integrity.mjs";
import { verifyBackup } from "./deploy/backup.mjs";

const expected = readBusinessIntegrity("hehuoda-stage2-db-1", {
  docker,
  user: "stage2",
  database: "hehuoda_stage2_test",
});
verifyBackup("/opt/hehuoda-test/backups/x.dump", { integrity: expected });
```

`node deploy/backup.mjs verify <dump>` 只做四类计数，不接受摘要参数。

差异以固定分类清单抛出（`count` / `content`），不打印字节或连接串。
两类负向对照已验证：「删除一条正式通知」使计数差异被报出；
「只改人工修正/正式比赛/长期正文内容、ID 与行数不变」使内容差异被报出。
因此「0 差异」不是空断言。

### 恢复耗时、备份清单与丢失窗口

在隔离测试栈（4 vCPU / 3.7 GiB，dump 与恢复容器同机）的实测，作为规模参考，
不是服务等级承诺：

| 项                                | 实测值                                                 |
| --------------------------------- | ------------------------------------------------------ |
| dump 大小                         | 约 185 KiB（合成种子：2 通知版本、2 附件版本、1 映射） |
| 导出（`pg_dump --format=custom`） | 约 0.36 s                                              |
| 恢复到全新无网络容器              | 约 2.6 s                                               |
| 恢复后业务差异                    | 0 项                                                   |

备份清单：仓库未内置备份清单索引，现行为是**按目录列举**
`/opt/hehuoda/backups/*.dump`（仅存于服务器，文件名带时间戳与 UUID）。
发布流程每次备份成功后立即做一次隔离恢复校验，否则不保留该 dump。
当前**没有**自动过期策略，备份不随发布版本清理，需人工轮转。

丢失窗口：当前备份是**发布时点**快照，不是持续归档。两次发布之间的写入
在主机或磁盘故障时没有可恢复副本；最坏情况丢失窗口＝上一次成功发布至今。
这是现状事实，不是可接受的设定值；是否需要定时备份或异机异地副本，
属于后续阶段决策，本阶段未做也不声称已覆盖。

磁盘告警：本阶段**未引入**磁盘告警。现有事实是 `df` 中根分区可用 27 GiB，
备份目录当前合计约 0.4 MiB，备份无自动过期因此会随发布次数单调增长。
没有告警阈值、没有容量触发机制，属未建设项。

## 停止与精确清理

```bash
STAGE2_ENV_FILE=.env node deploy/stage2.mjs down          # 停止（等价 compose stop，保留资源）
STAGE2_ENV_FILE=.env node deploy/stage2.mjs start         # 重新启动
STAGE2_ENV_FILE=.env node deploy/stage2.mjs cleanup        # 删容器/网络，保留数据卷
STAGE2_ENV_FILE=.env node deploy/stage2.mjs cleanup --volumes  # 连同测试卷一起删除
```

清理规则：

- 资源必须**同时**带 `hehuoda.task=issue206-stage2` 与
  `com.docker.compose.project=<目标项目>` 两个标签；只有任务标签可能跨项目误删
- 逐个复核两个标签，任一读不到或不匹配时**拒绝删除**并列入 `refused`
- 拒绝在生产项目名或空项目名下清理
- 默认不删数据卷；`--volumes` 也只删带完整双标签的卷
- 任何路径都不执行 `docker system prune`、`volume prune` 或 `down --volumes` 到生产
- 清理后仍需人工删除 `/opt/hehuoda-test`（含 `.env`、备份与报告），该目录不在工具范围内

## 失败处理

| 现象                                       | 处理                                                                                                                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check-env` 或任一变更命令报配置不合规     | 按提示修 `.env`；不要为通过校验而放宽隔离条件                                                                                                                                |
| `up` 后 API 不健康、日志报 relation 不存在 | 先跑 `migrate`；它会先拉起测试数据库再迁移                                                                                                                                   |
| `preflight` 报端口占用                     | 换 `HTTP_PORT` 或先确认占用者；不要占用生产 80/443                                                                                                                           |
| `docker ... failed (exit N)`               | 该工具**不分类也不写诊断文件**（与 `runtime.mjs` 不同）；保留的只有退出码，需手工重跑对应命令排查。先确认 Docker 引擎是否在运行（`docker info`），不要把引擎未启动当成未安装 |
| 恢复摘要出现差异                           | 差异即失败：保留报告，先查数据是否真的缺失，不要放宽比较                                                                                                                     |
| 清理出现 `refused`                         | 手工核对两个标签；不属于本任务/本项目的资源不要删                                                                                                                            |

## 证据范围

- **本地（Windows）**：单元/集成/e2e 与 Compose 解析测试；不是 Linux 容器实测。
- **云端 Linux 容器**：隔离解析器、容量、清理边界、真实 `pg_dump`/`pg_restore`。
- **CI**：质量门禁与镜像冒烟。
- **生产**：只做了只读导出与身份核对，未执行恢复、清理、迁移或故障注入。
- **异机灾难恢复**：未执行。同机隔离恢复不等于异机恢复，也不覆盖磁盘或主机级故障。
- **旧版应用兼容**：只验证了新代码可读旧数据，未实际运行旧应用。

上述云端证据的镜像是该 SHA 的既有 CI 产物；清理边界结论来自与源码一致的判据
（镜像内函数早于本次改动，不接受参照时刻），报告分两条路径如实并列。
