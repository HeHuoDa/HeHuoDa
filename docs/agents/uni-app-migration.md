# uni-app 迁移提醒与集中待办

## Issue #75：会话收藏与跨页面同步

`pages/my/favorites.vue` 新增收藏列表、空态、取消、重新查询与重试；`pages/home/competition.vue` 接通收藏按钮；`ProfileOverview.vue` 的收藏数量读取同一 `useSessionStore`。旧 Web 仅有占位，不存在可像素对照的收藏成品，本票按现有主题和控件直接新增普通 uni-app 功能，不跨应用导入旧端代码，也不补建旧 Web 收藏页。

- 收藏集合只含稳定比赛 ID 与单调递增的收藏顺序，按最近收藏在前去重；取消再收藏置顶。404、网络失败及尚未加载项都保留在总数中。
- 详情沿用真实 `GET /api/v1/competitions/:id` 与现有响应校验。`stores/favorites-controller.ts` 最多同时查询三个比赛，重复同步复用同 ID 在途请求；单项失败单独重试，不回退静态比赛。
- 页面隐藏或卸载时取消在途查询，返回时重新获取当前资料；移除、重置与重新收藏使用记录顺序及请求身份隔离，迟到响应不能覆盖新条目或复活收藏。队伍与资料会话的统一 `reset()` 同时清空收藏。
- 收藏不要求尚未提供的真实登录；不写存储、不新增收藏数据库或业务写接口。H5 刷新、小程序冷启动及统一重置清空，普通页面跳转和返回保留；详情与列表均展示此边界。
- H5 与 mp-weixin 使用相同 `view/text`、`FormButton`、`AppIcon`、Pinia 状态和 `uni.request`。标题、正文、辅助文案使用现有固定 px 的 `text-display`、`text-body`、`text-caption` 主题字号，避免窄屏根字号缩放导致小字；按钮允许换行并维持现有 44px 触控规则。沿用 ADR 0005 原生导航，不新增 DOM、浏览器 History 或动态 SVG 依赖。

验收需区分：真实本地 API 的成功与 404，平台替身的超时、迟到响应、长文案及加载状态；H5 浏览器模拟不代表微信运行。微信开发者工具、iOS/Android 真机、微信网络域名与安全区仍交 #85；可按 PR 约定按需调用微信开发者工具人工验收流程。完整实际命令、视口与结果记录在交付说明，不把编译通过称作双端发布。

## Issue #74：个人中心队伍管理与申请邀请处理

`pages/profile/index.vue` 的 `teams` 分区由 `ProfileTeams` 替换 #73 的只读队伍区，`applications` 分区由 `ProfileApplications` 替换占位页；两处仍读同一个 `useSessionStore`，找队友列表、公开详情、发布流程与个人中心共享同一份队伍、申请、邀请与授权，没有第二套业务集合。分区仍由 `openProfileSection` + `onShow` 消费一次性意图，`switchTab` 不拼 query，`/my/teams`、`/my/applications` 的旧地址继续交给现有 registry／#82，本票没有新增 recordId 深链协议。

`stores/profile-team-controller.ts` 只持有界面状态（分区、选中队伍、编辑草稿、字段错误、首错目标、确认上下文、反馈与演示时钟），队伍动作全部调用 `@hehuoda/client-domain/team-session` 的既有实现（`processApplication`／`respond`／`editTeam`／`manage`／`canViewContact`／`invitationProblem`），未修改领域规则、未新增业务 HTTP 契约或持久化。确认在打开时绑定 teamId／recordId／memberId 及当时的对象身份，提交前与实时会话比对，因此会话 `reset()` 后同 ID 的新对象不会被旧确认或旧草稿操作；权限、记录状态、名额、截止与角色需求由动作层再次校验，隐藏按钮不是唯一约束。自己的申请与邀请在 `applications` 分区，队长收到的申请与发出的邀请在选中队伍的管理详情，与旧 Web 的组织方式一致。

编辑复用 `draftFromTeam` 与 `validateDraft`，字段与发布页一致但没有比赛／赛道选择器：`editTeam` 不覆盖 `competition`／`trackId`，草稿保留既有比赛数据，切项目类型不会静默清空关联；把普通项目改成比赛项目会得到「请选择有效的比赛届次」，需要回到发布流程新建招募。失败保留草稿并定位首错，取消丢弃本次改动，重新打开读取最新队伍。

H5 与微信共用源码，差异按已确认边界保留：

- 旧 Web 的队伍列表、成员详情、申请列表与编辑表单是同一页面内的内联面板，这里改为「列表 + 选中队伍详情」，编辑与确认走 #65 的受控弹层；确认文案写明具体目标与后果，遮罩不取消，取消不产生业务变更。
- 旧端 checkbox 改为原生 `switch`（同 #73 的授权开关），沿用主题品牌变量并补 `role`／`aria-checked`／`tabindex` 与 Space/Enter；移交使用 `FormPicker`（H5 原生 select、微信 picker），不是旧端的 select。
- 关闭招募后隐藏「关闭招募」入口，与「不能暂停或恢复」一致；旧端保留可重复点击的关闭按钮。
- 旧端「边界预览」下拉（满员／到期／暂停／无队伍等，选中即重置会话）不迁移：它会在产品页面提供清空会话的隐藏开关，且 A06 的竞争条件已由固定时钟 + 独立 Pinia fixture 的行为测试覆盖，空态在真实操作路径（退出、解散、撤回）下同样可达。
- 内容最大宽度沿用现有页面壳（640px），旧 Web 的管理面板更宽；面板留白、成员行与按钮间距写固定 px，见学生端样式约定的 #74 例外。
- 隐藏／卸载、切换分区、切换选中队伍与会话统一重置都会关闭确认、丢弃草稿与选择；页面隐藏时停止演示时钟，回到前台重新读取实时会话。

验证：`scripts/profile-team-management.test.mjs` 覆盖队长／成员边界、取消与重复确认、邀请／拒绝／撤销、撤回／接受／拒绝、打开确认后满员／到期／暂停／关闭／解散／角色移除／邀请失效的现场校验、移交后失权与旧确认越权、退出／移除／解散的授权清理、编辑校验与首错、容量与截止边界、取消重开与比赛关联保留、reset 同 ID、会话新队伍、空态与分区清理。`scripts/profile-team-page.test.mjs` 编译真实页面跑生命周期（时钟启停、隐藏清理、卸载后不再响应重置），并挂载真实组件验证按钮可见性与确认、编辑、授权、移交、接受邀请的交互契约。

本地 H5 用真实 Chrome 在 320／375／390／430px 与 1440px 走通「选中队伍 → 编辑 → 关闭招募」与申请分区：无横向滚动（`scrollWidth == clientWidth`），无小于 44px 的按钮，长队名在 320px 正常换行；编辑弹层清空地点后首错提示出现、`aria-invalid=true`、目标字段滚动到弹层可视区顶部，Escape 关闭后焦点回到「编辑招募」。截图与脚本仅保留本地。H5 与 mp-weixin 构建均通过，但微信开发者工具运行、真实 picker／switch 外观与命中范围、系统大字号、安全区、软键盘与 iOS/Android 真机仍交 #85；双端编译通过不代表微信运行或发布完成。本票未触及比赛公开查询，不涉及 API 与数据库。

## Issue #73：个人资料编辑与联系方式授权

`pages/profile/index.vue` 的资料分区通过 `ProfileOverview` 展示旧 Web 的资料卡、七项编辑表单、快捷入口和授权说明，继续复用 `useSessionStore`、`@hehuoda/client-domain/profile` 与 #65 的控件/草稿/受控弹层。不新增资料写 API、浏览器存储或真实联系方式。保存先校验再 trim，技能去重并用顿号连接；失败保留草稿并定位首错，取消、切换分区、页面隐藏和统一重置丢弃草稿。`resetProfile()` 只恢复资料和未授权状态，保留队伍/申请；整组 `reset()` 仍由既有会话入口负责。当前演示用户的队伍成员昵称通过会话 `memberNickname()` 读取最新资料，其他成员保持原名。

