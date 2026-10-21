# 单机容器部署与恢复

本说明对应 Issue #25。用户端部署 `apps/uni` 的 H5，API 使用 NestJS/Fastify，数据库使用 PostgreSQL。管理端仍是独立前端演示，本方案不开放管理 API、真实登录、业务写入或消息投递；旧 `apps/web` 不作为第二套常态用户端上线。微信小程序产物不放进 Nginx，也不由本工作流上传。

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

构建错误和容器命令错误的 stderr 保存在忽略的 `deploy/state/logs/`，不把环境值及命令参数输出到 CI 日志。日志可能有敏感内容，仅在受控机器查看；不要直接上传 Issue。截图、临时浏览器脚本及验收结果按仓库规则保留本地。

## 主机准备与首次部署

目标是 Linux 单机。服务器需要 Docker Engine、Compose 插件（启用 TLS 叠加配置时至少 `2.24.4`）、Node `24.15.0`、足够存放镜像、数据库及恢复演练副本的磁盘空间，以及有权运行 Docker 的专用部署用户。Docker 组权限等价于管理宿主机，限定该用户及其登录凭据的使用范围。4 GB 内存服务器优先在 CI 构建镜像，服务器只拉取及运行；恢复校验容器限制 512 MiB。

先只读检查已有服务、监听端口、磁盘和 Docker 卷；不要清理其他项目。默认部署目录为 `/opt/hehuoda`，由管理员一次性创建并授予部署用户，目录权限建议 `700`。目录内包含：

```text
/opt/hehuoda/
  .env                 # 仅主机持有的配置，权限 600
  releases/<SHA>/      # 通过检查的部署程序和 Compose
  state/current.json  # 当前/上一应用 SHA
  state/release.lock/ # 串行更新锁
  state/logs/          # 受控诊断
  backups/            # 经隔离恢复校验的数据库 dump
```

从 `deploy/.env.example` 准备主机 `.env`；不得覆盖开发配置或沿用开发密码。必填 `POSTGRES_USER`、`POSTGRES_DB`、随机强密码 `POSTGRES_PASSWORD`、`DATABASE_URL`、`IMAGE_PREFIX` 和检查通过的完整 40 位 `IMAGE_TAG`。数据库连接必须使用 `db:5432`，用户、密码、库名必须与 `POSTGRES_*` 一致，URL 密码须编码。程序会核对一致性，缺失配置明确失败，不输出配置内容。首次初始化数据库后，修改 `.env` 密码不会替换已有 PostgreSQL 密码，密码轮换需要单独维护操作。

`IMAGE_PREFIX` 默认示例是 `ghcr.io/hehuoda/hehuoda`；镜像名为 `/api:<SHA>` 和 `/web:<SHA>`。私有包需要在服务器上以有 `read:packages` 的最小权限账号执行 `docker login ghcr.io --password-stdin`。先确认服务器可以访问镜像仓库；中国大陆网络访问失败时，另行确定受控镜像分发渠道，不擅自改源或把凭据写入配置。

无域名的测试环境可将 `HTTP_BIND` 设为 `0.0.0.0`、`HTTP_PORT` 设为 `80` 或其他明确空闲端口，并只开放相应安全组/防火墙入口。数据库 5432 和 API 3001 不需要公网放行。未明确公网访问时保留默认回环绑定。

在包含部署程序的源码目录执行（SHA 替换成真实已通过检查且已分发镜像的提交）：

```bash
export DEPLOY_ENV_FILE=/opt/hehuoda/.env
export DEPLOY_STATE_DIR=/opt/hehuoda/state
export DEPLOY_BACKUP_DIR=/opt/hehuoda/backups
export DEPLOY_PUBLIC_URL=http://your-server-ip
node deploy/release.mjs <40位SHA>
```

部署程序先验证配置和锁，拉取准确 SHA 的镜像，启动数据库；已有数据时先备份并在隔离数据库恢复校验，再执行尚未应用的迁移，最后更新 API/Nginx，检查就绪和学院/比赛查询。配置 `DEPLOY_PUBLIC_URL` 时还会从部署机请求公开入口。生产不执行导入或比赛发布，采集默认关闭；维护者评估来源及运行条件后才可显式打开 `INGESTION_ENABLED`。

首次部署失败会明确报告不存在旧应用，保留数据库与诊断。已存在 API 容器但缺少 `state/current.json` 时拒绝自动接管：先核对 API/Web 镜像、环境、卷和真实 SHA，再由管理员建立准确状态，不能随意伪造版本记录。锁未释放时不要删除另一个发布进程的锁；确认原进程退出、容器与状态一致后才人工移除残留锁。

## GitHub Actions

`CI` 先运行现有全仓质量检查和部署流程测试，再以只读 token 构建真实镜像并运行冒烟。仅 `main` push 将通过检查的镜像保存为当前运行的短期 artifact；独立 `publish-images` 任务加载这些相同镜像并推送 SHA 标签，不检出源码或执行仓库脚本。只有该任务具有包写权限。`ci-gate` 要求质量与镜像检查成功，主分支 push 还必须发布成功；PR 的发布任务跳过且没有包写权限。

`Deploy` 由成功的 `main` push CI 完成事件触发，兼容自动合并产生的主分支 push；也可手动输入完整 SHA 重试。手动发布同样检查该 SHA 存在成功的 `main` push CI。更新在 GitHub concurrency 与主机目录锁两层串行执行，不取消进行中的更新。同一已部署 SHA 只做检查，不重复迁移。质量检查与部署 SHA 不一致时不发布。

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

