# 单机容器部署与恢复

本说明对应共享部署基础设施及 Issue #143。用户端部署 `apps/uni` 的 H5 和 API；管理端演示不增加线上镜像。微信小程序产物不进入 Nginx，也不由本工作流上传。历史部署记录见下方 ADR 与既有 Issue；本次计划尚无生产演练证据时，不能将流程描述为已经上线。

## 当前交付决策

TCR 推送的有限重试和状态诊断避免了无限等待，但最近一次 main 试运行仍连续超时，远端也没有目标 manifest。因此，新版本改由 SSH 直传已经通过真实镜像冒烟的归档包，免去新版本 API/Web 镜像依赖 GHCR/TCR。重复出现的层状态只是诊断线索，不能单独证明 TCR 服务端根因。

```text
质量检查 → 构建实际 API/Web 镜像并冒烟 → 保存镜像归档及清单
→ SSH 校验、传输与导入 → 数据库备份/迁移 → 更新应用及健康检查
→ 成功记录版本；失败恢复旧应用
```

CI 重用冒烟后的同一份 API 与 uni H5 镜像，不重新构建；artifact 按提交 SHA 和 CI attempt 命名，保留 **7 天**。清单绑定仓库、SHA、CI run/attempt、平台、归档 SHA-256 与字节长度、API/Web 完整标签及 image ID。服务器最多保留 **三个成功版本**（当前版和前两个成功版本）。新 CI 不再向 GHCR/TCR 上传镜像；旧镜像与 digest 清单保留供旧版本兼容恢复。PostgreSQL `17.10-bookworm` 仍是单独镜像依赖，缺失时显式准备，版本与数据卷不变。

## 主机准备与首次演练

目标主机为 Linux 单机，需 Docker Engine、Node `24.15.0`、Compose 插件（TLS 配置要求至少 `2.24.4`）、可运行 Docker 的部署用户、可写的项目目录及足够空间。Docker 组权限等价于主机管理权限。默认目录 `/opt/hehuoda` 由管理员预建，建议权限 `700`；`.env` 权限 `600`。部署程序只检查 `.env` 存在，不输出其内容。数据库/镜像仓库凭据只保留在服务器受控配置。

服务器目录大致如下：

```text
/opt/hehuoda/
  .env
  releases/<SHA>/<run>-<attempt>/  # artifact、目标 Compose 与受信控制器
  controller/<run>-<attempt>/      # 仅回滚时传输的受信控制器
  state/current.json              # 当前发布和最多三个成功版本
  state/release.lock/
  state/logs/                      # 主机本地受控诊断
  backups/                         # 数据库备份，不随版本清理
```

首次手动运行 Deploy 时选择 `prepare`（默认动作），输入完整 40 位 SHA。工作流先验证产物来源及摘要，再通过严格主机验证的 SSH 检查服务器能力。1 MiB 随机探针和完整归档均使用 rsync over SSH，不回退 SCP。探针步骤上限 **2 分钟**、进程内部上限 **90 秒**；首次整包步骤 **25 分钟**、内部 **24 分钟**，唯一一次续传步骤 **15 分钟**、内部 **14 分钟**，间隔 **10 秒**。SSH 连接超时 **30 秒**；rsync 连续 **120 秒**无数据活动即退出，内部硬时限先发送 TERM、10 秒后仍未退出则终止整个本地传输进程组。原发布控制器内部上限 **20 分钟**、步骤 **22 分钟**；最终清理步骤 **2 分钟**；Deploy 总上限 **75 分钟**。不按短探针耗时推算整包时长。

两次尝试复用同一份源文件与本次私有 staging，使用 `--partial-dir=.rsync-partial` 保留中断数据；不启用额外传输压缩、append 或 inplace 模式。只支持同一次工作流内续传：重试前保留半成品，整个任务失败或取消后清理，不跨运行缓存。两次上传即使客户端返回失败，也必须检查最终文件的长度与 SHA-256；完整才解包交付，不完整或损坏则以完整性错误停止。目标发布目录存在时拒绝覆盖。公开日志只输出白名单数字进度、逻辑速率、耗时及新传/复用字节；原始 stdout/stderr 仅存私有临时文件，不公开地址或路径。逻辑进度不能当作网络发送字节统计，失败时没有完整统计会显式标记。

