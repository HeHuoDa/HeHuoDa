# 学生端全局样式

学生端采用已确认的校园品牌视觉。后续学生页面沿用该版本的暖白背景、禾苗绿主色、谷物黄点缀与轻量圆角卡片。

## 样式入口

旧 Web 的全局样式位于 [apps/web/src/style.css](../apps/web/src/style.css)，由 main.ts 加载，仅导入 Tailwind，层级为 `theme → base → components → utilities`。采用 Tailwind 为主 + 少量普通 CSS + 按需封装组件；保留 `--hhr-*` 主题变量与语义工具类。页面布局、间距、排版、尺寸和常见状态优先用工具类，普通 CSS 用于基础主题、复合输入行、复杂效果及确有必要的响应式适配。

迁移中的用户端 `apps/uni` 另有独立样式入口，色值同源但单位与组件类不同，见下文[uni-app 用户端样式](#uni-app-用户端样式)。

| 用途               | 变量 / 颜色                           | Tailwind 用法            |
| ------------------ | ------------------------------------- | ------------------------ |
| 主要操作与品牌     | `--hhr-color-brand` / `#27644b`       | `text-brand`、`bg-brand` |
| 主要操作悬停       | `--hhr-color-brand-hover` / `#183e30` | `hover:bg-brand-hover`   |
| 浅绿状态与轻量操作 | `--hhr-color-brand-soft` / `#eaf2e9`  | `bg-brand-soft`          |
| 正文               | `--hhr-color-ink` / `#243d32`         | `text-ink`               |
| 辅助文字           | `--hhr-color-muted` / `#7b867e`       | `text-muted`             |
| 页面背景           | `--hhr-color-page` / `#f7f8f4`        | `bg-page`                |
| 卡片与表单背景     | `--hhr-color-surface` / `#fff`        | `bg-surface`             |
| 边框与分隔线       | `--hhr-color-line` / `#e7ebe3`        | `border-line`            |
| 提醒点缀           | `--hhr-color-accent` / `#e9bd56`      | `bg-accent`              |
| 提醒浅底           | `--hhr-color-accent-soft` / `#fff4d9` | `bg-accent-soft`         |
| 错误与危险操作     | `--hhr-color-danger` / `#b85a49`      | `text-danger`            |

正文使用中文无衬线字体，主题与品牌文案按需使用 `font-serif`；字体采用本地回退。圆角为控件 9px、卡片 15px、面板 18px，对应 `rounded-control`、`rounded-card`、`rounded-panel`。页面布局继续用 Tailwind，通常使用 8 / 12 / 18 / 24px 的间距。

## 共用组件样式

- `hhr-panel`：带边框、白底与 18px 圆角的内容面板。
- `hhr-card`：15px 圆角的比赛或招募卡片容器。
- `hhr-eyebrow`：小字号英文引导文字。
- `hhr-button`：主要按钮；附加 `hhr-button--secondary`、`hhr-button--soft`、`hhr-button--danger` 切换次要、轻量或危险样式。
- `hhr-badge`：状态标签；附加 `hhr-badge--warning`、`hhr-badge--muted`、`hhr-badge--danger` 表示提醒、弱化或危险状态。
- `hhr-input`：原生表单控件外观，复用现有 AuthInput 与 CollegePicker。

按实际复用和行为封装组件，不为旧组件机械建立同名替代品。主要操作按钮用原生 button 与 hhr-button；输入行内的密码显隐使用 auth-reveal 与局部样式，保留44px高度、共享主题和焦点，不附加主要操作背景；健康请求 ID 用 dl/dt/dd，长文本可任意换行；加载指示复用 LoadingIndicator。尺寸与布局由 Tailwind 工具类调整，避免页面重复硬编码品牌色。状态同时显示文字；按钮保留键盘焦点提示和禁用反馈，尊重减少动态效果的系统设置。

当前健康页、学生端侧栏与底部导航已接入共享主题；后续比赛封面与插画按上述视觉基准选择。

## uni-app 用户端样式

用户端 `apps/uni`（`@hehuoda/uni`）依据 [ADR 0011](adr/0011-android-h5-and-sicau-only-auth.md) 目标收敛为 **H5 与 Android（仅签名 APK）**（已放弃微信小程序，待 #224 清理遗留条件分支）；旧 `apps/web` 暂保留视觉对照。品牌色、字体与圆角沿用同一组 `--hhr-*` 值，样式入口、单位与组件类单独维护。

| 文件                                                               | 作用                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------- |
| [src/app.css](../apps/uni/src/app.css)                             | 唯一 CSS 入口：导入 Tailwind、主题与基础样式，声明 Vue 内容源 |
| [src/styles/theme.css](../apps/uni/src/styles/theme.css)           | `--hhr-*` 主题变量与 Tailwind 语义工具类映射                  |
| [src/styles/base.css](../apps/uni/src/styles/base.css)             | page 根节点、`.hhr-page` 容器与 `.hhr-*` 组件类               |
| [src/pages/style/index.vue](../apps/uni/src/pages/style/index.vue) | 样式基线页：H5 `/#/pages/style/index`、端内「样式基线」       |

页面只消费语义工具类（`bg-brand`、`text-ink`、`border-line`、`rounded-panel`、`text-body`），不写品牌色十六进制、不新增平行主题。`pnpm --filter @hehuoda/uni test:unit` 中的样式契约测试校验入口唯一、颜色与圆角映射完整、单位策略、禁用态选择器与 `pages.json` 静态窗口色一致。

### 尺寸单位策略

发布招募复刻例外（#72）：`pages/teams/new.vue` 的页面／面板留白、容器宽度和表单间距沿旧 Web 使用固定 px；内容最大 1020px、手机侧边距 20px、面板内边距 22px、字段及面板间距 20px。输入按旧版保留手机 16px／桌面 14px、1.65 行高和 11px/12px 内边距，多行字段按 3／6 行计算高度。H5 四档对照确认面板颜色、18px 圆角和控件 9px 圆角；320px 容器允许缩小以修正旧版最小宽度溢出。日期／时间分开选择，角色使用带勾选外观的可键盘操作按钮，原生导航沿 ADR 0005；差异和待验证项见[迁移记录](agents/uni-app-migration.md#issue-72发布招募与比赛赛道选择)。本例外只适用于发布页，其他布局默认 rem 策略不变。

队伍详情复刻例外（#71）：`pages/teams/detail.vue` 的容器最大宽度、页面留白、面板间距、按钮留白和弹层尺寸使用旧 Web 对应的固定 px，以消除 H5 根字号缩放造成的视觉偏差。内容容器最大 1020px（旧版 1100px 外框扣除两侧 40px 留白），手机侧边距 20px、面板留白 22px、网格间距 20px、标题 30/36px，字体、颜色和圆角仍取主题。320px 下容器允许收缩以避免旧端最小宽度产生的溢出；原生导航与固定操作区弹层的差异及历史记录见[迁移记录](agents/uni-app-migration.md#issue-71队伍详情与申请邀请交互)。此例外仅限本页，不改变其他布局的默认 rem 策略。

比赛详情复刻例外（#69）：`pages/home/competition.vue` 使用与旧 Web 相同的固定 px 留白、网格间距、字号和行高，手机水平留白 20px、卡片内边距 22px，主要操作至少 44px。这是为消除 uni H5 根字号缩放带来的视觉偏差；品牌色、字体及圆角仍沿现行主题。各端共用原生导航，来源动作由 #80 接入；具体平台差异与历史记录见[迁移记录](agents/uni-app-migration.md#issue-69比赛详情赛段定位与关联招募入口)。其他页面的默认 rem 策略不变。

官网来源操作复刻例外（#80）：仅 `CompetitionSourceAction` 的原文链接／可选 URL 上下留白 8px、完整链接上间距 8px、复制按钮上间距 4px 及完整复制按钮内边距 10px/18px 保留固定 px，对照原组件和旧 Web 的 `py-2`／`mt-2`／`mt-1` 及按钮，避免 uni H5 根字号缩放或来源动作抽为共用组件后改变既有详情视觉。链接与按钮触控下限均为 44px；新增列表展开区、反馈区和承载页通用间距仍使用 rem。品牌色、12px 链接、13px 复制按钮和 9px 按钮圆角沿原版，平台差异和历史记录见[迁移记录](agents/uni-app-migration.md#issue-80官网原文与复制回退)。本例外不扩大到列表卡片或其他组件。

复用表单与弹层（#65）沿旧 Web 使用固定 px 的输入内边距、输入高度及弹层内容/操作留白，避免手机宽度改变后控件与原版出现可感知差异；字体、44px 触控下限和现行主题保持一致。组件契约、H5 隔离适配器、非 H5 键盘/返回边界及测试入口见[复用表单](uni-forms.md)。该局部例外不改变其余布局默认 rem 策略。

个人资料复刻例外（#73）：`ProfileOverview` 的面板、头像、快捷入口、网格间距与设置行沿旧 Web 使用固定 px，保持 26px/手机 20px 面板内边距、78px/手机 65px 头像等尺寸，避免根字号缩放改变资料卡布局。字号、品牌变量与断点仍与旧端对照；页面壳继续采用现有响应式留白和最大宽度。授权开关沿用主题品牌色，宿主触控高度至少 44px；H5 已检查，端内原生开关表现与触控命中待 Android 真机（#226）实测。该局部例外不改变其他页面的默认 rem 策略；受控弹层与只读队伍区差异见[迁移记录](agents/uni-app-migration.md#issue-73个人资料编辑与联系方式授权)。

个人中心队伍管理复刻例外（#74）：`ProfileTeams`、`ProfileApplications` 与 `ProfileTeamEditor` 的面板留白（20px）、成员／记录行间距、按钮内边距与弹层尺寸沿旧 Web 使用固定 px，保持队伍列表、成员详情与申请记录在四档手机宽度下与旧端可对照；字号、颜色、圆角与 44px 触控下限仍取主题。编辑弹层最大 560×640px（手机接近全屏、内容独立滚动、底部操作固定），确认弹层最大 480×320px，避免短文案确认框占满整屏。内容最大宽度沿用现有页面壳（640px），旧 Web 管理面板更宽，属已接受的迁移差异。该局部例外不改变其他页面的默认 rem 策略；跨端与未验证项见[迁移记录](agents/uni-app-migration.md#issue-74个人中心队伍管理与申请邀请处理)。

| 用途                 | 单位 | 原因                                                                                                                         |
| -------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| 字号                 | px   | uni-app H5 会按视口宽度缩放根字号（1rem ≈ 视口宽度 / 23.4375），rem 字号在 320px 宽会缩到约 12px；固定 px 让两端同值且不缩水 |
| 间距、宽高           | rem  | 构建时由 weapp-tailwindcss 换算成小程序 rpx；H5 的根字号同样随视口缩放，两端等比（375px 宽时 1rem = 16px / 32rpx）           |
| 触控下限、边框、圆角 | px   | 44px 触控下限与控件外观不随视口缩小；圆角 9 / 5 / 15 / 18px 与旧 Web 一致                                                    |
| 断点                 | px   | rem 断点在 rpx 换算后不可靠，`sm:` / `md:` / `lg:` 固定 640 / 768 / 1024px                                                   |

组件类内部同样遵守该约定：`.hhr-button`、`.hhr-input` 的 `min-height` 写 44px，内边距与间距写 rem，边框与圆角写 px。页面自定义触控区用 `min-h-[44px]` 这类 px 任意值，不要用会随视口缩小的 `h-11`。

资源尺寸例外：`AppIcon`、`ProjectLogo`、`CollegeEmblem` 与 `LoadingIndicator` 的 `size` 使用 px，保持图标与文字、40px 品牌 Logo 的比例不随 H5 根字号变化；资源周围的布局间距仍用 rem。调用方可以按页面明确传入尺寸，触控区域继续保证至少 44px。资源显示与生成契约见[统一资源](uni-assets.md)。

学院选择器复刻例外（#66）：`CollegePicker` 的网格间距、面板内边距、学院项及内部滚动高度沿旧 Web 使用固定 px，以满足技术迁移的外观对照要求；面板宽度、3/4 列断点和长名称换行继续响应视口。手机宽度小于 768px 时全部按钮至少 44px，学院项常规/紧凑至少 68px/80px；仅桌面紧凑变体保留旧端 28px 的全部按钮，作为迁移兼容例外，不推广到其他按钮。常规手机面板的视口高度与平台回退、组件接口和维护型 fixture 见[学院多选组件](uni-college-picker.md)。该例外不改变其他布局的默认 rem 策略。

健康页复刻例外（#63）：`pages/health/index.vue` 的容器上限、布局留白及控件间距使用与旧 Web 相同的固定 px。旧版在 320 / 375 / 390 / 430px 都保持 20px 水平留白、24px 面板留白和 576px 容器上限；若直接使用 rem，320px 时水平留白会缩到约 17px，430px 时增至约 23px，桌面容器也会放大，与本票「无可感知差异」目标冲突。此例外仅限健康页对照迁移，不改变其他页面的默认单位策略；H5 四档已核查长请求 ID 换行与至少 44px 按钮，Android 真机实际布局与系统字号由 #226 验证。

### 字号刻度

| 工具类          | 值   | 用途                     |
| --------------- | ---- | ------------------------ |
| `text-display`  | 28px | 首屏标题                 |
| `text-title`    | 21px | 页面标题（同旧顶栏品牌） |
| `text-title-sm` | 18px | 卡片标题                 |
| `text-body-lg`  | 16px | 表单输入与重点正文       |
| `text-body`     | 14px | 正文                     |
| `text-label`    | 13px | 按钮、标签、次级操作     |
| `text-caption`  | 12px | 辅助说明与错误提示       |
| `text-eyebrow`  | 11px | 引导文字与徽标           |

旧 Web 用 Tailwind 默认字号（11 / 12 / 13 / 14 / 16 / 18 / 21px）；用户端把同一组值收敛为语义刻度，首屏标题按移动端收到 28px。

### 组件类

| 类名                                                        | 说明                                                                                            |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `hhr-page` / `hhr-page__inner`                              | 页面容器：24px / 20px 留白、底部安全区、长文本换行、最大 640px；最小高度扣除原生导航栏与 tabBar |
| `hhr-page--tab`                                             | tab 页面底部按 uni 注入的 `--window-bottom` 预留 tabBar 空间                                    |
| `hhr-panel` / `hhr-card` / `hhr-eyebrow`                    | 面板、卡片与小字号引导文字                                                                      |
| `hhr-placeholder`                                           | 预留页面板：24px / 40px 留白与 320 / 340px 最小高度，对齐旧 Web 占位页                          |
| `hhr-auth-panel` / `hhr-auth-switch`                        | 认证卡片留白与登录/注册互跳容器；链接保持 44px 触控区                                           |
| `hhr-button`                                                | 主要按钮；`--secondary`、`--soft`、`--danger`、`--inline` 切换外观                              |
| `hhr-button` 状态                                           | `[disabled]` / `.is-disabled` 半透明禁用；`.is-loading` + `hhr-spinner` 加载                    |
| `hhr-badge`                                                 | 状态标签；`--warning`、`--muted`、`--danger`                                                    |
| `hhr-field` / `hhr-label` / `hhr-input` / `hhr-field-error` | 表单字段、16px 输入框与错误提示                                                                 |
| `hhr-state` / `hhr-state--error` / `hhr-notice`             | 空态、加载、失败状态块与提醒条                                                                  |

页面级布局（学生端导航骨架、认证品牌布局）放在 `src/pages/**` 与 `src/layouts/**` 的 scoped 样式里，只使用 `--hhr-*` 变量；共享面板留白与状态类才进入 `base.css`。原生 `tabBar` 的高度、边框与选中样式由平台决定，不能通过页面样式复刻旧 Web 的底部导航。

### 两端差异与验证边界

> 注：下表保留 2026-10 构建基线时的跨端样式分析；按 [ADR 0011](adr/0011-android-h5-and-sicau-only-auth.md)，微信小程序已放弃，后续端内真机与安全区、系统大字号验收分别由 **#84/#225（H5）与 #220/#226（Android 真机）**承担。

- `page` 是 uni-app 共同根节点：H5 编译为 `uni-page-body`，App/历史包保留对应根容器；基础样式不写 `body`，也不引入浏览器 reset。
- 禁用态用 `[disabled]` 与 `.is-disabled`：H5 把 button 渲染成 `uni-button` 自定义元素，`:disabled` 伪类不匹配；框架给 `[disabled]` 的灰色底由组件类按变体覆盖。
- 悬停只在 `@media (hover: hover)` 内生效，移动端触屏不出现粘滞高亮。
- 响应式：`sm:` 在 H5 输出 `@media (width >= 640px)`，App 端与不同系统 WebView 实际表现待真机核查。
- 焦点：H5 输入框通过 `:focus-within` 显示 3px 焦点环；`uni-button` 不带 `tabindex`，键盘无法聚焦，页面任务需要时补 `tabindex` / `role`。
- 安全区 `env(safe-area-inset-bottom)` 已在容器中预留，Android 真机导航栏与状态栏安全区适配及实测由 #220/#226 覆盖。
- 后续验收分为 H5（320 / 375 / 390 / 430px 及 1440px）与 Android 真机全矩阵分别留证，不互相替代。

## 项目 Logo 与顶栏

项目 Logo 使用用户提供的“禾伙搭”品牌图，资源位于 `apps/uni/src/static/`（历史旧 Web 源图位于 `apps/web/src/assets/hehuoda-logo.png`），通过 `ProjectLogo.vue` 复用；图片与品牌名称一起展示时使用空替代文本，避免屏幕阅读器重复朗读。保留完整 PNG 与等比显示（`image` 与 `aspectFit`）。

学生端顶栏采用白底、左侧 Logo 与“禾伙搭”、右侧通知及个人资料线条图标，不显示“学生端 DEMO”。图标入口保留可访问名称、44px 点击区域和主题焦点轮廓。

## 图标与交互约定

原旧 Web 通过 `@lucide/vue` 1.51.0 静态导入图标；`apps/uni` 已将这些字形统一内嵌为本地字体与 PNG（详见 [uni-assets.md](uni-assets.md)），不依赖外网图标服务或浏览器动态 SVG，许可证保留于 [third-party-notices/lucide-LICENSE.txt](../third-party-notices/lucide-LICENSE.txt)。

AppIcon 均为装饰图标，隐藏于辅助技术且不可聚焦，名称由可见文字或链接 aria-label 提供。按钮保持最小高度44px；禁用反馈与加载文字同时存在，LoadingIndicator 尊重减少动态效果设置。跨端差异与集中待办见[跨端适配清单](agents/uni-app-migration.md)。

## 开发产物

设计预览、截图、研究原图和验收记录仅保留本地并由 .gitignore 排除；验证结果写入 PR。应用运行所需的 Logo、院徽、组件及许可证继续提交。
