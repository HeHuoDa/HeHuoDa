# 客户端业务规则

`@hehuoda/client-domain` 是 Web 与普通 uni-app 迁移期间共用的 TypeScript 源码包。运行时代码只使用标准 JavaScript；唯一的工作区依赖 `@hehuoda/api-types` 仅用于类型。不能导入 Vue、Pinia、Router、请求层、平台资源或应用源码。

## 入口与来源

| 公开入口                           | 内容                                                                      | 原实现与适用测试                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `/colleges`、`/college-selection`  | 学院稳定 ID、名称、`all` / 空数组 / 自选数组三态                          | Web `data/colleges.ts`、`college-selection.ts`；`competition-discovery.spec.ts`、`shared-domain.spec.ts`     |
| `/query`、`/competition-discovery` | 无平台依赖的 query 输入/输出、比赛筛选规范化、参赛范围及材料截止文案      | Web `data/competition-discovery.ts`；`competition-discovery.spec.ts`、`competition-time.spec.ts`             |
| `/profile`                         | 资料七字段、技能规范化、校验、资料状态工厂与动作                          | Web `data/profile-demo.ts`；`ProfileView.spec.ts`、`ProfileTeamManagement.spec.ts`                           |
| `/team`                            | 招募类型、初始示例、人数/截止判断、北京时间解析、招募校验、筛选参数与排序 | Web `data/team-demo.ts`；`team-demo.spec.ts`                                                                 |
| `/team-session`                    | 申请/邀请/成员关系状态机、授权展示判断、初始状态及待处理申请派生          | Web `data/team-demo.ts`；`team-management.spec.ts`、`ProfileTeamManagement.spec.ts`、`shared-domain.spec.ts` |

`src/time.ts` 为内部的固定 UTC+8 显示实现，保持原 Web `YYYY/MM/DD HH:mm` 文案，不依赖设备时区或 Intl 时区数据。`test/rules.test.mjs` 在无 window/document/Router 的 Node 环境覆盖上述纯入口。

query 只规范化筛选值，保留源规则的重复参数首值与学院逗号列表语义；不是 URL 导航器。Web 继续使用 Vue Router，uni 页面在 `onLoad` 等平台适配层收集参数，分别调用这些函数。业务 ID / 个人中心分区仍使用 uni 的 `navigation/params.ts`，不能用筛选解析器替代其重复冲突检查。

## 状态拥有者与重置

共享包不创建框架实例或全局单例。`initialProfileState()` / `initialTeamState(now?)` 每次生成独立对象，`createProfileActions(state)` / `createTeamActions(state, profile)` 操作调用者传入的状态；默认时间沿用原实现，也可为校验和动作显式传入固定时钟。

| 状态                                           | uni 拥有者                    | 读取和动作入口                                                                                                                        | reset                                                                    |
| ---------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 资料、本人联系方式授权                         | `business-session` 的资料状态 | `profile`、`contactShared`、`saveProfile`                                                                                             | `resetProfile()` 恢复示例资料并关闭本人授权                              |
| 队伍与成员、申请记录、邀请、其他成员的演示授权 | 同一会话的队伍状态            | `teams`、`records`、`invitations`、`contactAuthorizations`；`apply/processApplication/respond/publish/editTeam/manage/canViewContact` | `reset()` 恢复整组关联状态及资料，清空全部授权                           |
| 本人的待处理申请索引                           | 由 `records` 派生             | 只读 `applications`                                                                                                                   | 随 `records` 重置，不维护第二份记录                                      |
| 后续收藏/通知                                  | 由对应后续任务持有            | 通过 `registerReset(key, handler)` 接入会话重置，返回注销函数                                                                         | 会话 `reset()` 调用已注册处理器；页面卸载不应注销仍存活的 store 的处理器 |

队伍、申请、邀请和成员关系一起重置，避免只重置其中一张表留下孤立记录。此行为与旧 Web 的整组 reset 一致。示例队伍的相对日期在初始化及 reset 时按当前时间重新生成，动作序号沿用源实现，在同一实例内保持递增。

uni 页面只从 `apps/uni/src/stores/session.ts` 调用 `useSessionStore()`，使用应用 `createApp()` 已安装的唯一 Pinia 3。不得在每个页面重新 `createPinia()`、创建领域 state 或复制申请/邀请/成员数组。`apps/uni/scripts/session.test.mjs` 验证同 Pinia 的消费者同步及不同应用隔离。

Web 的 `data/profile-demo.ts` 和 `data/team-demo.ts` 继续提供原 store ID、导出及动作接口，但通过本包运行规则，保留 Web 的 Pinia 4 应用实例。两个应用不交换 store 或响应式对象。各端学院资源目录继续拥有本端图片 URL，稳定 ID/名称与纯目录由测试校对。

## 平台与范围

会话仅存内存，刷新或重建应用即恢复示例；无 storage、业务写 API、真实认证或消息投递。联系方式检查只用于演示，不替代服务端权限。收藏、通知页面及完整业务页面仍由其后续任务实现。

Web `team-clock.ts` 的 Vue 生命周期和 interval 保留在应用层，不进入共享包。迁移实际页面时需要在 uni 的显示/隐藏/卸载生命周期中启动、暂停和清理时钟，并重新计算可申请状态；本包的截止判断显式接收 `now`。

H5 与 mp-weixin 编译是本地代码检查；微信运行、iOS/Android 真机、键盘与安全区由 #85 验证。浏览器 DOM、路由及资源适配继续留在各应用，后续移除旧 Web 不要求修改本包或 uni 的导入关系。
