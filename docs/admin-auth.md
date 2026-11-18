# 管理员认证、权限与审计

对应 #37。管理后台是独立桌面 Web，使用管理员账号及 `hh_admin_session` Cookie（`Path=/api/v1/admin`）。用户端计划在 M2 接入川农统一身份认证，H5 与 Android 的会话契约见 [ADR 0011](adr/0011-android-h5-and-sicau-only-auth.md)。管理端与用户端各自校验账号和会话。

## 初始化与配置

先通过现有 `db:migrate` 入口应用增量迁移，再在受控服务器的交互终端运行 `pnpm --filter @hehuoda/api admin:init`。它依次询问用户名、显示名、密码和确认密码，密码不回显；不接受命令参数、不提供默认密码、不会覆盖重复账号。数据库连接只从既有私有 `DATABASE_URL` 读取。不要把密码放进命令行、Git、日志或示例配置。

用户名为大小写敏感的 1–64 位 ASCII 字母、数字、点、下划线或连字符；显示名 trim 后非空且最多 80 字符；初始化密码为 12–256 字符。密码使用 Node 内置异步 scrypt，固定 N=32768、r=8、p=3、输出64字节、maxmem=64MiB，每账号随机16字节盐，验证时做恒时摘要比较。此配置对应 [OWASP scrypt 参数档位](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt)，不新增密码算法依赖；以后变更参数须连同已有摘要迁移，不能直接改常量。

| 配置                       | 默认 | 含义                                                          |
| -------------------------- | ---- | ------------------------------------------------------------- |
| `ADMIN_ALLOWED_ORIGINS`    | 空   | 逗号分隔、精确匹配的管理页面 Origin；空值拒绝登录和全部写请求 |
| `ADMIN_SESSION_HOURS`      | 12   | 绝对会话时长，整数1–24小时；刷新不续期                        |
| `ADMIN_RATE_LOGIN_ACCOUNT` | 5    | 每账号每分钟预算                                              |
| `ADMIN_RATE_LOGIN_SOURCE`  | 30   | 每可信来源每分钟预算                                          |
| `ADMIN_RATE_LOGIN_GLOBAL`  | 100  | 全局每分钟预算                                                |

Origin 包含协议、主机和必要端口，不含路径或结尾斜杠，不接受通配符、`null`、用户信息。生产只接受 HTTPS Origin。开发可按实际管理服务端口配置 `http://localhost:端口`；页面和 API 应尽量同源或同站，`SameSite=Lax` 不支持跨站携带 Cookie，不通过改成通配 CORS 或削弱 Cookie 属性解决跨站问题。

容器部署从受保护的部署目录 `.env` 读取上述配置，`compose.deploy.yaml` 显式透传到 API；样例默认保持空 Origin，不自动开放管理员登录。`apps/admin` 将由 #215 以 `/admin/` 子路径整合进 Web Nginx 镜像部署，`ADMIN_ALLOWED_ORIGINS` 须配置为精确 `https://<正式域名>`（不含 `/admin/` 路径与通配符）。初始化命令需要包含本票脚本的新镜像和交互终端；在 API 容器的 `/app` 工作目录直接运行 `node dist-openapi/scripts/admin-init.js`，不在生产镜像内使用 pnpm 编译。仅填部署配置不会创建管理员账号。

三个预算均为 PostgreSQL 持久化的60秒固定窗口；失败同样计数，跨窗口边界最多可能出现双倍瞬时预算。先检查全局预算，再分配账号／来源键，避免随机用户名无限增加窗口行；旧管理员窗口在下次登录时清理，保留约1小时。管理员键有独立前缀，不与学生键混用。来源取 Fastify `request.ip`，仅 `API_TRUSTED_PROXY_CIDRS` 明确允许的最近一跳代理可提供转发来源；不能无条件相信 `X-Forwarded-For`。

现行生产 Compose 暂未划分隔离网络与注入可信代理网段（由 #227 落实），Nginx 后的管理请求会合并计入同一来源预算；账号与全局预算仍生效，但来源限频暂不区分真实客户端。正式开放管理后台前须按 #227 完成网络分段与最近一跳边界验证。

## HTTP 契约

前缀 `/api/v1/admin`，响应（含错误）均 `Cache-Control: no-store`。具体 DTO 见生成的 `apps/api/openapi.json` 和 `packages/api-types/src/generated/schema.d.ts`。

| 方法与路径                        | 行为                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| POST `/auth/login`                | `{username,password}`，必须带允许的 Origin；200 返回 `{id,displayName,expiresAt}` 并设置 Cookie，不返回会话秘密 |
| GET `/auth/session`               | 有效 Cookie 返回当前管理员及原始到期时间，否则401                                                               |
| GET `/auth/csrf`                  | 有效 Cookie 返回 `{csrfToken}`，与当前会话绑定，重载可恢复相同凭证                                              |
| POST `/auth/logout`               | 有效会话须带 Origin 和 `X-CSRF-Token`；撤销并清 Cookie；已退出／无效会话重复退出仍安全返回204，但仍检查 Origin  |
| GET `/dashboard`                  | 返回 `modules`；每项含 module/available/count/scope/asOf                                                        |
| GET `/operations`                 | 审计列表，支持 actorType/actorId/action/objectType/from/to/page/pageSize                                        |
| GET `/operations/:id`             | 单条脱敏审计；非法 UUID 返回400，未找到404                                                                      |
| GET `/competitions`               | 正式比赛分页列表，含 draft/published/hidden，支持 status 与 q；可重新读取基线                                   |
| GET `/competitions/baseline/:id`  | 目标届次当前正式基线；不存在时返回空记录基线（新建前预览用）                                                    |
| GET `/competitions/:id`           | 管理端详情，含不可见于公开端的 draft/hidden 记录                                                                |
| POST `/competitions/:id/preview`  | 变更预览；不提交正式数据，返回预览回执与发布底线缺口                                                            |
| POST `/competitions/:id/commands` | 保存草稿、发布或隐藏；`operationId` 幂等重试返回首次结果                                                        |

