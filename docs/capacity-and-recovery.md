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

### 附件样本分类分母

验收要求「支持/扫描/超限/受阻/人工格式分别列出」。下表是在该 SHA 镜像内
用真实 `parseAttachmentIsolated` 跑出的分类分母（6 个样本 / 5 类）：

| 类别                         | 样本 | 成功 | 失败 | 错误码             |
| ---------------------------- | ---- | ---- | ---- | ------------------ |
| 支持（文本层 PDF、DOCX）     | 2    | 2    | 0    | —                  |
| 扫描（无文本层 PDF）         | 1    | 0    | 1    | `invalid-pdf`      |
| 超限（>5MiB 输入）           | 1    | 0    | 1    | `input-size-limit` |
| 受阻（验证码 HTML 冒充 PDF） | 1    | 0    | 1    | `type-mismatch`    |
| 人工（未知媒体类型）         | 1    | 0    | 1    | `type-mismatch`    |

如实说明两点限制，不靠表格掩盖：

- 「受阻」与「人工」两类都以 `type-mismatch` 结束。前者是**内容与声明类型不符**
  （验证码 HTML 声明为 PDF）被挡下，后者是**媒体类型本身无法识别**，
  两者在采集链路上最终都会归为 `unsupported-attachment-type` 方向的失败，
  但入口判据不同。这份样本集没有分别验证到它们各自的完整错误码，
  所以只能声明「两类均被拒绝」，不能声称区分准确。
- 样本是合成最小文件，不能外推真实扫描件 OCR 需求与真实 PDF 的耗时分布。
  它给的是**分母与分类路径**，不是真实栏目内容的分类准确率。

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
它只导出函数；要生成摘要并在校验时使用，需在运维脚本里显式调用。

`readBusinessIntegrity` 的 `docker` 参数要传 **`deploy/runtime.mjs` 导出的 `docker`
函数本身**：它会自己传 `input` 与 `stdio`（psql 脚本走 stdin）。
不要自己再包一层只转发 args 的包装函数，那会丢掉 `stdio` 设置，
使查询静默无输出、最后报「业务完整性查询缺少结果」。

```js
import { docker } from "./deploy/runtime.mjs";
import { readBusinessIntegrity } from "./deploy/integrity.mjs";
import { verifyBackup } from "./deploy/backup.mjs";

// 从采集源（测试栈）读摘要，用该库自身的角色与库名。
const expected = readBusinessIntegrity("hehuoda-stage2-db-1", {
  docker,
  user: "stage2",
  database: "hehuoda_stage2_test",
});
verifyBackup("/opt/hehuoda-test/backups/x.dump", { integrity: expected });
```

从测试目录运行该脚本时，除 `stage2.mjs`、`integrity.mjs` 外，还必须有
`backup.mjs`、`runtime.mjs` 与 `manifest.mjs`——`backup.mjs` 依赖 `runtime.mjs`，
而 `runtime.mjs` 又 `import { readManifest } from "./manifest.mjs"`。
这五个 `.mjs` 都在仓库 `deploy/` 下，需一并复制到测试目录的 `deploy/` 子目录；
漏掉 `manifest.mjs` 会在 `import` 阶段直接报 `ERR_MODULE_NOT_FOUND`。

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

磁盘告警：已实现，但**只告警不阻断**。

- 判据用**绝对可用字节**，不用百分比：40G 盘剩 10% 是 4G 尚可用，
  而 500G 盘剩 80% 也不必报警，百分比阈值在两种规模下都不安全。
- 默认门槛：低于 5120 MiB 告警（warning），低于 1024 MiB 严重（critical）。
  由 `DISK_WARNING_MIB` / `DISK_CRITICAL_MIB` 调整，校验时强制 `warning ≥ critical`。
- 两个上报点：
  - 采集调度器在**清理前后**各评估一次并写日志；
  - `/health/ready` 每次调用评估，但同一等级**10 分钟只告警一次**
    （健康检查每 10 秒一次，不节流会让告警日志本身成为写盘最多的东西）。
- **不用磁盘余量影响 ready 判定**：磁盘已满时把容器判为不健康会触发重启，
  而重启不会凭空变出空间，只会让正在写的请求失败得更彻底。