`prepare` 不运行迁移、不替换服务、不推进成功历史。记录并比较演练前后 API/Web 容器、镜像 ID、健康状态与 `current.json`，确认当前服务不变。只有演练通过后，维护者才开启 `DEPLOY_ARCHIVE_ACTIVATE=true`，并以 `deploy` 显式部署同一 SHA/artifact。该开关初始关闭。首发验证通过后，后续 main CI 成功才允许自动归档更新；原 `DEPLOY_ENABLED` 语义及当前值保持不变。

## CI 与产物消费

`CI` 保留契约生成、类型检查、构建、单元/集成/e2e、部署测试及实际镜像冒烟。主分支完整检查要求质量检查、镜像冒烟和归档清单上传全部成功。默认工作流没有 GHCR/TCR 发布任务和包写权限。Deploy 必须核验 artifact 来自本仓库对应 SHA 的成功 main CI，包括 run、attempt、任务成功状态、有效期和 manifest 字段；错误来源、摘要、平台或 image ID 都拒绝部署。后续传输重试使用同一 artifact。

Deploy 的新控制器来自受信 main 提交；目标 SHA 只提供与该版本配套的 Compose、Nginx/TLS 配置和清单。旧目标版本自己的控制器不能读取新版本状态，不能将其作为新控制器使用。API/Web 通过本地导入镜像运行，Compose 禁止自动拉取与现场构建。数据库镜像独立检查，不因应用归档切换而改变版本或数据卷。

自动工作流仅处理未过时的 main SHA；过时任务跳过。手动入口提供 `prepare`、`deploy` 和 `rollback`：

- `prepare` 只导入并验证，默认动作。
- `deploy` 要求激活开关开启，执行原有备份、迁移、更新、健康与公开入口检查。
- `rollback` 必须指定准确 SHA，并通过旧有授权与镜像身份校验。

需要手动补跑 main CI 时，在已登录且有工作流运行权限的维护机执行：

```bash
gh workflow run ci.yml --repo HeHuoDa/HeHuoDa --ref main
gh run list --repo HeHuoDa/HeHuoDa --workflow ci.yml --branch main \
  --event workflow_dispatch --limit 5 \
  --json databaseId,headSha,status,conclusion,url
```

部署前确认 run 的 SHA 和成功结论，并从同一 run 下载该 SHA 的 `release-archive` artifact（内含 `images.tar.gz` 与 `release.json`）。手动部署入口按动作显式调用：

```bash
gh workflow run deploy.yml --repo HeHuoDa/HeHuoDa --ref main \
  -f sha=<完整 40 位 SHA> -f action=prepare
```

`action` 取 `prepare`（默认）、`deploy` 或 `rollback`。`rollback` 只传输受信控制器，不要求 GitHub artifact 仍然存在。CI 成功仅代表部署包可用，并不能证明已连接服务器或已上线。

| 类型     | 名称                                        | 用途                                   |
| -------- | ------------------------------------------- | -------------------------------------- |
| Variable | `DEPLOY_ENABLED`                            | 沿用现有自动部署总开关及原值           |
| Variable | `DEPLOY_ARCHIVE_ACTIVATE`                   | prepare 真实演练通过后由维护者显式开启 |
| Variable | `DEPLOY_PATH`                               | 主机目录，默认 `/opt/hehuoda`          |
| Variable | `DEPLOY_TLS`、`DEPLOY_PUBLIC_URL`           | 原有 TLS 模式及公开入口检查地址        |
| Secret   | `DEPLOY_HOST`、`DEPLOY_PORT`、`DEPLOY_USER` | SSH 主机、端口和部署用户               |
| Secret   | `DEPLOY_KNOWN_HOSTS`                        | 经独立可信渠道核验的主机指纹           |
| Secret   | `DEPLOY_PASSWORD` 或 `DEPLOY_SSH_KEY`       | 两种 SSH 认证方式之一                  |