比赛写命令要求 `action`（save/publish/hide）、`reason`、`baseline`，可选 `patch`、`previewId`、`confirmPublished`。发布状态只由 publish/hide 改变，save 携带不同 `publication` 返回 400；修改已发布记录未传 `confirmPublished` 返回 409（`COMPETITION_CONFIRM_REQUIRED`）；基线不一致返回 409（`COMPETITION_BASELINE_STALE`）；发布底线不满足返回 422（`COMPETITION_PUBLISH_BLOCKED`，`details.blocks` 逐项列出）；预览回执过期或已被使用返回 409（`COMPETITION_PREVIEW_STALE`）。隐藏后公开列表与详情不再返回该记录，管理端仍可查询。手工维护通道接受公开、无凭据、无非默认端口的 HTTPS 外链；采集与审核通道仍限学校域名。

Cookie 名为 `hh_admin_session`，32字节随机秘密以 base64url 表达，数据库仅存 SHA-256 摘要；HttpOnly、Path=/api/v1/admin、SameSite=Lax、无 Domain，生产额外 Secure。再次登录且携带旧 Cookie 时撤销旧会话；不携带旧 Cookie 的其他设备会话保持有效。退出立即撤销；数据库触发器在账号停用或密码摘要／盐变更时撤销其全部会话，重新启用也不会复活旧会话。账号、会话和审计存数据库，重启应用不会清除有效会话。

服务端用全局 AdminGuard 默认保护所有已注册的 `/api/v1/admin` 路由，显式例外只有 POST 登录和可重复退出；新增管理控制器无需逐个附加守卫。写请求同时检查 Origin 和会话绑定 CSRF，HTTP 不接受 actorId/actorType/reviewer。学生有效 Bearer 请求管理接口返回403；无效／缺失／到期凭据返回401。管理模块首版只有受控管理员这一固定角色，不存在公开注册或动态角色编辑接口。

开发跨源请求须带 `credentials: include`，先读取 CSRF 再写。允许的管理 Origin 获得精确 CORS Origin 和 Credentials，预检只允许声明的写方法及 Content-Type/X-CSRF-Token/Accept 请求头；其他来源不获凭据授权。登录只检查 Origin，不要求已有 CSRF。生产依然需要 HTTPS 终止代理和正确转发配置。

工作台草稿／已发布项分别统计正式比赛的 `publication=draft/published`，空库返回真实0；#39/#40 接入后，pending 统计全部候选中 `status=pending` 的数量，sources 统计固定已实现来源（含停用来源）。各项注明 scope 与 asOf，见[管理采集与审核接口](admin-ingestion.md)。

## 后续业务的事务审计入口

后续管理模块导入 `AdminModule`，从守卫注入的 `AdminRequest.admin` 获取身份。推荐调用 `AdminOperationsService.withOperation(context, operation, async client => { ... })`：它开启事务、锁定并复查账号／会话，业务回调与成功审计在同一 PoolClient 提交，任一失败都回滚；失败尝试回滚后以独立语句记录为 failure，不写错误内容或请求载荷。返回业务 value 和 operationId。

已有事务调用 `recordSuccess(client, context, operation)`；调用方负责 BEGIN/COMMIT/ROLLBACK 和一致锁序（账号→会话→业务资源），必须把业务写入与审计放在同一事务中，禁止改成独立连接记录成功。原有采集服务若自行开启事务，接线时须改用调用方 PoolClient，不能把两个独立事务冒充原子提交。

operation 仅包含 action/objectType/objectId/reason；action 与 objectType 的受支持值在 DTO 中集中定义，后续扩展时同步测试和生成类型。actorType/actorId/requestId 来自服务端上下文；reason 只传可信、脱敏的业务说明，禁止拼接密码、Cookie、CSRF、连接配置或完整原始请求。初始化以 `maintenance`、登录失败以 `anonymous` 记录，不声称是已登录管理员。旧采集 CLI reviewer 日志继续保留，不能据此获得 HTTP 身份。

列表默认 page=1/pageSize=20，上限50，日期区间包含边界；from 不能大于 to。按 createdAt DESC、operationId DESC 稳定排序，单次分页与总数使用同一只读快照。管理员可查全体管理操作，不按个人裁剪；审计没有 HTTP 修改／删除入口，也不返回账号名、盐、密码摘要、会话摘要和载荷。失败审计存储本身不可用时请求失败，不虚构成功；需要受控数据库运维排查。

## 迁移与回退

`0006_admin.sql` 只新增 admin_accounts/admin_sessions/admin_operations、索引和管理员凭据撤销触发器，不修改旧学生表、比赛、通知、审核记录或 CLI 审计。通过现有迁移器单事务、串行执行并记录版本；不重写0004/0005。已有正式库若存在冲突表必须先调查，不强制重复建表或自动删除。

应用回退时回退镜像并保留这三张表、触发器和审计；旧版学生／公开接口仍能查询原数据。可以临时清空允许 Origin 来关闭新管理写入口；正式停用账号还会撤销会话。没有破坏性 down SQL，不删除正式比赛或审计来回退。生产升级先按部署准入执行 prepare 和备份核验，本地数据库测试不代表生产已启用。