联系方式开关使用 uni 原生 `switch` 的 `checked/change`，只更新会话授权；补充 `role/aria-checked/tabindex` 和 Space/Enter 操作，使 H5 自定义宿主也可键盘聚焦、切换。可展示判断仍由共享 `canViewContact()` 执行：所有者授权、队伍未解散、查看者和所有者均为有效成员缺一不可；申请和未确认邀请不建立成员关系，退出/移除/解散后立即失效。页面明确说明这是演示，不收集或显示真实联系方式。

资料卡与快捷入口沿用旧端结构、品牌变量和局部尺寸，H5/微信共用源码；以下差异按已确认的迁移边界保留：

- 导航与内容最大宽度沿用 ADR 0005 和现有页面壳，不恢复旧 Web 侧栏/顶栏。主题的响应式单位会造成各视口少量间距差异。
- 编辑使用 #65 的固定高度、独立滚动弹层，底部固定保存/取消；遮罩不取消，H5 Escape、微信页面隐藏按控件契约取消。旧 Web 的标题栏关闭按钮由底部取消替代。输入/选择在 H5 使用原生 DOM 适配器，在微信使用 uni 输入与 picker；不把 DOM focus、dialog 或滚动锁带入微信公共源码。
- 旧端 checkbox 改为原生 switch，沿主题品牌变量且宿主高度至少 44px（H5 实测 44px）；`color` 与 `change.detail.value` 遵循[官方 switch 契约](https://uniapp.dcloud.io/component/switch)。图标使用 #62 本地字体并显式给定 16/20px 尺寸。微信开关的 CSS 变量颜色、外侧空白的触控命中范围、渲染、辅助技术、键盘与安全区需继续实测。资料区固定 px 的局部复刻例外已登记在学生端样式约定。
- 保留 #72 已交付的只读队伍组件及详情入口，不复制旧 Web 的队伍管理面板；管理和申请分区归 #74。收藏/通知连接现有预留页面；“关于禾伙搭”继续为静态说明，独立功能归 #77。

本地 H5 已在 320/375/390/430px 与旧 Web 相同默认资料对照，另检查 1440px；覆盖长昵称/专业/简介、八项技能、空技能/简介、校验错误弹层与首错焦点、保存取消、跨页昵称、授权切换及刷新恢复。当前资料和授权没有请求加载态，网络错误态不适用；同步保存异常由草稿组件保留输入并提示重试。运行型源码测试覆盖七字段非法输入、重开/规范化保存、资料单独重置、授权双条件及成员失效。本票未执行微信开发者工具人工验收；H5 和双端编译不代表微信运行，iOS/Android 真机、软键盘/浏览器地址栏和安全区等继续交 #85。迁移成本主要是消费现有控件，未增加平台专用业务状态。

## Issue #70：找队友列表与招募筛选

`pages/teams/index.vue` 只消费 #64 的共享会话队伍，不建招募后端接口、不持久化。筛选字段沿用源 `TeamFilters`（`q/type/role/mode/status/competition/page`），`TEAM_PAGE_SIZE=4`；源规则没有学院字段，因此**不使用** #66 的 `CollegePicker`，也不凭旧 Web 组件依赖新增学院筛选。状态判定复用 `recruitmentStatus`（解散 → 关闭 → 暂停 → 截止 → 满员 → 招募中），比赛报名状态与招募状态分别计算。

`stores/team-list-controller.ts` 持有筛选、页码、演示时钟与关联比赛查询，页面只做渲染与生命周期。分页越界时 `reconcilePage()` 把纠正值**回写** `filters.page`（对应旧 Web `router.replace` 语义），保证进详情携带的页码一定有效；`navigation/team-query.ts` 把 `TeamFilters` 归一为单值 query（`teamRouteQuery` / `parseTeamRouteQuery`），解决 `writeTeamFilters` 返回 `string | string[] | undefined` 与 `openPage` 单值参数不兼容。

关联比赛按五态呈现：`idle`（无条件或隐藏时中断）、`loading`、`ready`、`missing`（404，文案「不存在或已隐藏」，只给清除条件，不提供无意义的重试）、`error`（网络/超时/5xx，展示请求编号并允许重试）。两类失败都不伪造比赛、不阻断列表。请求用代次校验丢弃迟到响应；`cancel()` 只中断在途请求，仅 `loading` 回落 `idle`，已落定状态不被抹掉；页面重新显示时只对 `idle` 补发请求。

导航沿用 #68/#69：H5 与微信都不新增浏览器 History 层，筛选与页码存在页面实例内；进详情/发布用规范 query，`returnToTeams()` 在上一页是列表时 `navigateBack`，空栈时通过 `openTabWithQuery("teams")` 一次性交接，由列表 `onShow` 消费。**H5 地址栏不同步筛选**：实测在已存在的 tab 页上只改 hash query 不会重跑 `onLoad`（uni H5 tab 页实例复用），应用内一律走 Pinia 交接；地址栏可分享/刷新恢复属 #82。

跨端与旧 Web 的可感知差异：`FormPicker` 始终渲染可见标签，旧 Web 手机端为 `sr-only`，按触控可读性取舍；H5 为原生 `select`，微信为 `picker`（弹层），交互形态不同。布局移动优先：搜索行 + 4 个下拉 2 列（≥640px 4 列）、卡片 <900px 单列 ≥900px 双列，页面自身留白写固定 px。重置演示在分页下方，按钮旁**可见**说明「重置会恢复队伍、申请、邀请，以及资料与联系方式授权」，因为 `session.reset()` 同时重置资料与授权，不再只靠 `title` 提示。

已知基线问题（非本票引入）：`base.css` 的 `.hhr-button` / `.hhr-input` 内边距用 rem，而 uni H5 在 768–960px 区间把根字号放大到约 33–38px，共享控件在该区间会变高（按钮 62–70px）。320/375/390/430px 与 1024/1440px 不受影响，旧 Web 无此现象。属 #61 单位策略的跨页影响，需单独决定是否改为 px，本票未改共享样式。

验证：`scripts/team-list.test.mjs` 覆盖固定时钟六态、多条件筛选与排序分页、页码回写与越界往返、比赛五态与取消/迟到响应、时钟幂等、发布后立即可见、重置恢复，并编译真实 SFC 跑生命周期（参数恢复、跳转携带有效页、隐藏中断）。H5 本地用隔离 PostgreSQL + `pnpm --filter @hehuoda/api dev` 验证关联比赛真实查询：存在 → 资料文案、不存在 ID → `missing`、请求中止 → `error` 并可重试恢复；`?competition=` 直接进入时 H5 因 tab 页实例复用需硬刷新才重跑 `onLoad`，属上述地址栏限制。320/375/390/430px 无横向溢出，长标题换行不撑破卡片，第 2 页进详情返回仍第 2 页。截图与脚本仅保留本地。

本票完成 H5 与 mp-weixin 构建、控制器/页面/导航测试；微信开发者工具运行、真实控件与 picker 弹层、请求合法域名、系统大字号、安全区与 iOS/Android 真机仍由 #85 验证，双端编译通过不代表微信运行或发布完成。

## Issue #69：比赛详情、赛段定位与关联招募入口

`apps/uni/src/pages/home/competition.vue` 通过现有 `uni.request` 客户端独立查询 `CompetitionDetail`，不复制列表对象或回退到演示数据。详情控制器在换比赛、隐藏及卸载时取消请求并隔离迟到响应；404、网络/超时/5xx 和加载状态分别呈现，重试前清空旧内容。届次、赛道、赛段、来源、北京时间及日期精度沿共享规则展示，报名与材料截止分别说明。

赛段参数只匹配当前详情中的稳定 ID；渲染节点使用索引生成选择器，在 `onReady` 与 Vue `nextTick` 后调用两端共同的 `uni.pageScrollTo({ selector })`，无效 ID 或平台滚动失败显示反馈并保留完整详情，不调用 DOM `scrollIntoView`。依据：[pageScrollTo 官方参数](https://github.com/dcloudio/unidocs-zh/blob/master/docs/api/ui/scroll.md)，H5 支持 selector，微信要求基础库 2.7.3+；编译及平台替身不能证明微信实际滚动成功，仍交 #85 验证。

列表入口携带清洗后的筛选及页码，显式空 `hosts` 不丢失；正常返回复用首页页面栈，空栈或来源页不是首页时，通过会话内一次性主导航参数交接返回首页。关联招募沿旧端只交接 `competition`，不增加赛段过滤；找队友页当前仅消费比赛条件并显示待开发说明，后续 #70 接入列表时复用 `consumeTabQuery("teams")`。H5/微信共用 `switchTab` 与 Pinia 交接，不新增浏览器 History 层；手工改同页面 hash query、旧地址与刷新兼容仍由 #82 验证。

来源动作集中在 `CompetitionSourceAction.vue`，两处来源展示均复用该组件。目前仅展示真实 URL 和明确禁用的待接入动作；打开/复制留给 #80，收藏留给 #75，不能据此认为外链或收藏已实现。不新增业务术语、后端接口或持久化。

布局对照旧 Web 详情采用固定 px 的字号、卡片留白及网格间距，避免 uni H5 根字号缩放改变视觉；沿现行主题变量，20px 手机水平留白、22px 卡片内边距和至少 44px 主要操作。保留 ADR 0005 已批准的原生导航结构差异，来源动作待接入、无效赛段反馈及空数据文案是本票明确的内容差异。局部单位例外不改变其他页面策略。H5 已以本地公开 API 检查真实详情、404、断网重试、赛段定位及第二页往返；复杂长文本、未知/冲突时间和空数组以契约替身单独验证，四档 320/375/390/430px 与旧 Web 对照，无横向溢出。截图保留本地，不提交 Git。

本票完成 H5 与 mp-weixin 构建、请求/生命周期/导航测试，不代表线上或真机验收。微信开发者工具人工流程本次未执行；真实控件、基础库滚动、请求合法域名、系统大字号、iOS/Android、浏览器地址栏及安全区仍由 #85 验证。可按[微信开发者工具人工验收流程](pull-requests.md#微信开发者工具人工验收按需)按需继续。

## Issue #68：首页比赛发现与真实公开查询

首页 `pages/index/index.vue` 消费 #66 的学院组件、共享领域筛选/北京时间规则和 #63 的 `uni.request` 适配器。`api/competition-client.ts` 负责公开目录与列表契约，`stores/discovery-controller.ts` 负责页面实例内目录复用、筛选重置页码、服务端分页纠正、重试与请求代次隔离。目录 ID/名称/顺序核对通过后才请求比赛；显式空学院传 `hosts=`，失败不降级为静态数据或空结果。目录与筛选不持久化。

`onHide/onUnload` 中取消请求并使旧响应失效，`onShow` 恢复被中断的查询；已完成结果、筛选和页码在首页实例内保留。卡片通过统一导航传递真实比赛 ID 与赛段 ID，详情内容由 #69 交付；浏览器刷新、地址恢复仍由 #82 集成。

按用户确认沿用 ADR 0005 的双端原生导航，保留首页内容中的学院筛选栏和比赛卡片，不恢复旧 Web 全站侧栏。内容使用相同主题、字号和固定 px 留白，宽屏保留 340px 学院栏；卡片标题操作区至少 44px，较旧 Web 单行标题增加触控空间。搜索复用 FormInput，H5 标签与确认键落在真实输入控件上；状态筛选使用现有 FormPicker：H5 为可键盘操作的原生 select，微信为 picker；空字符串是合法的“全部状态”，不插入同值占位选项。请求参数使用 encodeURIComponent 编码，不依赖浏览器 URLSearchParams、Router、DOM 或 AbortController。

H5 浏览器模拟与双端编译分别验收。微信 picker、真实网络/合法域名、键盘、安全区、系统字号与真机行为仍需 #85 独立检查；可按 PR 约定调用微信开发者工具人工验收流程，构建通过不代表已完成运行验收。请求/分页状态适配成本低至中，原生导航的已接受差异见 ADR 0005。

## Issue #67：登录注册表单与未开放服务反馈

本票交付 `pages/auth/login.vue`、`pages/auth/register.vue` 与共用 `components/AuthForm.vue`，规则集中在 `forms/auth-form.ts`（纯函数，`scripts/auth-form.test.mjs` 覆盖校验矩阵与首错顺序）。认证与验证码服务仍未开放：合法提交只提示“认证服务暂未开放”，发送验证码只校验邮箱后提示“验证码服务暂未开放”，不请求接口、不建立会话、不写存储、不生成倒计时。

与旧 Web `AuthView.vue` 的结构差异：**不使用 HTML form 元素**。H5 下 `FormButton` 渲染为 `view[role=button]`，没有原生 submit 语义，提交只绑定在提交按钮 `@click` 与输入框 `confirm`（密码框仅登录、验证码框），显隐与发送验证码在结构上无法触发提交；代价是旧 Web 中“表单内任意 Enter 提交”在只填部分字段时不再触发。`role=status`/`aria-live` 只在 H5 有效，微信读屏另行验证，交 #85。

跨端清空：密码、确认密码与验证码在页面 `onShow` 时清空，邮箱与昵称保留续填；登录/注册互跳沿用 `replacePage`（`redirectTo`），返回不会回到带密码的表单。`redirectTo` 后页面实例会重建，`onShow` 清空主要覆盖切后台回前台与页面栈返回场景，两条路径均已实测。

样式对齐前的注意点：认证页间距必须写固定 px。uni-app H5 按视口缩放根字号（375px 宽时 1rem = 15.36px），rem 会让 20px 留白缩到 19.2px、430px 涨到约 22px，与旧 Web 出现可见差异；此为对照迁移例外，与 #65 表单、#63 健康页一致。320px 下旧 Web 自身横向溢出（`scrollWidth` 320 > 可视 305），新客户端无溢出，属已知有意差异。

适配成本低。H5 五档视口与旧 Web 逐项数值一致（375/390/430/1440），PASS；微信真实键盘类型、验证码输入法行为、读屏反馈与安全区仍交 #85。

## Issue #65：复用表单与受控弹层

本票交付基础组件与完整组件 fixture，业务整页继续归 #67/#71/#72/#73/#74。输入/密码显隐、选择/日期时间、草稿与保存取消接口见[组件契约](../uni-forms.md)。不新增认证、持久化或业务写 API。

H5 采用条件编译的真实输入/选择控件和独立浏览器弹层适配器，补齐标签/错误关联、Tab/Escape、焦点恢复、背景 inert 与 visualViewport；DOM 查询只存在于 H5 适配器。微信使用原生 input/textarea/picker/button、scroll-view、键盘高度监听与页面隐藏取消；不使用浏览器 dialog、body 锁或 HTML form 属性。微信 picker 不支持程序化 focus，首错通过滚动和错误文本定位；微信原生返回会离页并丢弃草稿，不宣称可拦截返回。tab 页面弹层期间暂时隐藏原生 tabBar，关闭时恢复。

日期和时间分别选择，组合无时区的北京时间字符串，再由共享 `deadlineInstant` 严格转为 UTC+8 时间戳；输入原值和密码不做隐式 trim。窄屏下日期时间换行，标题/操作固定、中部滚动，底部保留安全区。弹层内控件须 `adjustPosition=false`，由弹层统一响应键盘高度，避免重复顶起。

适配成本中。H5/微信编译和平台替身测试不能证明微信实际键盘、原生 textarea 层级、控件聚焦、日期面板和 tabBar 运行效果；iOS/Android、移动 Safari 动态地址栏/软键盘、微信真实基础库和安全区仍交 #85。官方依据和本地 fixture 用法见组件契约，后续消费页面须完成自己的整页对照与业务验收。

## Issue #64：共享规则与内存会话入口

纯规则迁入 `packages/client-domain`，公开入口、源规则/测试映射及状态拥有者见[共享包说明](../../packages/client-domain/README.md)。Web 保留 Pinia 4 适配，新客户端通过 `apps/uni/src/stores/session.ts` 的 `useSessionStore()` 使用本应用唯一 Pinia 3；共享包只依赖公开 DTO 类型，uni 不导入旧 Web 源码。资料、队伍/申请/邀请/授权及派生索引在应用内共用，整组 `reset()` 恢复示例并关闭授权，后续收藏/通知可注册重置动作。此处是会话演示，不接真实认证、业务写 API 或存储。

比赛/队伍筛选使用平台无关 query 类型，学院 all、空数组和自选数组仍分别表达；具体路由、业务 ID 冲突校验、原生输入控件留在各应用。北京时间显示改为固定 UTC+8 的 UTC 日期运算，避免 Intl 时区数据依赖，保留既有显示文案与日期/时刻精度；招募截止严格解析 `YYYY-MM-DDTHH:mm`，非法日历日期和恰好到期仍按源规则拒绝。H5 与微信采用同一规则，需在 #85 继续验证目标运行时的 ISO 日期与平台输入值。

`apps/web/src/data/team-clock.ts` 的定时器未进入共享包；业务页迁移时须用 uni 页面的显示/隐藏/卸载生命周期管理时钟，回到前台后重新计算截止状态。当前没有迁移完整业务页面；本票双页同步用本地临时验收页验证，临时页面、截图和脚本不提交。后续页面接入状态与时钟的成本低至中，微信运行、真机控件/键盘/安全区继续交 #85；本地测试或双端编译均不代表发布验收。

2026-10-19 已用微信开发者工具 2.02.2608060、SDK 3.17.4、390×844 模拟屏幕（窗口 390×671）验证两页实际消费同一会话：申请不入队、邀请不占名额、确认只增加一次成员，资料/授权和申请/邀请跨页同步，另一页 reset 后恢复示例并关闭授权；同时核对学院三态、非法日期拒绝及北京时间跨 UTC 日期边界。使用既有本地 AppID，未关闭域名校验，未接业务写 API；检查期间存储键为空，控制台未检出 error。该记录仅证明开发者工具模拟器运行，未验证微信实际客户端、iOS/Android 真机及发布；临时验收页已恢复，截图与结果留本地，完整证据写入 PR。

## Issue #62：统一图标、Logo 与院徽

新客户端已提供 `AppIcon`、`ProjectLogo`、`CollegeEmblem`、`ResourceImage`、`LoadingIndicator`，接口、资源来源、维护边界与预算见[资源契约](../uni-assets.md)。11 个业务名称以本地内嵌字体显示，保留旧端 1.5px Lucide 描边、尺寸和颜色继承；底栏普通/选中状态使用同源 PNG，不依赖图标服务。未知图标显示问号，图片坏路径与缺徽显示可读文字，换源后重试。两端继续共用原生导航，保留 #60 已接受的导航结构差异。

Logo 为完整 160px PNG（40px 组件下 4 倍密度），原始生产图保留在旧端。25 张院徽转为 PNG，保留原始比例、27 个稳定学院 ID、两所缺徽学院和白色图案底色；不依赖本地 WebP 的平台解码差异。新客户端未引入跨应用运行时导入、动态 SVG 或额外生成链，第三方通知同时随静态资源打包。

H5 需检查资源回归页、认证 Logo 和三项底栏的正常/选中状态、错误回退、减少动态效果及缓存后的断网切换；H5 冷启动离线缓存应用壳不在本票范围。微信需在实际基础库与 iOS/Android 上检查 base64 字体、PNG 清晰度、颜色继承、图片错误事件、辅助技术与减少动态效果，转 #85。上传工具主包/分包量测及官方最新限额核验交 #87，目录大小仅作内部预算。两端本地编译与 Vue 宿主替身测试不代表微信运行、真机或发布完成。

## Issue #59：正式工程基础

当前开始逐页迁移，`apps/uni`（`@hehuoda/uni`）与旧 Web 并存；管理端、NestJS/PostgreSQL、采集继续在服务端。本任务建立双端编译、类型检查与最小交互入口，不新增真实认证、业务持久化、消息投递或线上切换。开发/构建、平台配置及锁定版本见[README](../../README.md#uni-app-用户端迁移中)。下文旧任务中“尚未建立工程”等描述保留其历史验收边界，不代表当前工程状态。

直接依赖仍为 Vue / runtime-core 3.5.42、Pinia 3.0.4、Tailwind 4.3.3、weapp-tailwindcss 5.6.3；使用已验证的 DCloud 5.24 套件 / Vite 5.2.8。DCloud 内嵌 Vue 3.4.21 是另一层事实，不能将安装版本写成实际运行时版本，也不能将最小交互通过外推为 Vue 3.5 新 API 全部可用。内部 server-renderer 保留 3.4.21，并通过限定到精确 DCloud 包版本的 packageExtensions 使用匹配宿主；不强制替换内部编译器、不隐藏 peer 警告、不修改整仓 node-linker。两端继续分别编译和验证，后续页面按实际 API 需求评估适配。

### 阶段一 18 项能力与迁移任务映射

以下是已核对源码的迁移边界，表中后续任务并非本工程入口已经交付的业务功能。新客户端不得从 `apps/web/src` 跨应用导入；纯规则、文案、业务类型和适用测试在对应任务内提取复用，页面模板和平台能力单独适配。

| 能力                     | 旧 Web 路由 / 实施入口                                         | 新客户端任务                                       |
| ------------------------ | -------------------------------------------------------------- | -------------------------------------------------- |
| 首页与主导航             | `/home`、`StudentLayout.vue`                                   | #60 导航；#68 首页                                 |
| 比赛筛选与分页           | `/home`、`CompetitionListView.vue`、`competition-discovery.ts` | #68                                                |
| 比赛详情与赛段           | `/home/competitions/:id`、`CompetitionDetailView.vue`          | #69                                                |
| 招募列表                 | `/teams`、`TeamListView.vue`                                   | #70                                                |
| 发布招募与关联比赛       | `/teams/new`、`TeamNewView.vue`、`TeamCompetitionPicker.vue`   | #72                                                |
| 队伍详情、申请与邀请确认 | `/teams/:id`、`TeamDetailView.vue`                             | #71                                                |
| 资料编辑与联系方式授权   | `/profile`、`ProfileView.vue`、`profile-demo.ts`               | #73                                                |
| 队伍管理                 | `/profile?section=teams`、`ProfileTeams.vue`                   | #74                                                |
| 申请邀请处理             | `/profile?section=applications`、`ProfileTeams.vue`            | #74                                                |
| 旧地址重定向             | `/my/teams`、`/my/applications`、`router/index.ts`             | #60 注册映射；#82 H5 深链接与返回                  |
| 收藏                     | `/my/favorites` 当前为占位                                     | #75 直接实现 #33 明确需求，不复制占位页            |
| 站内通知                 | `/notifications` 当前为占位                                    | #76 直接实现 #34 明确需求，不复制占位页            |
| 关于                     | `ProfileView.vue` 中“关于禾伙搭”入口，无独立有效页面           | #77 直接实现 #35 明确需求                          |
| 登录注册及未开放反馈     | `/login`、`/register`、`AuthView.vue`                          | #67 已迁移表单与未开放提示                         |
| 健康查询                 | `/health`、`HealthView.vue`、`api/http.ts`                     | #63 统一请求；#78 公开契约集成                     |
| 失效入口                 | `NotFoundView.vue`、兜底路由                                   | #60；#82                                           |
| 共享控件与资源           | `components/`、`style.css`、`assets/`                          | #61 主题、#62 图像图标、#65 表单弹层、#66 学院选择 |
| 会话重置与计时           | `stores/`、`TeamDemoReset.vue`、`team-clock.ts`                | #64 规则与状态入口；#79 生命周期与统一重置         |

收藏、通知、关于不等待旧 Web #33/#34/#35 的产物。每个页面任务交付自身行为、状态、平台分支及本地 H5 验证；#78/#79 负责集成，不能代替页面任务的功能验收。

本地构建不依赖 #58 的外部账号资源。当前仅验证工程与编译；微信开发者工具实际运行、iOS/Android 真机、合法域名、键盘和安全区域由 #85 集中验证，#86/#88/#89 发布准入仍需独立完成，#90 满足回滚保留条件后退役旧 Web。Vite 5 的上游维护及已公开开发服务器风险见 README，编译通过不等于发布准入通过。

## Issue #61：主题与基础样式

`apps/uni` 已建立独立样式入口：`src/app.css` 只做导入与内容源声明，`src/styles/theme.css` 保存 `--hhr-*` 主题与 Tailwind 4 语义映射，`src/styles/base.css` 保存 `page` 根节点、`.hhr-page` 容器与 `.hhr-*` 组件类。色值、字体与圆角与旧 Web 同源，页面不再维护第二套品牌色；`scripts/style-contract.test.mjs` 校验入口唯一、映射完整、单位策略与 `pages.json` 静态窗口色一致。样式基线页 `pages/style/index`（H5 `/#/pages/style/index`）用于逐项回归。约定详见[学生端全局样式](../../docs/student-ui-style.md#uni-app-用户端样式迁移中)。

两端实测确认的单位策略：

- 字号、触控下限、边框、圆角与断点写 px。uni-app H5 运行时按视口宽度设置根字号（1rem ≈ 视口 / 23.4375），字号若写 rem，320px 宽会缩到约 12px，输入框低于 16px 还会触发 iOS 聚焦放大；固定 px 让 H5 与小程序字号同值。
- 间距与宽高继续写 rem，由 weapp-tailwindcss 换算为 rpx；H5 根字号同样随视口缩放，375px 宽时两端都是 1rem = 16px / 32rpx。
- 断点写 px（640 / 768 / 1024），避免 rem 断点经 rpx 换算后失效。

跨端事实与待验证项：

- 禁用态使用 `[disabled]` 与 `.is-disabled`：H5 把 button 渲染成 `uni-button` 自定义元素，`:disabled` 伪类不匹配；两端框架给 `[disabled]` 的灰色底由组件类按变体覆盖。
- 悬停规则只在 `@media (hover: hover)` 内，小程序构建会移除该规则。
- `sm:` 在 H5 输出 `@media (width >= 640px)`，小程序构建改写为 `min-width`；小程序端媒体查询实际生效情况未在开发者工具或真机确认。
- `uni-button` 不带 `tabindex`，H5 键盘无法聚焦按钮；焦点环样式已就绪，页面任务需要时补 `tabindex` / `role`，无障碍完整验收另行安排。
- `env(safe-area-inset-bottom)` 已在容器预留，iOS 真机、微信基础库与系统大字号（含 H5 浏览器字号设置）未验证，转 #85。

本轮证据：H5 生产构建在 320 / 375 / 390 / 430px 逐项读取计算样式（品牌色、字号刻度、按钮正常/禁用/加载/危险、徽标、输入框 16px、44px 触控区、条件类切换、长标题与长按钮换行、无横向溢出）；mp-weixin 构建产物确认 `page` 基础样式、`--text-*` 的 px 值、rem→rpx 换算、`[disabled]` 规则与 `min-width` 媒体查询。浏览器模拟与编译通过不代表微信运行或真机正常。

## Issue #60：导航骨架与旧地址映射

用户端已建立可挂接业务页面的导航骨架，决策与取舍见 [ADR 0005](../adr/0005-uni-navigation-shell.md)。

- 页面注册与标题：`apps/uni/src/pages.json` 注册 12 个页面；`src/navigation/routes.ts` 是路径、标题、主导航类型、旧 Web 来源与开发状态的唯一注册表。`scripts/navigation-contract.test.mjs` 校验两处双向一致、标题同源、`tabBar` 三项与注册表一致、旧路由清单完整。
- 主导航：原生 `tabBar` 三项（首页 / 找队友 / 我的）用 `switchTab`；普通页面用 `navigateTo` / `redirectTo`；`backOrHome()` 在页面栈只有一页时回首页。跳转只经 `src/navigation/navigate.ts`，页面与组件不直接调用 `uni.navigate*`，也不读写 `document.title` 或浏览器 History。
- 旧地址映射：`sourceRoutes` 登记旧 Web 全部路由，`resolveSourceAddress()` 解析静态路径、`:id` 动态段与个人中心分区；未迁移项（`/health`）写明原因。`/my/teams`、`/my/applications` 固定映射到「我的」的队伍/申请分区。
- 个人中心分区：`switchTab` 不支持 query，`openProfileSection(section, query)` 通过一次性 Pinia 状态交接分区与附加参数，旧地址解析结果分别保留 `section` 与 `query`。目标页先在 `onLoad` 解析深链，再消费交接；`onShow` 与后续监听处理已挂载页面，附加参数存入页面 `routeQuery`。字符串数组会复制，消费后清空交接，避免被调用方修改或残留到下一次进入。非法分区回落到资料区并显示提示，`section` 只接受 `teams` / `applications`。
- 参数规则：缺失、空白、重复冲突与非法业务 ID 都有明确提示；业务 ID 允许字母、数字与连字符，最长 64。uni-app H5 会把 `?id=a&id=b` 合并为 `"a,b"` 再交给 `onLoad`（已在本轮 H5 产物实测），因此单值参数按逗号拆分后判定：取值一致接受，不一致判为冲突。参数只用于定位内容，不代表身份或权限。
- 预留页：三个主页、比赛/队伍详情、发布招募、收藏、通知与登录注册先交付“待开发”占位、标题、说明和入口链，页面任务替换内容；认证页只搭品牌布局（`src/layouts/AuthBrandLayout.vue`），表单与未开放反馈留给 #67。
- H5 兜底：启动时检查一次 hash 是否命中注册表，未命中转到 404（`src/navigation/h5-entry.ts`，`#ifdef H5`，小程序产物不含该分支）。
- 两端共用：按用户在本轮审查后的决定，H5 与微信小程序保持相同页面、组件与原生导航实现，接受与旧 Web 顶栏、侧栏、详情页底部导航的差异；本轮修复不新增 H5 专用布局。`scripts/profile-navigation.test.mjs` 执行真实个人中心 setup 并按平台顺序触发替身生命周期，覆盖首次/再次分区交接、附加参数消费和平台导航兜底；它不替代微信开发者工具或真机验证。

### 源路由映射清单

| 旧 Web 路由              | 新客户端页面                                    | 说明                                      |
| ------------------------ | ----------------------------------------------- | ----------------------------------------- |
| `/`                      | `pages/index/index`                             | 旧入口重定向到首页                        |
| `/home`                  | `pages/index/index`                             | 筛选参数由 #68 在目标页解析               |
| `/home/competitions/:id` | `pages/home/competition`                        | `id` 为稳定业务 ID                        |
| `/teams`                 | `pages/teams/index`                             | 筛选参数由 #70 在目标页解析               |
| `/teams/new`             | `pages/teams/new`                               | #72                                       |
| `/teams/:id`             | `pages/teams/detail`                            | `id` 为稳定业务 ID，详情由 #71            |
| `/my/teams`              | `pages/profile/index`（`section=teams`）        | 旧地址固定映射到队伍分区                  |
| `/my/applications`       | `pages/profile/index`（`section=applications`） | 旧地址固定映射到申请分区                  |
| `/my/favorites`          | `pages/my/favorites`                            | #75                                       |
| `/notifications`         | `pages/notifications/index`                     | #76                                       |
| `/profile`               | `pages/profile/index`                           | `section` 只接受 `teams` / `applications` |
| `/login`、`/register`    | `pages/auth/login`、`pages/auth/register`       | #67                                       |
| `/health`                | 不建页面                                        | 服务端公开接口，由 #63 / #78 接入         |
| 未匹配地址               | `pages/not-found/index`                         | 应用内解析与 H5 未知 hash 入口均转到该页  |

### 平台差异与待验证项

- 旧 Web 在移动端有顶栏与底部三栏导航，详情页也保留底部导航；新客户端用原生导航栏与 `tabBar` 替代，非 tab 页面不显示底部导航。这是平台导航的标准形态，不能通过自定义布局完全复刻。
- `tabBar` 目前只有文字，没有旧 Web 的图标与浅绿选中块；图标资源、尺寸与选中态属 #62，平台边框与高度不可定制。
- H5 浏览器标签标题为 `navigationBarTitleText`，不再拼接“· 禾伙搭”；统一标题后缀与 pathname 旧地址、刷新、浏览器返回由 #82 验证。
- 个人中心分区在当前会话内保留，再次点击“我的”不会强制回到资料区，与旧 Web 每次进入 `/profile` 重置略有差异。
- 本轮 H5 证据：320 / 375 / 390 / 430px 对照旧 Web 的收藏、通知、登录、注册与 404 页，标题字号 30px / 行高 36px、正文 14px / 行高 28px、面板留白 24px（404 为 22px）、无横向溢出；交互检查覆盖主导航切换、详情入口、空页面栈返回首页、缺失/非法/重复冲突参数、分区深链与非法分区回落、登录注册互跳、H5 未知 hash 兜底。截图与脚本仅保留本地。
- mp-weixin 仅完成编译检查：`app.json` 的 `pages` 与 `tabBar`、页面 WXML、`--window-bottom: 0px` 与 rem→rpx 产物；微信开发者工具运行、真机、键盘、安全区域与系统大字号转 #85。编译通过不能证明平台运行正常。

## Issue #63：统一请求与健康页

- `apps/uni/src/api/http.ts` 使用回调式 `uni.request`，返回 Promise 与 `cancel()`，不复制 Axios、浏览器 AbortController 或 Web 源码。`RequestTask.abort` 与健康控制器的请求代次保护共同处理迟到结果；页面隐藏/卸载时取消，取消不显示业务失败。
- `api/config.ts` 校验 API 基址和 1–60000ms 超时；H5 development 才有默认相对地址及 Vite 开发代理。正式缺地址明确失败，小程序始终需要完整地址。公开配置及端口调整见 README 的「统一请求与健康页」。不增加认证、会话或自动重试写操作。
- `pages/health/index.vue` 与导航注册表接入独立健康页，取代 #60 将 `/health` 标记为不建页面的预留说明；同源码面向 H5 与 mp-weixin。H5 原生导航栏按 ADR 0005 保留，因此可用视口与旧 Web 有差异；页内延续旧版的 576px 容器、20/48px 留白、24px 面板、18px 圆角、字体与控件。页脚改为进程存活说明，避免将健康结果解释为数据库或业务就绪。
- 请求 ID 使用可换行 `text`，加载使用已有 CSS `LoadingIndicator`，Logo 使用已有 `ProjectLogo`；未引入 DOM 控件、动态 SVG、浏览器 History 或新的运行器。`overflow-wrap:anywhere` 在 H5 和微信开发者工具中已验证，真机长文本及系统字号仍需 #85 确认。
- 已完成本地 H5 健康成功、停止 API 后失败、重启后手动重试恢复；健康不访问数据库，因此本票验证未启动或修改 PostgreSQL。平台替身覆盖非 2xx、缺失/畸形响应、超时、断网、取消与 A/B 竞态；两端编译独立于真实微信网络验收。
- 2026-10-19 微信开发者工具 2.02.2608060、基础库 3.17.4、iPhone 12/13 (Pro) 模拟器（屏幕 390×844，可用窗口 390×671）：使用既有本地 AppID，`urlCheck=true`，开发地址显式配置为本机 API，真实 `GET /api/v1/health` 返回 200 与请求 ID；刷新更新 ID，停止本任务 API 后显示离线/重试，重启后实际点击恢复在线。未改生产配置或数据库，本地 HTTP 成功不代表生产 HTTPS/合法域名验证完成。
- 同一微信模拟器的平台替身验证：`success` 返回 500 时展示失败与 `wechat-http-500`；延迟请求下连续点击仅发 1 次并禁用按钮；导航离开再返回触发第二次查询，第一条响应延迟 45 秒返回后仍显示 `lifecycle-2`；220 字符长 ID 分行、按钮高 44px 且仍可触达。已恢复真实 `wx.request` 并复查成功；截图及验收产物仅保留本地，PR 记录证据。
- 真实微信生产合法域名、HTTPS、设备网络、原生可访问性、键盘/地址栏、安全区及 iOS/Android 真机仍交 #58/#85；模拟器生命周期通过不等于真机后台网络中断已验证。

## 官方通知增量恢复修复

预算分配、日期窗口、定时续跑链与列表条目诊断均在后端执行，本次不新增用户端 API 或浏览器能力。H5/微信小程序继续读取已发布比赛；官网外链仍按既有跳转、web-view 与复制方案独立适配，服务端修复不证明小程序兼容。迁移成本不变，两个目标端尚未实测。

## 时间与目标

项目采用普通 uni-app，目标为 H5 和微信小程序。当前旧 Vue Web 继续运行，新工程按上表逐页迁移；此文登记适配点，不表示业务页面已经迁完。小程序实际运行验收尚未完成。

## 持续协作规则

以后开发中，遇到影响跨端的选型或实现，在确定方案或引入实现时：

1. 指出具体 API、组件、样式及源码位置。
2. 分别解释 H5、微信小程序影响，明确区分官方已知限制、推断与待验证事项。
3. 提供替代方案，或说明迁移需做的适配与成本。
4. 在方案、Issue 或 PR 记录已采用方案及成本，重要事项同步本表。发布 Issue 仍遵循 issue-tracker.md 的先展示与确认规则。

不能用 Web SVG 正常、Chrome 样式正常或 jsdom 通过来推断小程序兼容。功能验收与跨端验收分别记录；后续验证时记下 uni-app/微信基础库版本、设备和平台。

## 当前集中待办

下表是旧 Web 的逐项适配清单，由对应迁移任务实施者负责；工程入口完成不改变业务页面“目标端待实测”的状态。

| 位置/能力                                                                                                     | H5 影响                                      | 微信小程序影响与适配路径                                                                                     | 成本 |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---- |
| AuthView 的 HTMLFormElement、querySelector、focus                                                             | 浏览器焦点与原生 Enter 提交可用，迁移后回归  | 没有同等浏览器 DOM；改用输入组件 focus 属性和平台表单事件，保留首个错误定位                                  | 中   |
| router/index.ts 的 document.title、History、window.scrollTo、锚点                                             | 核对部署回退、标题、刷新、历史和滚动         | 使用 pages.json、uni.navigateTo/redirectTo、导航栏标题与页面滚动 API，重新设计筛选参数恢复                   | 中   |
| AppIcon / @lucide/vue 动态组件与 SVG                                                                          | Vue/Web SVG 当前已验收；uni-app 编译仍需验证 | 不能直接移植 Web SVG 与动态 component；统一入口按平台换 image/模板，优先本地 PNG，颜色需资源或其他受支持方案 | 中   |
| CollegePicker 内联 SVG 勾选                                                                                   | 保留按压与选中语义                           | 勾选改为受支持资源/样式，同时验证可访问反馈                                                                  | 低   |
| style.css / BrandLayout / CollegePicker 的 svh、40svh；首页合并卡片采用四列三行滚动区（186px），紧凑控件 32px | 依浏览器动态视口验证                         | 小程序视口单位能力待实测，可按窗口高度计算卡片固定尺寸，保留内部滚动                                         | 中   |
| Grid、gap、复杂选择器、Tailwind 与 CSS 变量                                                                   | 当前响应式布局已使用，按目标浏览器回归       | 按基础库与实际编译输出验证，必要时 Flex/平台模板/静态主题；不能笼统认定 Grid 全部不可用                      | 中   |
| CollegePicker overflow、滚动条伪元素                                                                          | 可定制浏览器滚动条                           | 核对 scroll-view 内部滚动及可滚动提示，滚动条装饰可降级                                                      | 低   |
| student-bottom-nav / student-content 的 env(safe-area-inset-bottom)                                           | 当前浏览器安全区域；真实 iOS 仍待测          | 使用平台安全区域信息或平台导航，重测正文底部空间与点击区域                                                   | 中   |
| AuthInput 原生 input、button、form 与 aria-*                                                                  | 当前原生键盘、名称、错误关联                 | 迁移到平台表单控件；键盘、焦点、显隐、辅助技术支持需独立验收                                                 | 中   |
| ProjectLogo 与学院 WebP、mix-blend-mode                                                                       | 当前资源构建加载正常                         | 使用 image 的 aspectFit；核对基础库/系统 WebP 支持和混合效果，可用 PNG 及底色兜底                            | 低   |
| api/http.ts 的 Axios 浏览器请求                                                                               | 同源代理与超时当前可用                       | 改为 uni.request 或请求适配器，处理域名白名单、错误与响应映射                                                | 中   |

## 官方依据与验证原则

Issue #23 的官网采集、HTML 适配、Node HTTPS、数据库锁、CLI 与定时任务均在服务端执行，迁移成本低，公开 DTO 不变。H5 继续核对 API 地址、代理/CORS、官网外链与复制回退；微信小程序需以 `uni.request` 配置 API 合法请求域名，以 `uni.setClipboardData` 提供复制，官方原文使用 `web-view` 前核实对应学院业务域名。不能在小程序客户端搬用 Node HTTPS 或浏览器 DOM 解析器，也不能把后端可访问官网当作 web-view 可打开的证据。采用服务端保留采集、客户端复用公开查询的方案；本任务未进行 uni-app 编译、微信基础库或真机验证，外链限制仍按已有官方依据及目标端实测处理。

依据截至 2026-10-03 查阅的官方文档：[Vue3 平台差异](https://uniapp.dcloud.net.cn/tutorial/vue3-basics.html)、[image 图片与平台差异](https://uniapp.dcloud.io/component/image.html)、[SelectorQuery](https://uniapp.dcloud.net.cn/api/ui/nodes-info.html)。Vue 支持差异不等同于 Web DOM 可用；SelectorQuery 提供节点信息而非浏览器 focus 的等价替代。image 文档说明小程序 SVG 仅支持网络地址，因此本地 PNG 是迁移候选，不把本地 SVG 当作已验证的方案。

[Lucide Vue 文档](https://lucide.dev/guide/vue)说明 Vue 组件渲染 SVG 与静态按需导入；这是 Web 渲染依据，不是微信小程序支持声明。CSS 和安全区域表中内容是适配调查项，须在项目最终选择的编译器、基础库与设备上验证后更新状态。

## Issue #12 新增适配点

| 位置 / 能力                                                                        | H5 影响                                                          | 微信小程序影响与适配路径                                                                                                   | 成本 |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---- |
| competition-discovery.ts 与 router/index.ts 的 query、replace、History 和赛段 hash | 回归 URL 规范化、刷新、前进后退、详情返回和锚点；保留无关参数    | 转换为平台路由参数、页面状态与返回恢复；以赛段 ID 定位平台节点                                                             | 中   |
| CompetitionListView 的 search、select、form 和 live region                         | 当前浏览器原生控件；迁移后重新检查键盘、标签、焦点及选项         | 改用 input、picker、button 等平台组件；独立验证筛选交互与可访问反馈                                                        | 中   |
| CompetitionDetailView 的外链和 navigator.clipboard                                 | 官网页面可新窗口打开；剪贴板受浏览器权限影响，已提供手动复制回退 | 使用 uni.setClipboardData，并按官方要求核对小程序隐私保护指引配置；web-view 需配置业务域名，不能假设各学院官网均可直接打开 | 中   |
| competition-discovery.ts 的 Intl.DateTimeFormat / Asia/Shanghai                    | 当前浏览器按北京时间格式化，跨 UTC 边界测试覆盖                  | 核对目标运行时 Intl 与时区支持，必要时改成统一北京时间格式函数                                                             | 低   |

后续比赛数据请求以 [uni.request](https://zh.uniapp.dcloud.io/api/request/request) 适配，微信小程序需配置 request 合法服务器域名；Issue #22 已通过 JSON GET 接入比赛 API；迁移时需要适配请求入口。官网原文适配依据 [web-view](https://uniapp.dcloud.io/component/web-view.html)，复制候选依据 [uni.setClipboardData](https://uniapp.dcloud.io/api/system/clipboard)。上述均为迁移登记，尚未建立 uni-app 工程，Web 验收不证明小程序兼容。

## Issue #22 新增适配点

当前采用 Axios + AbortController 取消请求，并用 watch 清理回调忽略迟到响应。H5 核对同源代理/CORS与绝对API地址；微信小程序改用 uni.request 的 RequestTask.abort 并保留请求有效性检查，配置 request 合法服务器域名，成本中。新契约的时间精度与 evaluatedAt 可复用；日期格式化继续独立验证目标运行时。页码响应纠正采用 Vue Router replace，详情数据到达后用 DOM 节点定位赛段；小程序需改为平台导航与 SelectorQuery/pageScrollTo，成本中。官方外链和复制遵循已有适配项，不能假设学校各子域均可通过 web-view 打开。依据已有 uni.request/web-view 官方链接，尚未进行 H5 或微信小程序编译/运行验证。

## Issue #13 新增适配点

- 筛选 query、History、replace 与详情返回：H5 回归刷新、前进后退与 URL 规范化；微信小程序改用平台页面参数与返回恢复，成本中。
- 原生 form/input/select/textarea、datetime-local、字段焦点及 scrollIntoView：H5 回归键盘、表单标签与北京时间输入；微信小程序换为 input、textarea、picker、button，焦点与错误定位通过目标端能力处理，日期和时间分别选择并明确 UTC+8，成本中。依据：[picker 官方文档](https://uniapp.dcloud.net.cn/component/picker.html)。
- 原生 dialog、showModal、Tab 循环、Escape 与焦点恢复：当前仅验证 Web；H5 迁移后重新验证，微信小程序使用平台弹层并独立验证关闭、滚动、焦点与可访问反馈，成本中。
- 比赛关联 Axios/AbortController 与请求序号：H5 验证 CORS、请求取消和迟到响应；微信小程序改为 uni.request/RequestTask.abort、配置合法请求域名并保留有效性检查，成本中。依据：[uni.request 官方文档](https://uniapp.dcloud.net.cn/api/request/request.html)。
- Pinia 会话内演示状态、setInterval 与 Intl/Asia/Shanghai：目标端保留“刷新或重置恢复”语义，页生命周期清理计时器，统一北京时间解析/格式化并验证运行时支持，成本低至中。普通项目不依赖比赛目录请求成功。
- Tailwind 的响应式 grid、wrap-anywhere、dialog backdrop、100dvh 与底部安全区域：H5 和微信小程序分别编译、真机验证布局和滚动，按目标端替换不支持的选择器、变量或视口单位，成本中。

本次 375px、390px、1440px 的浏览器验证只证明 Web 表现；尚未建立 uni-app 工程或完成微信小程序验收。

## Issue #29 状态反馈与目录复用

列表仅在当前页面实例内复用已成功校验的学院目录，不写入持久化缓存；页面卸载后重新校验。加载与失败时不展示未知计数，未选择学院和来源日期为空分别提供明确文案。上述状态逻辑与 JSON 契约可复用，迁移成本低。

H5 迁移后回归页面生命周期、筛选状态恢复和反馈布局；微信小程序保留目录失败重试、不一致报错及迟到响应防护，将 AbortController 替换为 uni.request 的 RequestTask.abort，并使用平台页面参数恢复筛选。原生控件、aria-live 与 Intl/Asia/Shanghai 沿用已有适配项，目标端分别验证，成本低至中。本次 Web 测试与浏览器检查不证明微信小程序兼容。

## Issue #14：个人中心

当前使用 Vue/Pinia 会话示例、现有学院稳定 ID 本地目录、原生 input/select/textarea/checkbox 与 Vue Router query。不调用学院接口或写 API。H5 迁移需回归标签、错误提示、DOM 聚焦/返回焦点、query/History、Tailwind 响应式布局和 env 安全区域；微信小程序使用平台表单组件、页面参数与支持的图标资源，DOM 焦点 API 需替换为平台 focus 状态，独立验证导航遮挡和错误可见性。资料校验与状态模型可复用，预计成本中；Web 验证不能证明小程序兼容。授权 UI 仅演示，不替代服务端有效成员关系与所有者授权校验。

个人中心样式调整沿用静态列表和网格，未引入新浏览器 API。队伍图标统一使用 Lucide Handshake，新增 Leaf、BookOpen、ShieldCheck、Pencil 均静态导入；H5 需验证图标渲染，微信小程序应替换为支持的 SVG 图片或平台图标资源，不能直接依赖 Vue 动态 SVG 组件。

2026-10-09 资料与招募表单已移除学习时长输入与校验，个人中心保留七项资料；此变更减少跨端表单适配字段，不新增平台 API。静态队伍/申请样式未实现成员管理与邀请确认，后续 #15 仍需独立验证跨页面状态与授权展示清理。

## Issue #15：队伍管理与申请邀请

采用共享 Pinia 会话演示，申请、邀请和成员分别维护；名额、截止、角色和授权校验可复用。仅 Web 前端示例，不新增业务写 API、认证或服务器事务及并发保障。个人中心使用内嵌管理面板和原生 dialog；旧 URL 以 Vue Router redirect 保留 query/hash，成员变化通过派生状态即时隐藏联系方式示例。

H5 迁移后回归分区参数、History/刷新、dialog 的 showModal/cancel、Tab 循环与 DOM 焦点恢复、datetime-local 的北京时间输入、Tailwind 样式与底部安全区域。微信小程序使用平台页面参数与导航、平台弹层/input/textarea/picker 和支持的图标资源，DOM focus、HTMLDialogElement 与浏览器 History 均须替换，逐端独立验收；截止仍按北京时间解析，邀请确认规则与授权条件保留。预计成本中，依据沿用前文官方 picker、Vue3 平台差异与请求适配文档；本次未建立 uni-app 工程或进行微信小程序编译/真机验证。

## 用户端手机样式优化

手机端样式优化统一可编辑字段为 16px，放大独立操作点击区，并调整 320px 的学院网格和个人入口布局。`ProfileTeamDialog` 沿用资料编辑的固定标题/操作区与内部滚动，保存按钮通过 HTML `form` 属性关联中间表单。H5 需回归 Safari 字段聚焦、真实键盘与地址栏变化、安全区和表单提交；微信小程序采用平台弹层、scroll-view、picker 与组件事件，将外置提交按钮改为显式提交事件，不依赖 HTML form 关联。颜色及字号调整迁移成本低，弹窗和表单交互适配成本中；浏览器窄屏模拟不能替代目标端编译和真机验收。

## Issue #32：资料编辑弹窗

`ProfileView.vue` 使用原生 `dialog/showModal/cancel`、DOM focus 与 Tab 循环、`document.body.style.overflow` 背景滚动锁；固定标题和操作区，表单内部滚动，使用 `100dvh` 与底部安全区域。草稿、七项资料校验和 Pinia 会话状态可复用，未新增写 API 或持久化。

H5 迁移后需回归模态隔离、遮罩不关闭、Escape 丢弃草稿、焦点回返、软键盘与长表单滚动。微信小程序改用平台弹层、表单 focus 状态和 scroll-view，替换 DOM 焦点与 body 滚动锁，并验证平台背景滚动隔离与安全区域。官方 [Vue3 平台差异](https://uniapp.dcloud.net.cn/tutorial/vue3-api.html)说明非 H5 的 ref 不能取得内置组件实例，不能直接沿用 HTMLDialogElement 或 HTMLElement 操作。预计适配成本中；当前浏览器验收仅证明 Web 行为，H5 迁移和微信小程序编译/真机验收仍待执行。

## Issue #72：发布招募与比赛赛道选择

- `pages/teams/new.vue`、`stores/team-publish-controller.ts` 复用跨端表单、请求和 `useSessionStore.publish`；不跨应用导入 Web。真实比赛只从公开搜索与详情接口读取，选择时校验返回 ID，切换立即清除旧赛道，请求代次阻止迟到结果回填。比赛类型必须关联有效详情，赛道可选且须属于当前比赛；普通项目不等待搜索成功。共享 `validateDraft` 补齐比赛必选规则，旧 Web 同步显示其字段错误。
- `FormInput`、`FormPicker`、`FormDateTime` 分别消费 #65 的 H5 原生控件适配器／微信原生 input、textarea、picker；H5 日期时间从单一 datetime-local 改为两次选择，同样组合为无时区字符串并按 UTC+8 严格解析，不按设备时区解释。赛道官方报名时间独立展示，不自动填为招募截止。角色采用勾选外观的 `FormButton`，同源码支持 H5 Enter/Space 和微信触控，保持至少 44px 操作区。
- 字段错误由 `uni.pageScrollTo({selector})` 滚到页面字段容器；H5 同时通过现有组件 focus 聚焦，微信 picker 没有程序化 focus，采用滚动和明确文本。官方支持范围见 [pageScrollTo](https://uniapp.dcloud.net.cn/api/ui/scroll)；真实键盘与滚动位置仍需目标端验收。失败保留草稿，重复提交使用动作锁和已发布 ID 双重保护。成功用 redirectTo 替换发布页并保留列表筛选，若导航异常仍有查看已发布队伍入口，不再建队。
- onHide 取消请求／待执行发布，onShow 恢复未完成查询；onUnload 和组件卸载清理请求及会话重置监听。临时隐藏保留本页草稿，卸载后不持久化；统一重置清空草稿，迟到响应不恢复数据。浏览器 History／DOM focus／AbortController 不进入页面业务逻辑，原生导航和旧 Web 侧栏差异沿 ADR 0005。
- 用户确认本票补齐 `ProfileTeamsReadOnly`：个人中心仅展示自己的队伍、带领／加入数量、成员人数和详情入口，从同一 session 派生；完整管理和申请处理仍归 #74。发布、列表、详情与个人中心不保存第二份队伍数据。无真实登录、业务写接口、存储或官方报名。
- 样式沿旧 Web 的面板、三段表单、字号、留白与主题，固定 px 的局部依据见样式约定。320px 修正旧端最小宽度引起的溢出；日期控件分列／窄屏换行和勾选按钮属于必要平台适配。H5 浏览器模拟覆盖 320／375／390／430px 和 1440px；检查初始／空搜索／失败／字段错误、长比赛名、触控下限和跨页发布计数。比赛选择成功使用遵守现有 HTTP 契约的请求替身，API 不可用时另外验证普通项目仍可发布；没有把替身当作真实服务或生产证据。维护型测试覆盖边界、竞态、取消、草稿、导航和会话同步；截图及临时结果仅留本地。
- 本次未执行微信开发者工具人工验收；H5／mp-weixin 构建与替身测试不证明微信真实运行。微信 picker／textarea、软键盘、安全区、返回／后台恢复、合法请求域名、系统字号及 iOS／Android 真机仍交 #85。采用已有 #63／#65 平台入口，迁移维护成本低至中，无新增框架或平台依赖。

## Issue #71：队伍详情与申请邀请交互

- `apps/uni/src/pages/teams/detail.vue` 复用 `useSessionStore` 与共享领域动作，不导入旧 Web。申请、撤回、接受／拒绝邀请在详情内提供入口；完整个人中心管理仍归 #74。申请和待确认邀请不增员，确认提交时再次校验有效邀请、成员、名额、截止、招募状态及角色需求。确认记录在弹层打开时固定，重置或替换记录后不能操作新对象。
- 使用现有 `FormDialog`、`FormPicker`、`FormInput` 和 `FormButton` 替换旧 Web 的 HTML dialog/select/textarea；沿用 H5 焦点约束及 Escape 关闭、微信 picker/textarea 与键盘高度适配。详情弹层限宽 512px，表单／确认弹层分别限高 560／260px，受可用视口继续缩小，操作区固定、正文内部滚动。这是复用跨端表单基础设施的必要布局调整，未复制浏览器 DOM 到页面。
- 页面业务内容沿旧 Web 的 20px 手机侧边距、22px 面板留白、18px 圆角、30/36px 标题字号／行高和 20px 卡片间距；操作按钮随内容宽度并保持至少 44px 高。原生导航栏、桌面不带旧侧栏等差异沿 ADR 0005。联系方式继续不在公开详情展示；举报只反馈演示结果。详情没有网络加载态，空／错误状态为非法参数、未知／解散／刷新后丢失的会话队伍及动作失败，不制造请求假状态。
- 页面显示时刷新演示时钟并启动单一定时器，隐藏／卸载时停止时钟并清除弹层草稿；返回列表携带既有筛选与页码。普通页面跳转保留同一 Pinia 会话，刷新／冷启动恢复示例，不写存储或业务接口。后续个人中心应消费同一个 session，不能另建成员或申请副本。
- 本地 H5 浏览器模拟覆盖 320／375／390／430px、长文本、举报首错与 500 字说明、申请／撤回不增员、邀请确认增员一次，以及打开确认后条件变化的失败反馈；320×360 缩小视口操作仍可触达。边界数据是本地会话替身，不是真实服务。构建与既有领域单测另行记录，不能据此认定微信运行通过。
- 本次未执行微信开发者工具人工验收。微信真实控件、滚动隔离、键盘、原生返回／后台切换、安全区、系统字号及 iOS／Android 真机交 #85；H5 缩小视口不代替真实软键盘。跨端适配成本低至中，沿 #65 的平台分支维护，无新增账号、持久化、消息投递或服务端业务。
