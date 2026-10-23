# 单机容器部署与恢复

本说明对应 Issue #25。用户端部署 `apps/uni` 的 H5，API 使用 NestJS/Fastify，数据库使用 PostgreSQL。管理端仍是独立前端演示，本方案不开放管理 API、真实登录、业务写入或消息投递；旧 `apps/web` 不作为第二套常态用户端上线。微信小程序产物不放进 Nginx，也不由本工作流上传。

## 已核实的交付记录（2026-10-23）

源码基线为远端 main `4dae578c38465993949538839a559100d4c11150`。[PR #120](https://github.com/HeHuoDa/HeHuoDa/pull/120) 的容器化基础与 [PR #121](https://github.com/HeHuoDa/HeHuoDa/pull/121) 的发布触发／digest／恢复防护已合并；[Issue #25](https://github.com/HeHuoDa/HeHuoDa/issues/25) 仍开放。

| 证据                                                                                        | 实际状态                                               | 可证明范围                                                                                                                             |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| [main CI 39733924690](https://github.com/HeHuoDa/HeHuoDa/actions/runs/39733924690)          | quality、image-smoke、publish-images、ci-gate 全部成功 | 当前 SHA 的完整工作区门禁、真实镜像隔离冒烟及 GHCR 发布成功；存在 `release-images-4dae578c38465993949538839a559100d4c11150-2` 清单产物 |
| [自动 Deploy 39740192347](https://github.com/HeHuoDa/HeHuoDa/actions/runs/39740192347)      | deploy Job skipped                                     | 当次未执行部署；不能据此推断后续开关或服务器状态                                                                                       |
| [手动 Deploy 39771854939](https://github.com/HeHuoDa/HeHuoDa/actions/runs/39771854939)      | deploy Job 及传输部署步骤 success                      | 已有远端传输与部署执行成功记录，不能继续写“从未部署”；不等于本次独立核验服务器在线与完整生产验收                                       |
| [Release recovery 39871463294](https://github.com/HeHuoDa/HeHuoDa/actions/runs/39871463294) | 定时运行 success                                       | 恢复检查已运行；不单独证明本轮补发了 CI、连接服务器或部署新版本                                                                        |

以上来自本次只读回查的 Actions Job／步骤和产物元数据。本次没有登录服务器、读取其受控配置或执行发布，也没有独立验证实际入口、正式 TLS 及续期、异机备份与恢复、故障回滚或微信运行。环境变量和 Secrets 的当前配置未读取；下文默认开关与配置步骤是操作规则，不能作为“目前未启用”的状态结论。#25 收尾按真实环境逐项核验，H5 切流／回滚和微信发布仍分别归 #88／#89。

## 环境与交付边界

- `compose.yaml` / `compose.override.yaml` 保留原有开发及测试数据库，不与本方案叠加。
- `compose.deploy.yaml` 为独立部署入口；每个环境使用独立 `COMPOSE_PROJECT_NAME`、配置文件和数据库卷。数据库及 API 不映射宿主机端口，只有 Nginx 映射端口，默认绑定回环地址。
- Node 固定为 `24.15.0`，pnpm 固定为 `10.30.3`，PostgreSQL 固定为 `17.10-bookworm`，Nginx 固定为 `1.30.0-alpine`。同一源码多阶段构建，锁文件安装，API 运行层只复制运行依赖、编译产物和迁移；H5 运行层只复制静态资源和代理配置。
- H5 固定使用同源 `/api/v1`。无域名时可用公网 IP 做 HTTP 测试部署；这不代表 HTTPS、微信合法域名或正式发布验收完成。
- 本地构建、镜像冒烟、隔离测试目标、真实生产分别记录。新增代码和工作流不代表已经在真实云服务器执行。云服务器连接、正式证书、备份异机保存及生产发布需在相应环境实际验证。

API 没有工作区包运行依赖。pnpm 10 的便携生产打包仅在该命令中启用 `inject-workspace-packages`，从已有工作区锁文件派生专用锁文件，并强制 `--offline --frozen-lockfile`；不使用会重新解析依赖的 legacy deploy，不修改仓库的 pnpm 工作区布局或 DCloud peer 配置。BuildKit 缓存同时挂载到获取、安装和打包阶段。

## 本机隔离镜像验收

要求本机 Docker Engine 可用；Windows Docker CLI 不在 PATH 时，通过 `DOCKER_BIN` 指定完整路径。使用 Node `24.15.0`：

```bash
pnpm install --frozen-lockfile
pnpm test:deployment
pnpm test:images
```

`test:images` 使用随机项目名、随机测试密码、仅绑定回环的随机端口和独立数据卷，不读取生产 `.env`；退出时只删除自己创建的测试项目及卷。它会实际构建镜像，检查无迁移时 503、重复迁移、公开查询与详情、H5/静态缓存、旧 History 地址、缺失静态资源和未知 API、数据库断开/恢复、进程崩溃后的 Docker 重启、整栈重建的数据保留，以及备份到隔离容器的恢复。最小比赛 fixture 仅进入隔离测试库。

构建错误和容器命令错误的原始 stderr 保存在 `DEPLOY_STATE_DIR/logs/` 下权限为 600 的日志中，不把环境值、命令参数或容器原始日志输出到 CI。未指定状态目录的本机冒烟使用被忽略的 `deploy/state/<随机项目名>/`，测试容器清理后仍保留诊断，不读取已有部署状态；CI 使用 runner 临时目录。每个错误另外生成只含固定操作类别、退出码和固定错误分类的 JSON 报告，不包含 stderr、参数、环境或业务数据；失败时仅上传这些 JSON，保留 7 天。未分类错误仍需在受控机器复现并查看原始日志，不应扩大上传范围。截图、临时浏览器脚本及验收结果按仓库规则保留本地。

## 主机准备与首次部署

目标是 Linux 单机。服务器需要 Docker Engine、Compose 插件（启用 TLS 叠加配置时至少 `2.24.4`）、Node `24.15.0`、足够存放镜像、数据库及恢复演练副本的磁盘空间，以及有权运行 Docker 的专用部署用户。Docker 组权限等价于管理宿主机，限定该用户及其登录凭据的使用范围。4 GB 内存服务器优先在 CI 构建镜像，服务器只拉取及运行；恢复校验容器限制 512 MiB。

先只读检查已有服务、监听端口、磁盘和 Docker 卷；不要清理其他项目。默认部署目录为 `/opt/hehuoda`，由管理员一次性创建并授予部署用户，目录权限建议 `700`。目录内包含：

```text
/opt/hehuoda/
  .env                 # 仅主机持有的配置，权限 600
  releases/<SHA>/<run>-<attempt>/ # 部署程序、Compose 与 release.json；不覆盖已有目录
  state/current.json  # 当前/上一 SHA、版本目录、镜像 digest、TLS 模式、检查 URL、配置指纹
  state/release.lock/ # 串行更新锁
  state/logs/          # 受控诊断
  backups/            # 经隔离恢复校验的数据库 dump
```

从 `deploy/.env.example` 准备主机 `.env`；不得覆盖开发配置或沿用开发密码。必填 `POSTGRES_USER`、`POSTGRES_DB`、随机强密码 `POSTGRES_PASSWORD`、`DATABASE_URL`、`IMAGE_PREFIX` 和检查通过的完整 40 位 `IMAGE_TAG`。数据库连接必须使用 `db:5432`，用户、密码、库名必须与 `POSTGRES_*` 一致，URL 密码须编码。程序会核对一致性，缺失配置明确失败，不输出配置内容。首次初始化数据库后，修改 `.env` 密码不会替换已有 PostgreSQL 密码，密码轮换需要单独维护操作。

`IMAGE_PREFIX` 默认示例是 `ghcr.io/hehuoda/hehuoda`；镜像名为 `/api:<SHA>` 和 `/web:<SHA>`。私有包需要在服务器上以有 `read:packages` 的最小权限账号执行 `docker login ghcr.io --password-stdin`。先确认服务器可以访问镜像仓库；中国大陆网络访问失败时，另行确定受控镜像分发渠道，不擅自改源或把凭据写入配置。

无域名的测试环境可将 `HTTP_BIND` 设为 `0.0.0.0`、`HTTP_PORT` 设为 `80` 或其他明确空闲端口，并只开放相应安全组/防火墙入口。数据库 5432 和 API 3001 不需要公网放行。未明确公网访问时保留默认回环绑定。

在完整版本目录执行，目录必须包含该 SHA 的源码部署文件及成功 CI 保存的 `release.json`。从对应成功运行下载 `release-images-<SHA>-<attempt>` artifact，确认来源仓库、运行 SHA 和 `publish-images` 成功，再将清单放到该版本目录根部；不要从当前可变标签反推历史清单。SHA 替换成真实已通过检查且已分发镜像的提交：

```bash
export DEPLOY_ENV_FILE=/opt/hehuoda/.env
export DEPLOY_STATE_DIR=/opt/hehuoda/state
export DEPLOY_BACKUP_DIR=/opt/hehuoda/backups
export DEPLOY_PUBLIC_URL=http://your-server-ip
node deploy/release.mjs <40位SHA>
```

部署程序先验证锁、清单及配置，API/Web 按清单 digest 拉取，标签后续移动不改变部署内容。已有版本时先验证其保留目录、清单和有效配置指纹，再比较两个版本的 Compose 项目名、数据库服务、卷和网络定义；这些共享配置变化拒绝走普通应用发布，需要单独审核维护方案。启动数据库后，已有数据先备份并在隔离数据库恢复校验，再执行尚未应用的迁移，最后重建 API/Nginx 并检查就绪和业务查询；即使 Web digest 未变化也重建 Nginx，以刷新 API 地址。配置 `DEPLOY_PUBLIC_URL` 时还会从部署机请求公开入口。生产不执行导入或比赛发布，采集默认关闭。

首次部署失败会明确报告不存在旧应用，保留数据库与诊断。已存在 API 容器但缺少 `state/current.json` 时拒绝自动接管：先核对 API/Web 镜像、环境、卷和真实 SHA，再由管理员建立准确状态，不能随意伪造版本记录。锁未释放时不要删除另一个发布进程的锁；确认原进程退出、容器与状态一致后才人工移除残留锁。

## GitHub Actions

`CI` 先运行现有全仓质量检查和部署流程测试，再以只读 token 构建真实镜像并运行冒烟。仅 `main` 的 push 或 `workflow_dispatch` 将通过检查的镜像保存为当前运行的短期 artifact；独立 `publish-images` 任务加载这些相同镜像并推送 SHA 标签，不检出源码或执行仓库脚本。只有该任务具有包写权限。`ci-gate` 要求质量与镜像检查成功，主分支发布还必须发布成功；PR 和非 main 分支的手动运行不发布镜像。

镜像包使用 `verified-images-<SHA>-<attempt>` 独立名称，上传产出的 artifact ID 作为 `image-smoke` job 输出，publisher 按该 ID 下载。整次重跑不会与旧 artifact 重名；只重跑失败的 publisher 时使用成功生产任务保留的输出，不用当前 attempt 猜测生产任务所在轮次。若原镜像包已过期，应新提交发布，不能以同名新包替换旧凭证。

PR 按编号加 SHA 分组，main 按 SHA 分组；旧 SHA 重跑不会取消或挤掉新 SHA 检查，同一 PR/SHA 的重复运行可以取消。代价是旧提交的检查可能继续运行；自动合并仍校验 PR 当前 head，旧结果不能合并新提交。main 同一 SHA 串行且不取消正在发布的运行。

发布前通过受认证的 GHCR API 检查两个目标标签。所有已存在镜像都必须与本次验证 artifact 的 image ID 一致，才允许保留或补齐缺失项；完整镜像对也不例外。网络、认证或服务错误不当作缺失。推送后拉取 Registry 返回的 digest 引用，再次核对镜像 ID，并生成包含准确 SHA 和两个 digest 引用的 `release.json`，保存为每个 attempt 独立的 artifact，申请保留 90 天（受仓库上限限制）。同 SHA 重新构建可能产生不同镜像，此时停止；在原镜像 artifact 的 1 天保留期内仅重跑原 publisher，或使用新提交重新发布，不删除/覆盖标签来绕过校验。

`Auto-merge` 使用 `GITHUB_TOKEN` 合并时，产生的 push 不会再触发普通 CI。确认 PR 实际合并后，它会显式 dispatch 默认分支 CI；这个调用需要 `actions: write`，但自动合并任务仍不检出或执行 PR 代码。尚未实际合并时不触发发布；来源分支是否可删除不影响 dispatch，触发失败会报错并保留分支。CI 固定本次 dispatch 的 main SHA，质量检查、镜像构建与发布均使用同一 SHA；main CI 不满足自动合并任务的 PR 事件条件，不会递归触发。

`Deploy` 由成功的 main push/手动 CI 完成事件触发，也可从 main 手动输入完整 SHA。自动候选取得执行位后读取实时 main，已被取代时跳过；只有显式手动部署允许旧 SHA 回滚。必须找到该 SHA 的成功 main CI、未过期的 digest artifact，以及该 artifact 对应 attempt 的成功 publisher（通过 `/runs/{id}/attempts/{attempt}/jobs` 核验，不依赖 job 对象的扩展字段）。下载后校验 SHA、两个组件和仓库路径，随后才连接服务器。缺少、过期或不合法的清单均停止，不回退到标签部署。旧版仅有 CI 成功记录的 SHA 也不能绕过此要求；清单与 CI 证据须提前异机保存，超出保留期按受控主机恢复流程处理。

更新在 GitHub concurrency 与主机目录锁两层串行执行，不取消进行中的更新。部署队列显式使用 `queue: max`，避免较晚完成的旧 SHA CI 挤掉正在等待的新版本；GitHub 最多保留 100 个等待运行，满队列或定时任务延误时需维护者核对并手动重试当前 main。同一已部署 SHA 只做检查，不重复迁移；若要求改变 TLS 模式或检查 URL 则明确拒绝，不能把一次健康检查误当配置更新成功，应另行安排配置维护或新版本发布。质量检查与部署 SHA 不一致时不发布。

`Release recovery` 在默认分支按每 15 分钟的计划检查当前 main，补偿合并队列或保护规则导致的延迟合并：只有该 SHA 完全没有 push/手动 CI 记录时才 dispatch。排队中、运行中、成功、失败或取消的已有运行都会阻止自动补发，因此不会因失败持续重试；失败后需要维护者明确重试。它不检出代码，不访问服务器，仍通过 CI 的完整验证与既有部署开关。GitHub 定时任务可能延迟，长期不活跃的公开仓库也可能被停用定时任务，不能将这个周期视作发布时限；急需发布时可手动运行该恢复工作流或直接运行 main CI。

自动合并后的 CI 没有启动、dispatch 失败或需要重试时，在已登录且有工作流运行权限的维护机执行（不是服务器初始化必装项）：

```bash
gh workflow run ci.yml --repo HeHuoDa/HeHuoDa --ref main
gh run list --repo HeHuoDa/HeHuoDa --workflow ci.yml --branch main \
  --event workflow_dispatch --limit 5 \
  --json databaseId,headSha,status,conclusion,url
```

使用列表中对应运行的 `headSha`，并查看该运行的 jobs，确认整体成功及 `publish-images` 成功后才把它作为部署 SHA。仅知道 Git 提交 SHA 不代表镜像已经发布。若自动合并仍在等待保护规则或合并队列，等待实际合并后由恢复工作流补发或手动重试 main CI，不以旧 main 的成功结果代表新改动已发布。手动 main CI 与正常发布遵循同一部署开关；已启用生产自动部署时，重试前确认发布窗口。

默认 `DEPLOY_ENABLED` 未开启，因此添加本工作流不会自动连接服务器。在 GitHub 的 `production` Environment 配置审核规则、以下环境变量与 Secrets，并完成主机交接后，将仓库级变量 `DEPLOY_ENABLED=true`。开关须使用仓库级变量，因为任务调度判断发生在环境变量加载前。只有生产维护者应有权修改这些设置。

| 类型     | 名称                                        | 用途                                                                      |
| -------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| Variable | `DEPLOY_ENABLED`                            | 明确启用，值为 `true`                                                     |
| Variable | `DEPLOY_PATH`                               | 主机目录，默认 `/opt/hehuoda`，仅绝对路径及字母数字、下划线、斜杠、连字符 |
| Variable | `DEPLOY_PUBLIC_URL`                         | 实际入口；TLS 模式必填 HTTPS 地址                                         |
| Variable | `DEPLOY_TLS`                                | `true` 启用证书叠加配置，其他情况用 `false`                               |
| Secret   | `DEPLOY_HOST`、`DEPLOY_PORT`、`DEPLOY_USER` | SSH 主机、端口（默认 22）与部署用户                                       |
| Secret   | `DEPLOY_KNOWN_HOSTS`                        | 已经通过云控制台或独立可信渠道核对指纹的 OpenSSH known_hosts 完整行       |
| Secret   | `DEPLOY_PASSWORD`                           | 密码登录时配置；不放进命令参数和仓库                                      |
| Secret   | `DEPLOY_SSH_KEY`                            | 密钥登录的替代配置，与 `DEPLOY_PASSWORD` 必须且只能配置一个               |

SSH 始终验证主机密钥。`ssh-keyscan` 的采样本身不能证明服务器身份；必须与腾讯云浏览器终端等可信渠道的主机指纹核对后才保存 known_hosts。密码模式通过 runner 的 `sshpass -e` 传递，不要求修改服务器为密钥登录。Secrets 不应出现在聊天、Issue、PR 或截图里。数据库及镜像仓库凭据只在主机受控配置，不随源码上传。

## HTTPS

HTTP 测试与正式 HTTPS 分开验收。准备受信任证书，将实际 `fullchain.pem`、`privkey.pem` 放在主机受控绝对目录，设置 `.env` 的 `TLS_CERT_DIR`、`HTTP_PORT=80`、`HTTPS_PORT=443` 与所需绑定地址；通过 `DEPLOY_TLS=true`、`DEPLOY_PUBLIC_URL=https://实际域名` 运行发布。Nginx 挂载证书只读，443 终止 TLS，80 返回 308 跳转；只允许 TLS 1.2/1.3。Compose 叠加文件不改变数据库卷。

```bash
DEPLOY_TLS=true docker compose --env-file /opt/hehuoda/.env \
  -f compose.deploy.yaml -f compose.tls.yaml config --quiet
```

上面的环境变量供部署脚本选择叠加文件；手动 Compose 必须同时写两个 `-f`。证书通过经核准的 ACME 客户端/DNS-01 或云证书平台在镜像外申请、续期，不能把私钥烘焙进镜像。当前配置不内置 HTTP-01 挑战处理；选择 HTTP-01 时须另外配置挑战入口。续期应原子替换证书文件，随后对使用相同 `.env` 和叠加配置的 `web` 执行 `nginx -t`，通过后 `nginx -s reload`，并检查公开 HTTPS；更新失败保留有效证书。不要用跳过 TLS 校验或自签证书冒充正式验收。

TLS 叠加依赖当前版本发布目录中的 `deploy/nginx/https.conf`，工作流会一起传输。API 生产默认不注册 Swagger/OpenAPI 文档，Nginx 对 `/docs` 和 `/docs-json` 额外返回 404；不因部署开放管理文档。

## 数据导入与日常运维

迁移与导入 CLI 已包含在 API 镜像，运行时无需 pnpm 或重新编译。以下例子以保护好的 `.env` 和准确 `IMAGE_TAG` 为前提，TLS 环境增加 `-f compose.tls.yaml`：

自动发布以 `state/current.json` 为当前版本来源，不改写存放凭据的 `.env`。手动维护先进入记录的版本目录，并设置该状态中的 SHA、两个 digest 及 TLS 模式，避免误用当前源码配置或旧标签；`backup.mjs` 的 Compose 调用会自动读取已记录版本的目录和镜像。

```bash
export IMAGE_TAG=$(node -p "require('/opt/hehuoda/state/current.json').sha")
export API_IMAGE=$(node -p "require('/opt/hehuoda/state/current.json').images.api")
export WEB_IMAGE=$(node -p "require('/opt/hehuoda/state/current.json').images.web")
cd "$(node -p "require('/opt/hehuoda/state/current.json').releaseDirectory")"
docker compose --env-file /opt/hehuoda/.env -f compose.deploy.yaml ps
docker compose --env-file /opt/hehuoda/.env -f compose.deploy.yaml logs --tail 100 api web
docker compose --env-file /opt/hehuoda/.env -f compose.deploy.yaml exec -T api node dist-openapi/scripts/migrate.js
```

导入先将人工核对 JSON 只读挂到一次性 API 容器，再运行 `node dist-openapi/scripts/import.js /input/batch.json --preview`；核对差异后单独运行同一文件，涉及已发布记录时使用既有 `--confirm-published` 门禁。参数、业务约束和采集 CLI 见 README 的比赛导入与采集章节。镜像启动及自动部署不包含这些发布操作。

停机使用同一环境配置执行 `docker compose ... stop` 或 `down`；重新 `up -d --wait` 保留数据库卷。禁止对现有环境使用 `down --volumes`、`volume prune` 或删除数据库目录。进程存活与就绪分别是 `/api/v1/health`、`/api/v1/health/ready`；后者检查数据库、当前应用所需迁移和必要表字段，失败只返回安全状态/requestId 及 503。

H5 HTML 使用 `no-store`，构建指纹资源长期 immutable 缓存，普通静态资源重新校验。缺失静态文件返回 404，未知 API 返回 API 的 JSON 404，均不落入首页。`deploy/nginx/app-locations.inc` 优先代理 `/api/`，隔离 `/assets/`、`/static/` 及文件扩展名请求，最后用 `try_files $uri $uri/ /index.html` 承接历史 pathname 与未知页面。仅部署 uni H5 产物即可，不启动旧 Web、不用 302 重写旧业务地址、不再维护 Nginx 业务路由表。HTTP 请求不携带赛段 fragment，必须让浏览器入口按 `sourceRoutes` 一次性转换 pathname、query、锚点；这样 `/home/competitions/:id#赛段ID` 才不会丢定位信息。未知页面由 H5 404 呈现，HTTP 状态为 SPA 回退的 200；缺失资源及 API 不得返回该 HTML。#25/#88 部署与回滚时须一起使用此版本的 H5 和 Nginx 配置，不能把旧 njs 重定向 include 搭配新客户端；旧版本镜像仍可整体回滚。完整浏览器返回、参数和定位由 #82 验证，HTTP 检查不代替页面验收。

## 备份、异机保存及恢复

持久卷保证容器重建后的数据保留，不能替代备份。发布更新前自动执行 custom-format `pg_dump`；备份先完整写入权限为 600 的新文件，成功后才进入恢复校验。恢复目标是新建、无网络、带专用匿名卷的临时 PostgreSQL 容器，校验迁移和关键业务表可读；完成后核对任务标签，只删除这个容器与其匿名卷。失败阻止迁移和更新。备份文件不会自动删除，也不会自动恢复到生产。

生产数据库健康检查和隔离恢复校验均等待容器内部 `127.0.0.1` 的 TCP 就绪，不使用默认 Unix socket 判断首次初始化完成。官方 PostgreSQL 镜像会先运行只监听 socket 的临时初始化服务，随后关闭并启动正式服务；把临时服务当作就绪会导致迁移或恢复恰好撞上重启。

手动备份或验证已有 dump（环境变量与前面的部署命令相同）：

```bash
node deploy/backup.mjs
node deploy/backup.mjs verify /opt/hehuoda/backups/实际文件.dump
sha256sum /opt/hehuoda/backups/实际文件.dump
```

由维护者将备份复制到独立机器或受限对象存储，校验两端 SHA256 一致，并在独立机器实际执行恢复校验。记录备份时间、对应应用 SHA、文件摘要、异机位置、恢复结果与维护者，不记录密码。当前程序只保证本机备份和隔离恢复，尚未配置异机存储时不能声称灾难恢复完成。制定容量和保留周期，至少保留最近成功发布前的备份；清理备份须另行确认，不在应用发布时自动删历史数据。

生产恢复需人工制定停写窗口并先备份当前现场。推荐先建立使用独立项目名、独立配置和新卷的恢复环境，只启动它的 `db`，通过 `pg_restore --exit-on-error --no-owner --no-acl` 将 dump 导入空库，再用准确应用 SHA 启动并验证关键记录及 API；保留原库，核实后再切换入口。不要把恢复命令直接指向在线生产库，也不使用 `--clean` 自动覆盖它。

## 更新失败与应用回滚

就绪、真实查询或公开入口检查失败时，发布脚本使用旧状态保留的 Compose 目录、API/Web digest、TLS 模式恢复，再以旧检查 URL 验证。检查 URL 不会修改或恢复实际端口/DNS。回滚不混用新 Compose；同 SHA 不得替换已记录 digest。未成功前不推进状态文件，失败恢复也不删除候选目录和备份。旧版本目录、清单及其引用的 TLS 文件必须保留；不要在普通发布时清理。回滚失败明确报告 `ROLLBACK FAILED`，转入人工处理；更新可能短暂中断，不承诺零停机。

成功状态保存完整有效 Compose 配置的 SHA256 指纹：递归排序对象键，原始 JSON 仅在内存处理，不将环境秘密存入状态或日志。下次用旧版本目录、旧 TLS 模式及当前主机 `.env` 重算；指纹不一致时在拉取/启动/迁移前停止。因此端口、绑定地址、挂载目录或密码等 `.env` 变更须走独立维护，普通发布不会自动回滚 `.env`。指纹只覆盖配置值，不检测同路径证书内容、DNS 或其他文件内容变化；证书轮换和数据库升级也需独立验证。

旧 `current.json` 若只有 SHA，缺版本目录、有效清单或配置指纹，更新会在拉取/迁移前拒绝。维护者须核对实际容器镜像 digest、原版本 Compose、TLS/入口、项目名和卷，并从可信原 CI 恢复对应清单，建立与实际运行一致的版本记录和配置指纹；旧 Compose 不支持 digest 覆盖时还需安排受控切换。缺少历史证据时保持旧应用运行并制定人工接管方案，禁止拿当前标签或新配置伪造旧版本记录。

需要手动回到旧应用时，使用仍然兼容当前数据库且已通过原 CI 的旧 SHA 重新运行发布。迁移历史只追加，旧应用允许库中存在额外的新迁移记录，但仍检查自身需要的表字段。应用回滚不删除迁移记录、不自动执行数据库降级或恢复旧 dump。新增迁移必须评估旧版本兼容性；破坏性结构变更应另行制定维护和数据恢复计划。

## 迁移与未验收事项

部署复用现有 H5 源码和视觉，不增加 DOM、客户端服务器采集或跨应用导入。微信端继续使用独立完整 HTTPS API 地址与合法域名，不能复用 H5 的相对基址或把 IP HTTP 测试视作微信兼容。证书/域名/真机资源交接在 #58，运行及发布验收在后续对应任务；需要时可按 `docs/agents/pull-requests.md` 的微信开发者工具流程人工验收，本次容器化不替代它。

实际交付记录须分别写明源码检查、真实镜像冒烟、浏览器视口/页面、隔离测试目标发布与失败恢复、真实服务器发布、TLS、异机备份和真机是否执行。任何未执行项保持未完成，不因代码合并或工作流存在就关闭整票。
