# 禾伙搭

禾伙搭面向四川农业大学学生，提供校园比赛信息查询。桌面管理端位于 `apps/admin`，后端 API 位于 `apps/api`。用户端 `apps/uni` 已具备 H5 游客浏览能力，交付目标为 H5 与 Android 签名 APK。M2 将使用项目已有连接器接入川农统一身份认证，作为两端的唯一用户登录方式。站内组队、后台治理接线与 27 院采集规模化运营暂缓。平台范围及历史账号决策见 [ADR 0011](docs/adr/0011-android-h5-and-sicau-only-auth.md)。

## 当前状态与路线图（2026-11-18）

基线源码核查自 `main`（`e88901c1689816d7fa123f9459496a66f239d3ba`），GitHub 任务状态以 [GitHub Issues](https://github.com/HeHuoDa/HeHuoDa/issues) 为准。下表严格区分“已合并源码/本地测试”与“待交付/待真实验收”：

| 模块          | 已实现基础                                                                                                                               | 当前边界与待交付任务                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 架构与契约    | 确立 Android/H5 与川农唯一登录决策（[ADR 0011](docs/adr/0011-android-h5-and-sicau-only-auth.md)），同步全套现行文档与 `GLOSSARY.md`      | M0 契约基准已冻结；外部环境条件（签名、测试机、学校认证复核、生产域名）由 #58 统筹推进                                                                   |
| 用户端（uni） | `apps/uni` 已具备跨端导航骨架、主题与表单/学院/资源组件、真实比赛公开列表/详情/来源动作、仅本次会话有效的临时收藏及暂缓前演示入口        | #214 收口暂缓组队与模拟登录入口；#84 执行 M1 H5 浏览器验收；#219/#220/#222/#226 推进 Android 构建、Keystore 安全存储与真机；#224 清理微信残余分支        |
| 认证与会话    | `@hehuoda/sicau-connectors/auth` 连接器、校园认证事务与 AES-256-GCM 资料/HMAC 绑定（`0005_campus.sql`）、会话轮换底座（`0004_auth.sql`） | 现行源码暂为旧微信登录 + 登录后核验过渡态；#128（#217/#218/#221/#222/#225）改造为学校唯一登录、H5 HttpOnly Cookie 与 Android Keystore；#223 下线微信接口 |
| 管理端与比赛  | `apps/admin` 已接通 Cookie 登录、工作台、审计操作、来源/运行追溯、候选审核/导入/发布、附件追溯（#173/#177）；比赛模型与导入事务已实现    | #38 交付比赛管理后端 CRUD/预览/发布/隐藏；#46 对接比赛管理前端；#215 将管理端以 `/admin/` 整合进 Web 镜像；用户/招募/举报治理（#41/#216）暂缓            |
| 官方通知采集  | 27 院来源配置与多栏目调度/附件沙箱底座（#129/#174–#177）、7 字段辅助录入收敛（`competition-rules-23`）                                   | 保留已有采集、审核、导入与发布 CLI；27 院扩展与长期运营（#49/#178/#179/#206）已暂缓，不阻塞 M1 手工比赛维护上线                                          |
| 部署与恢复    | `quality` + `image-smoke` CI 门禁、SSH + rsync 归档直传、数据库备份恢复、容量清理及 Stage 2 隔离栈工具已合并                             | #143 验证生产回滚；#215 补充 `/admin/` 路由与静态冒烟；#227 落实网络分段、异机恢复演练与多版本 API 兼容；#228（M3）上线签名 APK HTTPS 下载分发           |
| 旧端对照      | `apps/web` 保留完整桌面/移动视觉与规则对照；`packages/client-domain` 抽离共享业务规则                                                    | `apps/web` 仅作视觉与回滚参照，不新增业务功能；M1–M3 稳定且无回滚源码依赖后按 #90 评估退役                                                               |

### 分期里程碑（M0–M4）

- **M0（契约确立）**：#213 完成 ADR 0011、领域词汇与现行文档同步。
- **M1（管理端 + H5 公开比赛闭环）**：#38 交付比赛后端，#46 完成管理端联调，#214 收口暂缓入口。#84 在 #46 和 #214 完成后验收 H5 公开流程。#215 负责同源 `/admin/` 部署与实站验证。
- **M2（Android + H5 川农唯一登录）**：#217/#218 交付匿名登录事务与 H5 Cookie 会话，#219/#220 完成 Android 打包与安全存储适配，#221/#222 接入双端登录，#223/#224 清理遗留微信入口，#225 验收 H5 认证回归。
- **M3（首期正式分发与运维）**：#226 执行 Android 真机矩阵验收，#140/#227 完善安全准入、异机恢复与多版本兼容，#86/#87/#88/#228 完成发布准入、产物归档、H5 正式切流和签名 APK HTTPS 分发。#58 外部条件与 #143 部署通道可提前推进，#83 双端门禁在 #219 完成后建立。
- **M4（工程收尾）**：#90 评估并退役 `apps/web`。

## 文档导航

| 主题             | 文档入口                                                                                                                                                   | 说明                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 核心架构决策     | [ADR 目录](docs/adr/)                                                                                                                                      | [ADR 0011](docs/adr/0011-android-h5-and-sicau-only-auth.md)记录 Android/H5 与学校唯一登录决策 |
| 领域词汇         | [GLOSSARY.md](GLOSSARY.md)                                                                                                                                 | 统一业务概念与避免叫法                                                                        |
| 开发计划         | [禾伙搭项目开发计划书](docs/禾伙搭-项目开发计划书.md)                                                                                                      | V2.0 范围、阶段任务、技术基线与交付标准                                                       |
| 用户端跨端说明   | [uni-app 跨端适配清单](docs/agents/uni-app-migration.md)                                                                                                   | H5/Android 平台边界与历史迁移交付记录                                                         |
| 样式、控件与资源 | [学生端样式](docs/student-ui-style.md)、[复用表单](docs/uni-forms.md)、[学院选择器](docs/uni-college-picker.md)、[图标资源](docs/uni-assets.md)            | `--hhr-*` 主题、`px/rem` 策略、FormDialog 与资源契约                                          |
| 认证与权限       | [统一身份认证服务](docs/campus-verification.md)、[业务权限契约](docs/business-access.md)                                                                   | 川农 e 认证、姓名学号逐字比对、加密存储、H5/Android 会话与暂缓权限边界                        |
| 管理端与采集     | [管理员认证](docs/admin-auth.md)、[管理端前端](docs/admin-frontend.md)、[采集接口](docs/admin-ingestion.md)、[采集控制页](docs/admin-ingestion-control.md) | Cookie/CSRF 隔离、原子审计、来源与候选审核接线                                                |
| 连接器与质量集   | [共享包架构](docs/sicau-connectors.md)、[质量集协议](docs/quality-eval-protocol.md)                                                                        | `@hehuoda/sicau-connectors/notices` 与 `/auth`、7 字段契约与名单隔离                          |
| 部署与容灾       | [单机部署与恢复](docs/deployment.md)、[容量与清理操作](docs/capacity-and-recovery.md)                                                                      | SSH + rsync 归档交付、`/admin/` 路由、30 天清理与隔离恢复演练                                 |
| 仓库协作规范     | [AGENTS.md](AGENTS.md)、[Issue 规则](docs/agents/issue-tracker.md)、[PR 约定](docs/agents/pull-requests.md)、[分诊标签](docs/agents/triage-labels.md)      | 分支提交规范、Issue 可开工标准与 PR 模板流程                                                  |

## 技术栈

项目采用 **pnpm workspace 单仓（Monorepo）**，运行环境固定为 **Node.js `>=24.15.0 <25`**（`.nvmrc` 为 `24`）与 **pnpm `10.30.3`**。依赖版本以 `pnpm-lock.yaml` 为准：

| 工作区 / 层次               | 核心技术与声明版本                                                                                                                              | 职责与说明                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `@hehuoda/uni`              | 普通 uni-app（DCloud `3.0.0-5020420260813003`）、Vue `3.5.42`（运行映射内嵌 `3.4.21`）、Pinia `3.0.4`、Tailwind CSS `4.3.3`、Vite `5.2.8`       | 用户端 H5 与 Android（APK）同源工程；`check:toolchain` 校验编译层与内嵌运行时宿主 |
| `@hehuoda/admin`            | Vue `^3.5.42`、Vue Router `5.3.1`、Element Plus `^2.11.5`、Tailwind CSS `4.3.3`、`@lucide/vue` `1.51.0`、Vite `^8.3.0`                          | 独立桌面管理端（1024/1440px），#215 后以 `/admin/` 构建并并入 Web 镜像            |
| `@hehuoda/api`              | NestJS `^12.0.1`、Fastify `5.12.5`、Drizzle ORM `0.45.3`、PostgreSQL `17`、Joi `18.2.9`、`class-validator` `0.15.1`、`@nestjs/swagger` `12.0.2` | 业务 API、管理员认证与事务审计、采集调度与审核、C `attachment-sandbox`（Linux）   |
| `@hehuoda/api-types`        | `@nestjs/swagger` + `openapi-typescript` `7.13.0`、TypeScript `5.9.3`                                                                           | 从 `apps/api/openapi.json` 生成只含类型的接口契约（`schema.d.ts`）                |
| `@hehuoda/client-domain`    | 纯 TypeScript `6.0.3`（零框架/DOM 依赖）                                                                                                        | 共享学院目录、筛选/UTC+8 时间解析、资料与暂缓期保留的演示规则                     |
| `@hehuoda/sicau-connectors` | Node.js ESM、`cheerio` `1.2.0`、`pdfjs-dist` `5.4.624`、`mammoth` `1.11.0`、`yauzl` `3.2.1`                                                     | `/notices`（公开通知/附件解析）与 `/auth`（`SchoolAuthClient` 川农统一身份认证）  |
| `@hehuoda/web`              | Vue `^3.5.42`、Pinia `4.0.3`、Vue Router `5.3.1`、Axios `1.20.0`                                                                                | 历史学生端 Web，仅保留作视觉/规则对照与应急回滚（#90 评估退役）                   |
| 质量与交付                  | ESLint `10.11.0`、Prettier `3.9.9`、Jest `30.5.2`、Vitest `5.0.3`、Node `--test`、Docker Compose、GitHub Actions                                | 分层单测/集成/API e2e/容器冒烟与 SSH+rsync 归档发布                               |

> 注意：`apps/uni` 中的 Vite `5.2.8` 为 DCloud 锁定配套（含已知开发服务器安全公告 [GHSA-x574-m823-4x7w](https://github.com/vitejs/vite/security/advisories/GHSA-x574-m823-4x7w)），仅监听本机且不用于生产托管。

## 环境与快速启动

### 1. 安装依赖

```bash
corepack enable
pnpm install --frozen-lockfile
```

### 2. 准备本地数据库与环境变量

复制环境变量示例文件（实际 `.env` 不提交 Git）：

```bash
cp apps/api/.env.example apps/api/.env
cp apps/uni/.env.example apps/uni/.env
cp apps/admin/.env.example apps/admin/.env
```

PowerShell 等效命令：

```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/uni/.env.example apps/uni/.env
Copy-Item apps/admin/.env.example apps/admin/.env
```

启动开发 PostgreSQL 17、执行 SQL 迁移（`0001`–`0013`）并导入初始已核对比赛数据：

```bash
docker compose up -d --wait
pnpm --filter @hehuoda/api db:migrate
pnpm --filter @hehuoda/api data:import data/reviewed-competitions.json
pnpm --filter @hehuoda/api data:import data/publish-reviewed.json --preview
pnpm --filter @hehuoda/api data:import data/publish-reviewed.json
```

如需本地调试管理端登录，可在配置好 `apps/api/.env` 的 `ADMIN_ALLOWED_ORIGINS`（如 `http://127.0.0.1:5183`）后运行受控初始化命令创建管理员账号（不接受命令行传密，无默认密码）：

```bash
pnpm --filter @hehuoda/api admin:init
```

### 3. 启动各端服务

```bash
# 终端 1：启动 API（默认 http://127.0.0.1:3001，Swagger: /docs，OpenAPI: /docs-json）
pnpm --filter @hehuoda/api dev

# 终端 2：启动 uni-app 用户端 H5（默认 http://127.0.0.1:5174/）
pnpm --filter @hehuoda/uni dev:h5

# 终端 3（按需）：启动管理端桌面 Web（默认 http://127.0.0.1:5183/）
pnpm dev:admin
```

- 根目录 `pnpm dev` 仍同时启动 `@hehuoda/api` 与保留作历史对照的 `@hehuoda/web`（`http://localhost:5173`），不用于新端交付。
- `apps/uni` 中的 `dev:mp-weixin` / `build:mp-weixin` 为迁移过渡期遗留脚本（将在 #224 移除），不再作为目标发布端；Android 打包与真机调试脚本将在 #219 落地。

## 各端关键边界与规则

### uni-app 用户端（H5 与 Android）

- **导航与暂缓策略（方案 B）**：保留三栏原生 `tabBar`（首页 / 找队友 / 我的）与 [ADR 0005](docs/adr/0005-uni-navigation-shell.md) 导航注册表（`src/navigation/routes.ts` 与 `pages.json`）。按 #214 收口方向，「找队友」及演示招募/互动入口在 M1 收口为温和暂缓提示；`pages/my/favorites` 维持仅本次内存会话有效的临时收藏，刷新或冷启动清空并明示说明。
- **编译期配置**：`apps/uni/.env` 严禁填入凭据。H5 开发留空 `VITE_API_BASE_URL` 走同源 `/api/v1`（由 `UNI_DEV_API_TARGET` 代理到后端）；**Android APK 正式构建必须显式配置受控 HTTPS 完整 API 地址**，禁止关闭 TLS 校验或使用相对路径；`VITE_API_TIMEOUT_MS` 默认 `5000`（允许 `1–60000`）。
- **认证演进**：当前基线代码仍存在微信过渡入口与 `#ifdef MP-WEIXIN` 分支；M2（#128、#217–#225）将切换为川农统一身份认证唯一登录（首次建号默认昵称 **`禾伙搭用户`**），H5 使用内存 Access Token + `HttpOnly` Refresh Cookie（配 `Origin` 与 `X-Refresh-CSRF` 校验），Android 使用内存 Access Token + Android Keystore 加密存储适配。
- **H5 独立构建与预览**：

```bash
pnpm --filter @hehuoda/uni build:h5
pnpm --filter @hehuoda/uni preview:h5   # 监听 127.0.0.1:5176，仅托管静态 H5 产物，不代理 API
```

样式基线页为 `/#/pages/style/index`，健康页为 `/#/pages/health/index`，关于页为 `/#/pages/about/index`。

### 管理端（`apps/admin`）

- 仅面向桌面浏览器（1024px / 1440px）使用；Cookie 会话（`hh_admin_session`）、`Origin`、`X-CSRF-Token` 及同源 `BroadcastChannel` 跨标签失效机制见[管理员认证说明](docs/admin-auth.md)与[管理端前端说明](docs/admin-frontend.md)。
- 生产环境将由 #215 以 `/admin/` 子路径并入 Web Nginx 镜像，与 H5（`/`）及 API（`/api/v1/`）保持同源部署。
- **手工比赛外链规则（ADR 0011 冻结）**：管理员在管理端手工录入/编辑比赛官方通知或报名参考外链时，仅允许**无凭据、无非默认端口的公开 `https://` DNS 链接**（不限于 `*.sicau.edu.cn`）；严禁将此规则扩及 `packages/sicau-connectors/src/notices` 或自动采集入库白名单。

### 后端与数据库（`apps/api`）

- **数据库迁移清单（`apps/api/migrations/`）**：
  - `0001_competitions.sql`：学院、比赛届次、赛段、赛道、来源通知与关系表
  - `0002_ingestion.sql`、`0003_ingestion_recovery_indexes.sql`：采集来源、运行、通知版本、候选与续跑索引
  - `0004_auth.sql`：平台用户、会话族、令牌、审计与限流表（`wechat_identities` 在 #223 下线接口时保留表结构兼容）
  - `0005_campus.sql`：校园身份 HMAC 绑定、学期资格、AES-256-GCM 加密资料与核验事务
  - `0006_admin.sql`：管理员账号、会话、操作审计及状态撤销触发器
  - `0007_ingestion_admin.sql`、`0008_ingestion_review.sql`：管理采集请求、命令幂等、人工修订与预览回执
  - `0009_ingestion_channels.sql`：多栏目状态、通知关联、四阶段扫描任务与调度轮
  - `0010_ingestion_attachments.sql`、`0011_ingestion_attachment_requests.sql`：附件版本、提取证据与重查请求
  - `0012_ingestion_classification.sql`：赛事分类、规则版本（当前 `competition-rules-23`）、7 字段提取修订与人工分类审计
  - `0013_admin_competitions.sql`：管理端比赛命令幂等回执与变更预览回执
- **人工导入与采集审核 CLI**（操作细则分别见 [ADR 0003](docs/adr/0003-competition-catalog-persistence.md)、[管理采集接口](docs/admin-ingestion.md) 与 [共享包架构](docs/sicau-connectors.md)）：

```bash
# 人工导入比赛清单（正式发布与更新已发布内容均需显式校验/确认）
pnpm --filter @hehuoda/api data:import data/reviewed-competitions.json --validate
pnpm --filter @hehuoda/api data:import data/reviewed-competitions.json --preview

# 采集来源、扫描、运行追溯、审核导出与发布 CLI
pnpm --filter @hehuoda/api ingestion sources
pnpm --filter @hehuoda/api ingestion scan --source information-engineering --preview
pnpm --filter @hehuoda/api ingestion runs
pnpm --filter @hehuoda/api ingestion candidates
pnpm --filter @hehuoda/api ingestion export --candidate <候选ID> --out ../../.data/review.json
pnpm --filter @hehuoda/api ingestion cleanup --days 30
```

> 注：Linux 容器内置 C `attachment-sandbox`（seccomp + Landlock）；Windows 本机运行采集时附件解析自动转人工核对。

## 仓库目录结构

```text
HeHuoDa/
├── apps/
│   ├── uni/                          # @hehuoda/uni：普通 uni-app 用户端（H5 + Android）
│   ├── admin/                        # @hehuoda/admin：独立桌面管理端 Web
│   ├── api/                          # @hehuoda/api：NestJS / Fastify API、迁移、CLI 与 OpenAPI
│   │   ├── src/
│   │   │   ├── admin/                # 管理员登录、CSRF、原子审计与采集/审核接口
│   │   │   ├── auth/                 # 平台会话、刷新轮换与审计（待 #217/#218/#223 改造）
│   │   │   ├── business-access/      # 敏感业务能力门禁与账号生命周期端口（组队默认关闭）
│   │   │   ├── campus/               # 校园认证事务、HMAC 绑定与加密资料
│   │   │   ├── common/               # 错误模型、异常过滤器与全局校验管道
│   │   │   ├── competitions/         # 公开查询与事务导入校验
│   │   │   ├── config/               # 环境变量校验与可信代理适配
│   │   │   ├── database/             # Drizzle schema、连接池与 SQL 迁移器
│   │   │   ├── health/               # /health 与 /health/ready
│   │   │   └── ingestion/            # 调度轮、多栏目扫描、附件沙箱与审核状态机
│   │   ├── migrations/               # 0001–0013 受版本控制的增量 SQL
│   │   ├── data/                     # 核对比赛数据与发布清单
│   │   ├── scripts/                  # 迁移、admin:init、data:import、ingestion 与 openapi:write
│   │   └── test/                     # Jest 集成测试与 Fastify/HTTP e2e 测试
│   └── web/                          # @hehuoda/web：历史学生端（对照与回滚参考，待 #90 评估退役）
├── packages/
│   ├── api-types/                    # @hehuoda/api-types：由 OpenAPI 生成的共享 TS 类型（禁止手改）
│   ├── client-domain/                # @hehuoda/client-domain：无框架依赖的领域规则包
│   └── sicau-connectors/             # @hehuoda/sicau-connectors：服务端 /notices 与 /auth 私有包
├── deploy/                           # 镜像冒烟（smoke.mjs）、归档交付（rsync/archive/release）、Stage 2 与 Nginx 配置
├── docs/                             # ADR（0001–0011）、各端规范、开发计划书与 Agent 协作指南
├── .github/                          # Issue/PR 模板与 CI/Deploy/Auto-merge 工作流
├── third-party-notices/              # Lucide 等第三方许可证声明
├── AGENTS.md                         # 仓库开发与审查核心约定
├── GLOSSARY.md                       # 项目领域词汇表
├── compose.yaml                      # 本地开发/测试 PostgreSQL 17 服务
├── compose.deploy.yaml               # 生产/测试单机容器编排
├── Dockerfile                        # api（含 attachment-sandbox）与 web（Nginx）多阶段镜像构建
├── package.json                      # 根脚本、Node/pnpm 版本约束与共用工具链
└── pnpm-workspace.yaml               # 工作区包定义与 DCloud 精确 peer 扩展
```

## 契约生成、质量检查与 CI

修改后端 DTO 或路由后，必须同步生成 OpenAPI 与共享类型且确认无未提交差异：

```bash
pnpm api:generate
git diff --exit-code -- apps/api/openapi.json packages/api-types/src/generated/schema.d.ts
```

全量质量与测试检查命令：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test:unit
pnpm test:deployment
TEST_DATABASE_URL=postgresql://hehuoda:hehuoda_test@127.0.0.1:54323/hehuoda_test pnpm test:integration
TEST_DATABASE_URL=postgresql://hehuoda:hehuoda_test@127.0.0.1:54323/hehuoda_test pnpm test:e2e
pnpm test:images   # 构建真实 Docker 镜像并在隔离卷上运行冒烟测试
```

> PowerShell 设置测试库变量：`$env:TEST_DATABASE_URL="postgresql://hehuoda:hehuoda_test@127.0.0.1:54323/hehuoda_test"`。测试库名必须以 `_test` 结尾。根 `test:e2e` 当前仅覆盖 API HTTP 与注入测试，不代表浏览器 H5 模拟（320/375/390/430px）或 Android 真机验收已执行。

- **GitHub Actions CI（`.github/workflows/ci.yml`）**：包含 `quality`（依赖、格式、lint、部署单元测试、loopback SSH+rsync 测试、OpenAPI 零差异、类型检查、全仓构建、单元/集成/API e2e）、`image-smoke`（实际容器冒烟与归档/回滚测试；`main` 推送或手动触发时保存 7 天 `release-archive`）以及 `ci-gate`。
- **交付与产物边界**：截图、验收脚本、本地草稿及结果 JSON 留存在本地忽略目录（如 `.data/`、`docs/screenshots/`），不提交 Git；实际验证记录按 [PR 模板](.github/PULL_REQUEST_TEMPLATE.md) 填写并执行关联 Issue 收尾（详见 [issue-tracker.md](docs/agents/issue-tracker.md) 与 [pull-requests.md](docs/agents/pull-requests.md)）。
