# uni-app 迁移提醒与集中待办

## 时间与目标

项目完成后统一迁移到普通 uni-app，目标为 H5 和微信小程序。当前继续交付 Vue Web；此文登记现有适配点，不要求本次改造，也不表示相关能力全部不受支持。尚未建立 uni-app 工程或进行小程序运行验收。

## 持续协作规则

以后开发中，遇到影响跨端的选型或实现，在确定方案或引入实现时：

1. 指出具体 API、组件、样式及源码位置。
2. 分别解释 H5、微信小程序影响，明确区分官方已知限制、推断与待验证事项。
3. 提供替代方案，或说明迁移需做的适配与成本。
4. 在方案、Issue 或 PR 记录已采用方案及成本，重要事项同步本表。发布 Issue 仍遵循 issue-tracker.md 的先展示与确认规则。

不能用 Web SVG 正常、Chrome 样式正常或 jsdom 通过来推断小程序兼容。功能验收与跨端验收分别记录；后续验证时记下 uni-app/微信基础库版本、设备和平台。

## 当前集中待办

所有下列适配均留待统一迁移，负责人为后续迁移实施者；当前状态为“已登记，目标端待实测”。

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