自动发布以 `state/current.json` 为当前版本来源，不改写存放凭据的 `.env`。因此每次手动维护前，先从状态文件设置 `IMAGE_TAG`，避免重启时误用 `.env` 中首次部署的旧版本；`backup.mjs` 在没有显式标签时也会读取此状态。

```bash
export IMAGE_TAG=$(node -p "require('/opt/hehuoda/state/current.json').sha")
docker compose --env-file /opt/hehuoda/.env -f compose.deploy.yaml ps
docker compose --env-file /opt/hehuoda/.env -f compose.deploy.yaml logs --tail 100 api web
docker compose --env-file /opt/hehuoda/.env -f compose.deploy.yaml exec -T api node dist-openapi/scripts/migrate.js
```

导入先将人工核对 JSON 只读挂到一次性 API 容器，再运行 `node dist-openapi/scripts/import.js /input/batch.json --preview`；核对差异后单独运行同一文件，涉及已发布记录时使用既有 `--confirm-published` 门禁。参数、业务约束和采集 CLI 见 README 的比赛导入与采集章节。镜像启动及自动部署不包含这些发布操作。

停机使用同一环境配置执行 `docker compose ... stop` 或 `down`；重新 `up -d --wait` 保留数据库卷。禁止对现有环境使用 `down --volumes`、`volume prune` 或删除数据库目录。进程存活与就绪分别是 `/api/v1/health`、`/api/v1/health/ready`；后者检查数据库、当前应用所需迁移和必要表字段，失败只返回安全状态/requestId 及 503。

H5 HTML 使用 `no-store`，构建指纹资源长期 immutable 缓存，普通静态资源重新校验。缺失静态文件返回 404，未知 API 返回 API 的 JSON 404，均不落入首页。Nginx 使用基础镜像自带的 njs 模块，将注册的旧 Web History 路径（含末尾斜杠）重定向到对应 uni hash 页面。详情 `id`、我的队伍/申请 `section` 以路径为准，移除查询串中重复或编码的冲突键，其余参数保留原编码与重复值；完整浏览器返回、非法参数和路由兼容验收仍按 #82 执行，不以 HTTP 302 检查替代页面交互验收。

## 备份、异机保存及恢复

持久卷保证容器重建后的数据保留，不能替代备份。发布更新前自动执行 custom-format `pg_dump`；备份先完整写入权限为 600 的新文件，成功后才进入恢复校验。恢复目标是新建、无网络、带专用匿名卷的临时 PostgreSQL 容器，校验迁移和关键业务表可读；完成后核对任务标签，只删除这个容器与其匿名卷。失败阻止迁移和更新。备份文件不会自动删除，也不会自动恢复到生产。

手动备份或验证已有 dump（环境变量与前面的部署命令相同）：

```bash
node deploy/backup.mjs
node deploy/backup.mjs verify /opt/hehuoda/backups/实际文件.dump
sha256sum /opt/hehuoda/backups/实际文件.dump
```

由维护者将备份复制到独立机器或受限对象存储，校验两端 SHA256 一致，并在独立机器实际执行恢复校验。记录备份时间、对应应用 SHA、文件摘要、异机位置、恢复结果与维护者，不记录密码。当前程序只保证本机备份和隔离恢复，尚未配置异机存储时不能声称灾难恢复完成。制定容量和保留周期，至少保留最近成功发布前的备份；清理备份须另行确认，不在应用发布时自动删历史数据。

生产恢复需人工制定停写窗口并先备份当前现场。推荐先建立使用独立项目名、独立配置和新卷的恢复环境，只启动它的 `db`，通过 `pg_restore --exit-on-error --no-owner --no-acl` 将 dump 导入空库，再用准确应用 SHA 启动并验证关键记录及 API；保留原库，核实后再切换入口。不要把恢复命令直接指向在线生产库，也不使用 `--clean` 自动覆盖它。

## 更新失败与应用回滚

就绪、真实查询或配置的公开入口检查失败时，发布脚本恢复 `state/current.json` 中旧 SHA 的 API/Web 镜像，再验证恢复结果。未成功前不推进状态文件。回滚失败明确报告 `ROLLBACK FAILED`，保留数据库、备份和诊断，转入人工处理。更新过程可能短暂中断，不承诺零停机。

需要手动回到旧应用时，使用仍然兼容当前数据库且已通过原 CI 的旧 SHA 重新运行发布。迁移历史只追加，旧应用允许库中存在额外的新迁移记录，但仍检查自身需要的表字段。应用回滚不删除迁移记录、不自动执行数据库降级或恢复旧 dump。新增迁移必须评估旧版本兼容性；破坏性结构变更应另行制定维护和数据恢复计划。

## 迁移与未验收事项

部署复用现有 H5 源码和视觉，不增加 DOM、客户端服务器采集或跨应用导入。微信端继续使用独立完整 HTTPS API 地址与合法域名，不能复用 H5 的相对基址或把 IP HTTP 测试视作微信兼容。证书/域名/真机资源交接在 #58，运行及发布验收在后续对应任务；需要时可按 `docs/agents/pull-requests.md` 的微信开发者工具流程人工验收，本次容器化不替代它。

实际交付记录须分别写明源码检查、真实镜像冒烟、浏览器视口/页面、隔离测试目标发布与失败恢复、真实服务器发布、TLS、异机备份和真机是否执行。任何未执行项保持未完成，不因代码合并或工作流存在就关闭整票。