`DEPLOY_KNOWN_HOSTS` 必须包含目标主机与端口对应的已核验公钥，支持哈希条目及行尾注释。OpenSSH 只使用本次私有信任文件并启用 `StrictHostKeyChecking=yes`，不扫描增加信任、不使用全局信任文件、不自动更新主机密钥。移除旧 SCP Action 专属的算法排名和 fingerprint 参数；rsync 的私有 SSH 包装脚本复用认证、端口与保活，传输时保留 `-T` 并去掉会关闭协议输入的 `-n`，普通远端控制命令仍使用 `-n`。Secrets 不得出现在聊天、Issue、PR 或截图。

## 成功历史、更新失败与回滚

`state/current.json` 记录当前成功版本和最多三个成功版本的历史，保存完整 SHA、交付类型、受管版本目录、有效配置指纹、镜像引用与身份。只有应用健康及公开检查通过后才原子推进。首次迁移必须根据实际运行状态验证并纳管，目录存在不能证明部署成功。

更新前校验旧版本配置指纹、项目/数据库服务、数据卷、网络及运行镜像身份。归档及镜像校验失败时不执行迁移或应用替换；只有全部前置校验通过才进入数据库备份、隔离恢复验证、迁移和应用更新。更新后健康检查失败会尝试按旧配置和旧镜像恢复应用，并报告恢复结果；应用回滚**不自动降级数据库**。数据库结构兼容性仍须单独评估，单实例替换可能短暂中断。

包在 GitHub 过期后，可用服务器保留的三个成功版本按准确 SHA 显式回滚。回滚前验证历史配置及本地镜像身份；旧 digest 版本继续兼容原供应路径。版本既不在服务器保留历史、artifact 也不可获取时明确失败，不重建相同 SHA 冒充原产物。发布成功后，只清理成功历史中登记且路径通过校验的过期项目资源；失败部署不淘汰回滚目标，不删除数据库备份，不执行全局 Docker prune，不触碰未纳管目录。

新受信控制器与目标版本配置分离：以新控制器解释 `current.json`，使用目标版本的 Compose/Nginx/TLS 配置启动对应镜像。旧 `current.json` 若只有单个 previous SHA，先核实真实运行容器、镜像、历史配置和清单；不能把目录直接列为成功历史。证据不足时维持当前应用并停止自动更新。

## HTTP 与 HTTPS

HTTP 测试与正式 HTTPS 分开验收。证书置于主机受控目录，通过 `.env` 的 `TLS_CERT_DIR`、`HTTP_PORT`、`HTTPS_PORT` 配置；Deploy 使用 `DEPLOY_TLS=true` 与 HTTPS 的 `DEPLOY_PUBLIC_URL` 选择 TLS Compose。Nginx 挂载证书只读，以 TLS 1.2/1.3 终止 HTTPS 并将 HTTP 308 跳转。证书在镜像外申请和续期，禁止把私钥烘焙进镜像。续期后先运行 `nginx -t` 再 reload 并检查公开入口；不以跳过 TLS 校验或自签证书代替正式验收。

## 数据库备份与日常运维

发布更新前执行 custom-format `pg_dump`，备份完整写入且通过隔离恢复校验后才继续。恢复校验在新建、无网络、独立匿名卷的临时 PostgreSQL 容器进行；失败阻止迁移和更新。备份不会随版本清理，也不会自动恢复到生产。持久卷不能替代异机备份；异机存储及灾难恢复须单独实际验证。

运行时迁移 CLI 位于 API 镜像。手动维护使用当前成功版本记录的 SHA、镜像与 Compose 目录；不要从当前源码推断历史配置或手工改写 `current.json`。停机使用同一环境配置执行 Compose `stop` 或 `down`；禁止对现有环境使用 `down --volumes`、`volume prune` 或删除数据库目录。进程存活与就绪分别检查 `/api/v1/health` 和 `/api/v1/health/ready`。

H5 由同源 `/api/v1` 提供，静态资源缺失返回 404，API 保持 JSON 错误响应；仅部署 uni H5，不启用旧 `apps/web` 作为另一套常态用户端。微信小程序继续使用独立 API 地址及合法域名，其构建、真机运行和发布不在本 Issue 范围。

## 本地验证与未验收事项

### 2026-10-24 首次真实归档演练

