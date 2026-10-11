# 禾伙人

四川农业大学校园比赛与项目组队平台。当前完成阶段一工程初始化、学生端共享导航与路由，登录注册前端表单，以及比赛首页、院徽筛选承办学院、比赛详情（Issue #12）。Issue #22 接入 PostgreSQL、人工核对数据导入、学院与比赛公开查询及真实 API 联调；Issue #13 实现找队友筛选、队伍详情、发布表单、比赛关联及会话内申请/举报演示；Issue #14 提供个人中心、资料编辑及联系方式授权的会话内演示；队伍管理与申请邀请仍待 #15 实现，真实认证与招募写接口尚未开发。工程包含 pnpm 工作区、Vue 健康页、NestJS/Fastify 健康接口、OpenAPI 类型生成与 CI 配置。

项目范围、阶段安排与当前进度见[项目开发计划书](docs/禾伙人-项目开发计划书.md)。

## 技术栈

项目采用 **pnpm workspace 单仓（Monorepo）**，包含 Web 应用、API 服务和共享接口类型包。以下版本来自各工作区的 `package.json` 与 `compose.yaml`；保留依赖声明的 `^` / `~` 范围，实际安装版本以 `pnpm-lock.yaml` 为准。

| 层次             | 技术与版本                                                                                       | 项目用途                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| 运行环境与包管理 | Node.js `>=24.15.0 <25`、pnpm `10.30.3`                                                          | 统一运行环境、工作区依赖与脚本                                        |
| 开发语言         | TypeScript `6.0.x`；共享类型包 `5.9.3`                                                           | Web / API 类型检查；共享包兼容类型生成工具                            |
| Web 框架与构建   | Vue `^3.5.42`、Vite `^8.3.0`、`@vitejs/plugin-vue` `^6.0.8`                                      | Vue 单文件组件、开发服务器与生产构建                                  |
| 路由与状态       | Vue Router `5.3.1`、Pinia `4.0.3`                                                                | 学生端路由、布局导航与健康状态管理                                    |
| 样式与图标       | Tailwind CSS / `@tailwindcss/vite` `4.3.3`、`@lucide/vue` `1.51.0`                               | 工具类与主题 CSS、自封装复用组件、统一图标入口；当前未使用 Vant       |
| HTTP 客户端      | Axios `1.20.0`                                                                                   | Web 通过 `/api/v1` 请求 API，开发时由 Vite 代理                       |
| API 框架与服务器 | NestJS `^12.0.1`、`@nestjs/platform-fastify` `12.1.2`、Fastify `5.12.5`                          | 模块、控制器、依赖注入与 HTTP 服务                                    |
| 配置与请求校验   | `@nestjs/config` `12.0.1`、Joi `18.2.9`、`class-validator` `0.15.1`、`class-transformer` `0.5.1` | 环境配置校验、DTO 转换与严格请求校验                                  |
| 数据库与访问层   | PostgreSQL `17`、Drizzle ORM `0.45.3`、`pg` `8.23.1`                                             | 学院与比赛持久化、连接池和查询；SQL 迁移由项目脚本执行                |
| 接口契约         | `@nestjs/swagger` `12.0.2`、`openapi-typescript` `7.13.0`                                        | 从 DTO / Swagger 生成 OpenAPI JSON，再生成 Web 使用的 TypeScript 类型 |
| Web 测试         | Vitest `5.0.3`、`@vue/test-utils` `2.5.1`、jsdom `30.1.1`                                        | 组件、路由、状态与请求行为单元测试                                    |
| API 测试         | Jest `30.5.2`、`ts-jest` `29.4.14`                                                               | 单元测试、真实 PostgreSQL 集成测试与 HTTP e2e 测试                    |
| 代码质量与协作   | ESLint `10.11.0`、Prettier `3.9.9`、GitHub Actions                                               | 静态检查、格式统一与 CI 质量门禁                                      |
| 本地数据库环境   | Docker Compose，`postgres:17` 镜像                                                               | 开发数据库持久卷与独立临时测试数据库；尚未提供 Web / API 容器化部署   |

当前交付普通 Web 应用，真实认证、招募与申请仍待开发。后续统一迁移到普通 uni-app（H5、微信小程序）：Vue Router 的 History 路由、Axios 浏览器请求、DOM / 浏览器 API、Lucide SVG 与 Tailwind Web CSS 均需逐项适配和实测，不能直接视为小程序兼容。迁移任务与替代方案见[迁移提醒与待办](docs/agents/uni-app-migration.md)。

## 环境