- 公开的 `/health` 不暴露可用空间（仅返回 `status` 与 `requestId`），
  避免把容量信息挂到公网入口，也符合本阶段「不新增公开监控端点」。
- 读不到磁盘信息时不判失败，只跳过告警：容器内挂载异常时已有其他检查会暴露问题。

清理失败不再静默：两个清理各自独立记录 `removed` 或错误，
避免把实际失败读成「没有过期数据」。

### 磁盘不足时的真实行为（实测）

验收要求「磁盘不足不会产生虚假成功」。这不是靠读告警日志能证明的，
于是在隔离容器里把 `pg_tblspc` 放到 64 MiB 的 tmpfs 上，真实填满后观测：

| 阶段                        | 观测结果                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 填满到 100%                 | `df` 可用 0；PostgreSQL 仍在运行，写入报 `could not extend file ... No space left on device`（SQLSTATE 53100） |
| 执行 DELETE                 | **仍然成功**，返回 `DELETE 5`；`cleanup*` 会报 `removed=N`                                                     |
| 删掉全部 71 MB 数据后       | `pg_database_size` **仍显示 71 MB**；`df` 可用 **仍为 0**                                                      |
| 极端情形（PGDATA 在 tmpfs） | WAL 写失败升级为 `PANIC`，实例直接停服                                                                         |

结论必须直说：**`removed` 只代表逻辑上标记为已清理，不代表磁盘空间已归还**。
DELETE 只把行标为死元组，空间由后续 VACUUM 回收，而 VACUUM 同样需要写盘。
因此：

- 「磁盘不足不产生虚假成功」在**数据正确性**层面成立：清理不会假装删掉
  本不该删的长期文本、审计或人工结果（已有集成测试锁定）；
- 但在**腾出空间**层面，`removed>0` 不能当作磁盘已缓解的证据。
  运维必须看 `df`，不能看清理日志的 `removed`。
- 这也是磁盘告警阈值用**绝对可用字节**而非「清理是否报成功」的原因。

上述实测是本机 Docker 上的一次性验证（tmpfs 造满），不在 CI 门禁内；
集成测试锁定的是「引用不失效」与「失败可区分」两个可稳定复现的语义。

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

- **本地（Windows）**：单元/集成测试；e2e 在本机会原生崩溃（exit 3221226505），不由此处提供 e2e 证据。
- **本地 Linux 容器**：完整 `pnpm test:e2e`（`node:24.15.0-bookworm-slim`，依赖在容器内重装，不复用 Windows 的 `node_modules`）。这是 Windows 崩溃后 e2e 的实际证据来源。
- **云端 Linux 容器**：隔离解析器、容量、清理边界、真实 `pg_dump`/`pg_restore`。
- **CI**：质量门禁与镜像冒烟。
- **生产**：只做了只读导出与身份核对，未执行恢复、清理、迁移或故障注入。
- **异机恢复**：两条路径分别记录，不互相冒充：
  - **云端生产 → 本机**：经 SFTP 传输后在本机独立容器恢复。但生产业务表目前为空
    （`competitions`/`notices`/`candidates` 均为 0），一致性只证明**结构与空集**可跨机恢复。
  - **本机测试库（含合成业务数据）→ 全新数据目录与实例**：37 段业务摘要对比零差异，
    源头含 2 比赛/1 发布/2 通知/2 版本/1 候选/1 审核修订/3 审计/1 映射/2 附件版本。
    脚本带区分度自检：源头业务表为空时直接失败，拒绝据此认定通过。
  - 两条路径均**未覆盖**主机宕机、磁盘损坏等真实灾难场景，也没有异地存储副本。
  - 实测值（合成业务快照，dump 267794 B）：导出 ~292 ms、新实例就绪 ~3.0 s、
    恢复 **697 ms**、37 段摘要差异 **0**。生产快照（121099 B）恢复 487 ms。
- **旧版应用兼容**：只验证了新代码可读旧数据，未实际运行旧应用。

上述云端证据的镜像是该 SHA 的既有 CI 产物；清理边界结论来自与源码一致的判据
（镜像内函数早于本次改动，不接受参照时刻），报告分两条路径如实并列。