针对 `f951f263bed8c0b34061f2d08a6c25b3963a6e09` 的 [prepare #40096153574](https://github.com/HeHuoDa/HeHuoDa/actions/runs/40096153574) 已完成 runner 上的产物来源与摘要验证，但 129,390,874 字节的 SSH payload 首次传输约 609 秒后超时，第二次尝试期间人工取消。日志没有进入镜像导入或部署控制器，因此未执行数据库迁移、应用替换或成功历史推进；归档激活开关保持关闭。这次结果证明当前传输未通过，不足以判断网络带宽、接收端 I/O 或其他链路因素的具体根因。

[prepare #40102263453](https://github.com/HeHuoDa/HeHuoDa/actions/runs/40102263453) 在 SSH 基础检查通过后，1 MiB 标准输入上传探针 60 秒未成功完成；没有开始完整归档传输、镜像导入或应用更新。该结果仍不足以确定带宽、客户端或远端 SSH 会话的具体根因。之后改用同款 SCP Action 进行小包预检及完整包传输；两仓库目标服务器不同，不能以 iot-pillot 成功证明本项目的目标链路可用。失败或取消后始终尝试清理本次暂存目录与 runner 本地包；不删除已验证版本或其他尝试的目录。前置检查、远端元数据查询与应用操作继续分别限时，控制器只公开固定错误类别、操作和退出码，原始 SSH stderr 不上传公开 artifact。

### 2026-10-25 SCP 成功与后续超时

[prepare #40159311556](https://github.com/HeHuoDa/HeHuoDa/actions/runs/40159311556) 在第一次上传超时后第二次成功，129,431,856 字节 payload 通过校验并导入镜像，日志确认 `application_unchanged=true`。[后续 Deploy #40176834118](https://github.com/HeHuoDa/HeHuoDa/actions/runs/40176834118) 的探针通过，但两次完整上传均达到 10 分钟上限，最终接收校验失败，未执行交付。它们说明链路存在波动、从头重传会浪费已传数据；没有证明服务器双向均限于 3 Mbps。rsync 的目标是复用中断数据和提供可观察性，不保证任意降速下都能完成。

CI 在隔离 loopback SSH 服务器运行真实 rsync，使用不可压缩文件、限制速率并中断第一次传输进程；第二次必须出现匹配复用数据，且新传数据少于完整归档，最终摘要一致。测试还覆盖双主机公钥环境下的严格信任、错误主机密钥、缺少/旧版 rsync、密码和密钥认证、I/O 超时、同长度损坏包拒绝、完整接收复用及清理边界。常规 CI 使用缩小载荷；本地可用 `RSYNC_TEST_LARGE_PAYLOAD=true` 执行约 129 MB、128 KiB/s 的隔离限速验证。原有真实应用镜像与独立数据库的 prepare、失败恢复、无归档回滚和三版保留测试继续保留；隔离结果不能代替生产链路验收。

仓库验证入口为 `pnpm install --frozen-lockfile`、`pnpm test:deployment`、`pnpm format:check`、`pnpm lint` 和 `pnpm test:images`。本地镜像冒烟要求 Docker 可用，并在随机项目名、测试密码和隔离卷内运行；不得连接生产 `.env`。

最终交付须分别报告本地测试、完整远端 CI、artifact 来源和摘要、服务器 `prepare` 演练、激活记录、生产发布与必要的回滚证据。演练未执行时写明待办；不以 CI 通过、PR 合并或 workflow 存在推断服务器状态。Issue #143 全部真实验收完成前保持开放。

rsync over SSH 不需要 rsync 守护进程或额外开放端口。runner 按需安装 rsync/sshpass，服务器只读检查 rsync；双方最低兼容版本为 **3.1**（进度参数兼容门槛），应使用发行版提供的安全更新包。服务器未安装时，以 `dependency-missing` 停止；版本不兼容以 `dependency-version` 停止，不自动安装生产依赖。需由维护者按系统包管理方式安装 rsync，再重新执行 prepare；认证、主机校验或连接失败使用各自类别，不归为缺少依赖。当前实现不修改部署变量、凭据或激活开关，rsync 生产 prepare、正式发布及生产回滚仍需分别验收。