- Node.js 24，最低 `24.15.0`，支持范围 `>=24.15.0 <25`；`.nvmrc` 使用 `24`，不固定补丁版本。
- pnpm `10.30.3`，由根目录 `packageManager` 固定。

```bash
corepack enable
pnpm install --frozen-lockfile
```

安装 Node 时如未包含 Corepack，请先按 [Corepack 官方说明](https://github.com/nodejs/corepack#manual-installs)安装。

## 本地开发

在仓库根目录复制环境变量示例：

```bash
cp apps/api/.env.example apps/api/.env
```

PowerShell 等效命令：

```powershell
Copy-Item apps/api/.env.example apps/api/.env
```

```bash
docker compose up -d --wait
pnpm --filter @hehuoren/api db:migrate
pnpm --filter @hehuoren/api data:import data/reviewed-competitions.json
pnpm --filter @hehuoren/api data:import data/publish-reviewed.json --preview
pnpm --filter @hehuoren/api data:import data/publish-reviewed.json
pnpm dev
```

- Web 首页：[http://localhost:5173/home](http://localhost:5173/home)，根路径跳转到 `/home`，未知地址显示独立 404；端口占用时以 Vite 输出为准。
- Web 健康页：[http://localhost:5173/health](http://localhost:5173/health)，保留独立健康检查与刷新/重试。
- API：[http://127.0.0.1:3001/api/v1/health](http://127.0.0.1:3001/api/v1/health)。
- Swagger：[http://127.0.0.1:3001/docs](http://127.0.0.1:3001/docs)。
- OpenAPI JSON：[http://127.0.0.1:3001/docs-json](http://127.0.0.1:3001/docs-json)。

API 默认只监听本机。开发端口冲突时可设置 API 的 PORT 和 Web 的 API_PROXY_TARGET（默认 http://127.0.0.1:3001），无需停止其他进程。Web 的 `/api` 请求由 Vite 代理到 API；修改 API 端口时需同步设置 Web 的 `API_PROXY_TARGET`，代理配置位于 `apps/web/vite.config.ts`。环境变量支持 `NODE_ENV`、`PORT` 与 `DATABASE_URL`；端口必须是 1–65535 的整数。`.env` 不提交。

健康接口返回 `{ status: "ok", requestId: string }`，请求 ID 来自 Fastify。异常响应包含稳定的 `code`、用户可读的 `message` 与 `requestId`，未知异常不暴露内部细节。health 不检查数据库就绪；学院与比赛接口使用数据库。

## 学生端样式

学生端采用禾苗绿主色、暖白背景、谷物黄点缀和轻量圆角卡片。该风格已提取到 `apps/web/src/style.css`，通过共享变量统一 Tailwind 与原生控件；现有 `/health` 页面已接入。

实现后续页面时遵循[学生端全局样式约定](docs/student-ui-style.md)。设计预览、截图和验收产物仅保留本地，不进入 Git。

学生端已提供桌面侧栏与移动底部导航；业务页面直接开放，尚无认证状态；比赛数据由公开查询接口提供。登录、注册采用独立品牌布局和实际表单；找队友三个页面和个人中心资料编辑提供可重置的会话内演示；队伍与申请邀请仅展示标明示例的静态样式，收藏与通知仍为待开发占位。

| 路由                                             | 当前页面                                              |
| ------------------------------------------------ | ----------------------------------------------------- |
| `/`                                              | 跳转到 `/home`                                        |
| `/home`                                          | 首页                                                  |
| `/home/competitions/:id`                         | 首页内部的比赛详情                                    |
| `/teams`、`/teams/:id`、`/teams/new`             | 找队友、队伍详情、发布招募                            |
| `/my/teams`、`/my/applications`、`/my/favorites` | 我的队伍、申请与邀请、我的收藏                        |
| `/notifications`                                 | 站内通知（待开发）                                    |
| `/profile`                                       | 个人中心：资料编辑与授权会话演示、队伍/申请待开发分区 |
| `/login`、`/register`                            | 登录、注册前端表单                                    |
| `/health`                                        | 独立服务状态页                                        |
| 未匹配路径                                       | 页面不存在，可返回首页                                |

首页与比赛详情读取 API；找队友使用明确标注的演示队伍，未知队伍 ID 显示不存在。原计划的 `/competitions` 路径已由首页替代。收藏与通知在移动端通过“个人中心”进入。History 路由部署时需配置 SPA fallback；本次未扩展生产部署。

登录校验邮箱及非空密码；注册包含昵称、邮箱、密码、确认密码与邮箱验证码，密码至少 8 位，不裁剪密码或限制字符组合。密码支持显示/隐藏，验证码发送前校验邮箱。OpenAPI 包含健康与比赛公开查询，认证尚未接入；提交反馈“认证服务暂未开放”，发送反馈“验证码服务暂未开放”；不创建登录状态、不模拟发送成功或倒计时。密码与验证码不写入浏览器存储、日志或 URL，切换认证页面时清空输入。

邮箱验证码是 Issue #9 新增要求，真实发送、校验、有效期与重发规则依赖后续邮件接口，本次未联调。账号服务尚未开放，当前不能注册或登录。认证表单与尚未开放的服务边界以当前源码及 Issue #9 为准。

## 项目结构与接口契约

以下展示已纳入版本控制的主要目录与关键文件，省略依赖、构建输出和本地验收产物：

```text
HeHuoRen/
├── apps/
│   ├── web/                          # @hehuoren/web：学生端 Web 应用
│   │   ├── src/
│   │   │   ├── api/                  # Axios 客户端、健康与比赛 API 请求
│   │   │   ├── assets/               # 生产 Logo 与学院院徽
│   │   │   ├── components/           # 图标、表单、学院筛选与加载组件
│   │   │   ├── data/                 # 学院选择、筛选规则与历史测试演示数据
│   │   │   ├── layouts/              # 学生端导航布局与认证品牌布局
│   │   │   ├── router/               # Vue Router 路由与路由测试
│   │   │   ├── stores/               # Pinia 健康状态与测试
│   │   │   ├── views/                # 首页、比赛列表/详情、认证、健康与占位页
│   │   │   ├── App.vue              # 根组件
│   │   │   ├── main.ts              # 应用入口，注册 Router 与 Pinia
│   │   │   └── style.css            # 全局主题变量与 Tailwind 样式
│   │   ├── vite.config.ts            # Vue / Tailwind 插件与开发 API 代理
│   │   └── vitest.config.ts          # Web 单元测试配置
│   └── api/                          # @hehuoren/api：NestJS / Fastify 服务
│       ├── src/
│       │   ├── common/               # 错误 DTO、异常过滤器与全局校验管道
│       │   ├── competitions/         # 学院/比赛查询、DTO、仓储、时间与导入规则
│       │   ├── config/               # 环境变量校验
│       │   ├── database/             # 数据库模块、连接池、Drizzle schema 与迁移执行
│       │   ├── health/               # 健康检查接口
│       │   ├── app.module.ts         # 根模块
│       │   ├── configure-app.ts      # API 前缀、校验、异常处理与 Swagger
│       │   └── main.ts              # 服务启动入口
│       ├── data/                     # 人工核对比赛数据与显式发布清单
│       ├── migrations/               # 受版本控制的 SQL 迁移
│       ├── scripts/                  # 数据迁移、人工导入与 OpenAPI 生成入口
│       ├── test/                     # 集成/e2e 测试、固定数据与 Jest 配置
│       ├── .env.example              # 本地环境变量示例（实际 .env 不提交）
│       └── openapi.json              # 生成并提交的接口契约
├── packages/
│   └── api-types/                    # @hehuoren/api-types：共享类型，无运行时代码
│       └── src/
│           ├── generated/schema.d.ts # 从 OpenAPI 自动生成，禁止手工编辑
│           └── index.ts              # 共享类型导出入口
├── docs/
│   ├── adr/                          # 架构决策及其演进记录
│   ├── agents/                       # Issue、领域文档、分诊与跨端迁移约定
│   ├── student-ui-style.md           # 学生端全局样式约定
│   └── 禾伙人-项目开发计划书.md      # 业务范围、阶段安排与进度
├── .github/                          # Issue / PR 模板与 CI、自动合并工作流
├── third-party-notices/              # 第三方资源许可证
├── AGENTS.md                         # 仓库 Agent 指引
├── CONTEXT.md                        # 业务领域词汇与上下文
├── compose.yaml                      # 开发与测试 PostgreSQL 服务
├── eslint.config.mjs                 # 工作区 ESLint 配置
├── package.json                      # 根脚本、Node / pnpm 约束与公共开发依赖
├── pnpm-workspace.yaml               # apps/* 与 packages/* 工作区定义
└── pnpm-lock.yaml                    # 统一依赖锁文件
```

Web 的组件与逻辑单元测试（`*.spec.ts`）就近放在源码目录；API 单元测试同样就近放置，集成与 e2e 测试集中在 `apps/api/test/`。`apps/web/src/data/` 中的历史比赛演示数据用于旧行为测试，生产比赛页面通过 `src/api/` 读取真实 API。

接口契约流向为 **API DTO / Swagger → `apps/api/openapi.json` → `packages/api-types/src/generated/schema.d.ts` → Web**。Web 通过 `workspace:*` 引用共享包；共享类型不会代替 API 运行时请求校验。学院与比赛 API 通过数据库访问层读取 PostgreSQL，健康检查不依赖活数据库。

修改 API DTO 或路由后运行：

```bash
pnpm api:generate
git diff -- apps/api/openapi.json packages/api-types/src/generated/schema.d.ts
```

生成过程不监听端口，不需要数据库。生成文件随代码提交，不手工编辑。为支持 NestJS 装饰器元数据，API 先编译生成脚本到被忽略的 `dist-openapi/`，再由 Node 执行。类型生成包采用 TypeScript 5.9，应用采用 TypeScript 6，以匹配各工具的兼容范围。

## 质量检查

```bash
pnpm format:check
pnpm lint
pnpm api:generate
git diff --exit-code -- apps/api/openapi.json packages/api-types/src/generated/schema.d.ts
pnpm typecheck
pnpm build
pnpm test:unit
TEST_DATABASE_URL=postgresql://hehuoren:hehuoren_test@127.0.0.1:54323/hehuoren_test pnpm test:integration
TEST_DATABASE_URL=postgresql://hehuoren:hehuoren_test@127.0.0.1:54323/hehuoren_test pnpm test:e2e
```

PowerShell 先执行 `$env:TEST_DATABASE_URL="postgresql://hehuoren:hehuoren_test@127.0.0.1:54323/hehuoren_test"`，再运行两个数据库测试命令。测试连接数据库名须以 `_test` 结尾，且不能与开发连接相同；每套测试创建独立 schema，完成后清理。

API 单元测试覆盖配置、异常过滤、严格查询校验与报名时间边界；真实 PostgreSQL 集成测试验证迁移、事务导入、稳定排序、计数及分页；集成测试使用 Fastify 注入请求；e2e 测试在本机临时端口验证真实 HTTP 与 Swagger 契约。Web 单元测试覆盖 Pinia 健康状态、学生端路由、首页嵌套、导航归属、404、健康页重试/刷新，以及认证表单校验、密码切换、验证码前置校验和服务不可用反馈。API 的 Jest ESM 模式使用 `--experimental-vm-modules`，Node 会输出对应实验功能提示。

ESLint 使用原生支持的 `eslint.config.mjs`；`eslint-config-prettier` 关闭与 Prettier 冲突的格式规则。生成文件与构建输出不参与格式检查。

## CI 与协作

GitHub Actions 在面向 `main` 的 PR、`main` 推送及手动触发时运行完整质量检查，Action 固定为完整提交 SHA。最终 job 名为 `ci-gate`，只有 `quality` 成功时通过。配置没有路径过滤器。

`auto-merge.yml` 在 PR 的 `CI` 成功后自动启用合并：仅处理本仓库面向 `main` 的非草稿 PR，核对通过 CI 的提交仍是 PR 最新提交，并使用 merge commit 保留分步提交。它遵守分支保护，不检出或执行 PR 代码。仓库需开启 Allow auto-merge；建议将 `ci-gate` 设为必需检查。该工作流合并到默认分支后才会触发；CI 会在草稿 PR 转为可审阅时重新运行，成功后再次触发自动合并。

合并命令执行后，工作流重新确认 PR 已合并，再显式删除来源远程分支。仅删除 SHA 仍等于通过 CI 的提交、未受保护、不是默认分支且没有其他打开的 PR 引用的本仓库分支；已删除或新增提交的分支会跳过。如果 `--auto` 只启用了等待合并，本次运行保留分支，后续延迟合并仍依赖仓库自动删除设置或人工清理。

问题与方案记录在 GitHub Issues，PR 使用仓库模板。参见 [AGENTS.md](AGENTS.md)，现行决策见 [ADR](docs/adr/0001-phase-one-technology-foundation.md)。

新建 Issue 可选择[问题反馈](.github/ISSUE_TEMPLATE/bug_report.yml)、[功能建议](.github/ISSUE_TEMPLATE/feature_request.yml)或[开发任务](.github/ISSUE_TEMPLATE/task.yml)表单，默认进入 `needs-triage`；确认需求后按[分诊标签映射](docs/agents/triage-labels.md)更新状态。提交 PR 时使用 [PR 模板](.github/PULL_REQUEST_TEMPLATE.md)，填写关联 Issue、变更内容与实际验证结果。

本机 Agent 配置、依赖、构建缓存、日志、浏览器测试产物及本地运行数据由 `.gitignore` 排除。环境变量示例、根锁文件、OpenAPI 文档与生成的接口类型随代码提交。

本地检查不能证明远端 CI 已执行；分支保护、required checks 与 Auto-merge 需要在 GitHub 单独配置和核验。本次完成首页所需数据库与公开比赛 API；真实登录、招募、申请和生产部署仍待开发。

## 学生端样式与跨端规划

Issue #19 完整移除 Vant；现采用 Tailwind 为主、少量普通 CSS、按复用与行为需要封装组件。图标使用 `@lucide/vue` 1.51.0，经 `AppIcon.vue` 统一入口静态按需导入，许可证与渲染适配见[图标来源](third-party-notices/lucide-LICENSE.txt)和[样式约定](docs/student-ui-style.md)。认证、健康状态与导航保持既有行为。

项目完成后统一迁移到普通 uni-app，目标 H5、微信小程序。当前继续交付 Web，未搭建跨端工程；开发时持续识别、解释并记录影响，参见[迁移提醒与待办](docs/agents/uni-app-migration.md)。验证结果与构建体积对比记录在 PR；验收文档和截图仅保留本地。

图标与加载组件位于 `apps/web/src/components/`，分别为 `AppIcon.vue`、`app-icons.ts` 和 `LoadingIndicator.vue`，复用既有认证与学院组件。

## 比赛查询与人工导入（Issue #22）

首页显式请求每页 4 个赛段；API 默认 20，支持 1–50。PostgreSQL 按完整过滤结果计算赛段数、去重届次数与页数，并按届次全部通知的最大发布日期倒序、届次 ID、赛段展示顺序、赛段 ID 稳定排序。API 使用服务端当前时刻，页面显示 evaluatedAt；官方通知、历史与演示标识独立于发布状态。比赛报名、材料提交和举行时间分别展示；未注明开始时间的通知提示待核对，不以发布日期推断开放报名。

URL query 约定：`hosts` 为稳定学院 ID 的逗号列表或 `all`，缺省为全部学院；显式空值（`hosts=`）表示未选择且不显示比赛；`q`、`status`、`page` 分别保存搜索、状态与页码。旧版 `category`、`eligible` 参数在 URL 规范化时移除。有效自选学院优先于 all，校验、去重并按字典排序；无关参数保留。筛选变更回到第 1 页，规范化使用 replace，不增加历史记录。首页搜索和状态筛选合并在院徽卡片内，使用紧凑控件；点击院徽仅按承办学院筛选，不提供“本学院可参加”筛选。参赛范围与其他资格限制在比赛卡片和详情中说明，不作为学院入口的筛选依据。

程序设计为个人赛，生物竞赛为同校区 4 人组队；挑战杯院赛保留各自截止与材料方式。详情提供官方原文、发布时间、核对日期与复制入口，并明确平台组队不等于官方报名。收藏仍为禁用的后续入口；关联招募跳转找队友并携带比赛 ID，匹配结果明确标注为演示，无匹配时显示空结果。不接入业务 localStorage 或认证。

公开接口为 GET /api/v1/colleges、GET /api/v1/competitions、GET /api/v1/competitions/:id；详情仅返回已发布届次，草稿、隐藏或不存在统一 404。请求错误统一返回 code、message、requestId。直接 API 的 q/status/page/pageSize 重复值返回 400；hosts 可重复合并，未知学院忽略；q 为最长 100 字符的字面包含搜索。超页返回最后有效页，无结果 page=1、totalPages=1；页面收到响应后 replace 纠正页码。生产页面不读取 competitions.ts，该文件及 competition-demo.ts 仅供旧行为测试。

人工数据位于 apps/api/data/reviewed-competitions.json：27 个稳定学院 ID、4 个非演示届次，默认草稿。2026-10-04 重新读取六条官网通知；挑战杯校团委附件需验证码，未验证附件规则，保留未知字段及提醒。复赛/院赛日期用 date 精度，24:00 等价保存为次日 00:00 的精确瞬间并保留原文说明。统计建模通知明确的是材料截止，不自动当作报名截止。

```bash
pnpm --filter @hehuoren/api data:import data/reviewed-competitions.json --validate
pnpm --filter @hehuoren/api data:import data/reviewed-competitions.json --preview
pnpm --filter @hehuoren/api data:import data/reviewed-competitions.json
```

--validate 仅验证文件结构；--preview 在数据库事务内验证引用、发布条件与数据库约束，输出新增/更新和解除关系，再回滚。导入以稳定 ID 更新，缺失实体不删除；承办学院、范围学院和赛段来源缺省保留、数组完整替换、空数组清空。部分更新文件仍采用 colleges/competitions 根结构及各对象 id。未知时间为 { precision: "unknown", value: null }，清除时间须显式写该对象。

发布须在输入对应届次写 publication: "published"；隐藏写 "hidden"。改动已发布内容（含关系和公开学院目录）执行时必须附 --confirm-published，预览无需确认。草稿变为发布亦须通过来源、赛道与时间校验。生产 NODE_ENV=production 拒绝 demo；导入失败整批回滚，不输出数据库凭据。--validate 不证明来源真实，请先人工核对。开发测试容器分别使用持久卷和独立临时数据，禁止将本地示例凭据用于生产。

迁移由 apps/api/migrations/ 中的 SQL 与迁移记录管理，重复运行不重复建表；回退应用时保留比赛数据，不提供自动删库回退。正式接口契约从 DTO/Swagger 生成，无需活数据库或开放端口。Issue #23 已接入后端官方通知采集与维护者审核 CLI，使用方式见下节；管理界面、收藏、真实招募业务接口及认证仍待接入。比赛详情已可进入关联演示招募。

首次草稿导入后公开列表为空，需按上方命令审阅并执行 publish-reviewed.json 显式发布清单。重新导入原始草稿文件会把已发布记录改回草稿，执行须 --confirm-published；通常对已发布内容使用按 ID 的部分更新文件，而不是重跑初始草稿清单。

## 官方通知采集与人工审核（Issue #23）

先执行 `pnpm --filter @hehuoren/api db:migrate` 应用新增的 `0002_ingestion.sql`。采集来源、运行进度、通知版本、候选修订、审核记录及正式实体映射均持久化在 PostgreSQL。采集只生成候选；审核通过、导入与发布是三个独立操作。

首批来源为信息工程学院 `information-engineering`（`https://xxgc.sicau.edu.cn/xygl/tz.htm`）和生命科学学院 `life-sciences`（`https://smkx.sicau.edu.cn/xwjtz/tzgg.htm`）。仅访问这些来源的 HTTPS 同域页面，按 robots 规则采集，不下载附件、不解析报名者名单。发布单位不自动成为承办单位；参赛资格、年份冲突、多赛段时间归属及缺失时间都留待人工核对。显式赛道名称、人数要求与规则条款保存原文候选及证据；不能明确归属的赛道模式、人数和规则保持未知，由维护者在正式批次中补全。正文、字段证据与来源版本长期保留，完整响应默认保留 30 天。

以下命令在根目录运行，读取 `apps/api/.env` 中的 `DATABASE_URL`：

```bash
pnpm --filter @hehuoren/api ingestion sources
pnpm --filter @hehuoren/api ingestion scan --source information-engineering --preview
pnpm --filter @hehuoren/api ingestion scan --source information-engineering --from 2026-07-14 --to 2026-10-11
pnpm --filter @hehuoren/api ingestion scan --source life-sciences --url https://smkx.sicau.edu.cn/info/1061/28771.htm
pnpm --filter @hehuoren/api ingestion runs
pnpm --filter @hehuoren/api ingestion candidates
pnpm --filter @hehuoren/api ingestion operations
```

不指定来源时顺序扫描两站；默认北京时间最近 90 天，指定区间最多 366 天。单 URL 重跑和 `scan --source <来源> --resume <运行ID>` 必须指定来源；续跑沿用原范围和待处理游标。置顶、未知日期或乱序列表不触发提前截断，已知近期通知使用 ETag/Last-Modified 复查；适配器版本变化会重新解析。相同 URL 和正文版本不重复生成候选；新版重新进入待审核，转载只提示关联、不自动合并。结构异常、空列表、登录/验证码、域名或地址异常停止相关来源，正式比赛保持原状。

审核文件导出到被忽略的 `.data/`。已有比赛须显式指定 `--target <比赛ID>`，否则生成新草稿的稳定 ID。审核文件的 `source`、`article`、`previousArticle`、`candidate`、`formalBefore` 和版本基线用于防止过期或篡改；人工只修正 `batch`，填写 `checkedAt`（真实核对日期）和 `resolution`（修正理由、未知字段及冲突处理）。完整字段结构沿用上一节人工导入文件，不能用猜测填补缺失资格或时间。首次导出的新比赛需要补齐届次、正式来源通知和赛段，默认不具备发布条件。

```bash
pnpm --filter @hehuoren/api ingestion export --candidate <候选ID> --out ../../.data/review.json
# 核对原文并修改审核文件后执行；<维护者> 为审核身份标识。
pnpm --filter @hehuoren/api ingestion approve --file ../../.data/review.json --reviewer <维护者>
pnpm --filter @hehuoren/api ingestion apply --file ../../.data/review.json --reviewer <维护者> --preview
pnpm --filter @hehuoren/api ingestion apply --file ../../.data/review.json --reviewer <维护者>
# 重新导出以取得导入后的 baseline；发布只改变正式记录的发布状态。
pnpm --filter @hehuoren/api ingestion export --candidate <候选ID> --out ../../.data/after-import.json
pnpm --filter @hehuoren/api ingestion publish --candidate <候选ID> --baseline <新导出文件的baseline> --reviewer <维护者> --preview
pnpm --filter @hehuoren/api ingestion publish --candidate <候选ID> --baseline <同一baseline> --reviewer <维护者>
```

`scan --preview` 不写入运行、候选或正式数据；`apply --preview` 回滚正式变更并记录预览审计，`publish --preview` 回滚整个事务。审核文件绑定来源版本、候选修订及正式比赛全部关系摘要；批准和导入在同一事务内重新校验基线，过期文件、新 ID 已被占用及并发修改都会拒绝。已发布记录出现新版候选时继续公开旧数据；更新它必须先执行同一文件的 `apply --preview`，再 `apply --confirm-published`。不得通过候选导入把已发布记录退回草稿。重复执行相同审核文件及操作返回已有结果，不重复覆盖正式数据。

拒绝使用 `reject --candidate <ID> --reviewer <维护者> --reason <原因>`；同一版本后续扫描仍保持拒绝，只有来源新版或显式 `reopen`（同样要求身份与原因）重新进入待审核。来源下线或撤回只标记需要核对，不删除或隐藏正式比赛。运行、操作查询保留审核身份、时间、版本和历史人工修改依据。

API 内调度默认每天北京时间 09:00、18:00 运行，`INGESTION_ENABLED=false` 可关闭；测试与 OpenAPI 生成始终关闭采集。来源开关与预算可通过 `configure --source <来源> --enabled true|false` 设置，API 与 CLI 共享 PostgreSQL 会话锁，所有来源总并发为 1。默认每源间隔 2 秒、请求超时 15 秒、每次最多 10 页/80 次请求/10 分钟、每响应最多 2 MiB；429 尊重 Retry-After（最多 60 秒），暂时错误最多重试两次。允许配置更低请求/页数预算，超出边界直接拒绝。

| configure 参数 | 允许范围（整数）          | 默认值  |
| -------------- | ------------------------- | ------- |
| `--pages`      | 1–10                      | 10      |
| `--requests`   | 1–200                     | 80      |
| `--interval`   | 2000–60000 毫秒           | 2000    |
| `--timeout`    | 1000–30000 毫秒           | 15000   |
| `--duration`   | 1000–900000 毫秒          | 600000  |
| `--bytes`      | 1024–5242880 字节         | 2097152 |
| `--frequency`  | 1–1440 分钟（仅约束调度） | 60      |

关闭来源会在下一请求前停止；CLI 的 Ctrl+C/SIGTERM 和 API 正常退出会中止正在进行的请求并保存游标。进程意外退出后，`runs` 或下次同源扫描会在确认数据库锁已释放后恢复中断状态。预算用尽、部分失败或中断返回非零退出码，查看运行记录后续跑；不能把前 10 页视为全站已遍历。独立执行 `cleanup --days 30` 清理过期完整响应；调度启用时也会清理，`INGESTION_RAW_DAYS` 可配置 1–365 天。清理不删除正文、证据、审核或映射。

请求逐跳检查域名及实际公网地址，拒绝内网、metadata、保留地址、跨域跳转和超大响应，并保持 TLS 证书验证。本机代理若将官网解析为 `198.18.*` FakeIP，会被拒绝。此时可在环境变量 `INGESTION_DNS_OVERRIDES` 配置 JSON，例如 `{"xxgc.sicau.edu.cn":["经独立核实的当前公网IP"]}`；仅允许上述两个来源域名及公网地址，请求仍以原域名校验证书并固定连接地址。不要直接复制历史 DNS 地址；官网 DNS 变化后重新核实，或修复本机 DNS 后移除此配置。

源码测试使用最小 HTML 片段、模拟网络和隔离 PostgreSQL schema，CI 不依赖官网可用性。真实网站与完整通知链路验收单独执行，完整 HTML、人工修正文件和结果仅本地保留。新增迁移只增加采集表，不改公开 API 契约；回退时先关闭调度，再回退应用，保留采集与比赛数据，重启新版可继续处理。管理界面、登录站点、PDF/OCR、AI 解析、全院采集与生产部署另行安排。服务端采集不会迁移到客户端；H5 与微信小程序的来源外链、请求域名和复制适配见[迁移待办](docs/agents/uni-app-migration.md)。

## 找队友会话内演示（Issue #13）

`/teams`、`/teams/:id`、`/teams/new` 共用 `useTeamDemoStore`，仅在当前页面会话的内存保留数据，刷新或“重置演示”恢复初始队伍。队长计入人数；申请仅创建待处理演示记录，不改变成员；举报不外发、不进入审核。固定演示参与者独立于认证页面，不写 localStorage、sessionStorage 或模拟 Session；演示类型与 OpenAPI 招募契约分离。

统一角色选项为编程、调研、设计、建模、答辩、其他。容量限制为 2–20 人（含队长）；标题 2–60 字、目标 10–2000 字、进度及技能职责不超过 500 字。截止按北京时间解释，并在提交时校验晚于实际当前时刻；开放、暂停、关闭是示例状态，满员/截止是即时派生结果。

URL 参数为 `q`、`type`（competition/course/innovation/other）、`role`（上述统一角色）、`mode`（online/offline/hybrid）、`status`（available/unavailable）、`competition`（比赛 ID）和 `page`。缺省为全部条件与第一页；重复参数取第一项，关键词去首尾空白并限制 100 字，非法枚举或页码回到默认值，超页 replace 到最后有效页；默认值不写入 URL，无关参数保留。搜索提交生效，其他条件即时生效并回到第一页；详情返回与前进后退保留条件。按发布时间倒序、ID 升序稳定排列，每页 4 条。

可选比赛关联复用公开比赛查询、生成类型与请求入口，支持关键词检索、继续加载、失败重试和迟到响应保护，不把首页第一页当成完整目录，也不静默以样例替代接口。未选择比赛时不因目录故障阻止发布；选中比赛详情尚未成功时需重试或清除。招募截止与官方报名时间分别展示；组队不代表官方报名或资格通过。真实认证、招募写接口、邀请及确认入队由后续任务完成。

## 个人中心会话内演示（Issue #14）

`/profile` 已替换占位页，桌面与移动导航统一为“个人中心”。个人资料、我的队伍、申请与邀请通过 `section=teams|applications` 定位；未指定、非法、空值或重复 section 回到个人资料，规范化使用 replace 并保留无关参数。浏览器直接访问、刷新与前进后退恢复分区。

昵称、校区、学院、专业、年级、技能和简介支持展示、校验、编辑、取消和重置。`useProfileDemoStore` 仅保存当前页面会话的前端示例，路由往返保留，刷新恢复初始资料与默认未授权；不调用业务写 API，不写浏览器持久存储，不模拟登录或身份认证。学院使用 `colleges.ts` 的现有稳定 ID 与本地业务目录，不请求真实学院目录；校区为示例选项，所有资料都是自填示例。

联系方式默认不共享，开关只演示授权状态，不收集或显示真实联系方式。正式可见性仍须同时满足同队有效成员关系与所有者授权；申请者、未确认受邀者与已退出成员不可查看。个人业务统计显示“待接入”，我的队伍和申请邀请以标明“样式示例”的静态列表展示，不提供管理操作，由 #15 承接；首页只保留四个快捷入口，详情分区提供返回导航；原有独立队伍/申请导航及收藏、通知、登录、注册入口保留。真实账号、队伍管理、收藏、通知和权限服务均未接入。

H5 迁移需回归表单标签与焦点、query/History、Tailwind 和安全区域；微信小程序需替换 HTML 表单与 DOM 焦点、页面参数和图标渲染，独立验收，预计成本中。资料规则与会话模型可复用，详见迁移待办。

### 当前个人中心未完成项

- 队伍与申请邀请目前仅展示静态样式；所属队伍、队长管理、邀请确认/拒绝、申请撤回和成员变更由 #15 承接，未与找队友会话状态完成业务集成。
- #15 集成后再移除独立队伍/申请主导航，并为 `/my/teams`、`/my/applications` 增加兼容跳转；当前仍保留原入口。
- 业务统计、收藏与站内通知未接入；示例列表不表示真实队伍关系、申请记录或消息送达。
- 真实账号、资料持久化、联系方式存储和服务端权限未接入。当前授权开关仅展示会话状态，刷新恢复默认关闭。
- 普通 uni-app H5 与微信小程序尚未迁移和验收，Web 检查不代表小程序兼容。

2026-10-09 按最新确认统一使用“个人中心”，保留七项资料（昵称、校区、学院、专业、年级、技能、简介），移除个人中心与招募页的学习时长字段、展示和校验。原 Issue #14 中相关旧要求以本次后续确认与进展评论说明为准。
