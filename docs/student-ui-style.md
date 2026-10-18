# 学生端全局样式

学生端采用已确认的校园品牌视觉。后续学生页面沿用该版本的暖白背景、禾苗绿主色、谷物黄点缀与轻量圆角卡片。

## 样式入口

旧 Web 的全局样式位于 [apps/web/src/style.css](../apps/web/src/style.css)，由 main.ts 加载，仅导入 Tailwind，层级为 `theme → base → components → utilities`。采用 Tailwind 为主 + 少量普通 CSS + 按需封装组件；保留 `--hhr-*` 主题变量与语义工具类。页面布局、间距、排版、尺寸和常见状态优先用工具类，普通 CSS 用于基础主题、复合输入行、复杂效果及确有必要的响应式适配。

迁移中的用户端 `apps/uni` 另有独立样式入口，色值同源但单位与组件类不同，见下文[uni-app 用户端样式](#uni-app-用户端样式迁移中)。

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

## uni-app 用户端样式（迁移中）

用户端 `apps/uni`（`@hehuoda/uni`）与旧 Web 并存，品牌色、字体与圆角沿用同一组 `--hhr-*` 值，但样式入口、单位与组件类单独维护。

| 文件                                                               | 作用                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------- |
| [src/app.css](../apps/uni/src/app.css)                             | 唯一 CSS 入口：导入 Tailwind、主题与基础样式，声明 Vue 内容源 |
| [src/styles/theme.css](../apps/uni/src/styles/theme.css)           | `--hhr-*` 主题变量与 Tailwind 语义工具类映射                  |
| [src/styles/base.css](../apps/uni/src/styles/base.css)             | page 根节点、`.hhr-page` 容器与 `.hhr-*` 组件类               |
| [src/pages/style/index.vue](../apps/uni/src/pages/style/index.vue) | 样式基线页：H5 `/#/pages/style/index`，小程序「样式基线」     |

页面只消费语义工具类（`bg-brand`、`text-ink`、`border-line`、`rounded-panel`、`text-body`），不写品牌色十六进制、不新增平行主题。`pnpm --filter @hehuoda/uni test:unit` 中的样式契约测试校验入口唯一、颜色与圆角映射完整、单位策略、禁用态选择器与 `pages.json` 静态窗口色一致。

### 尺寸单位策略

| 用途                 | 单位 | 原因                                                                                                                         |
| -------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| 字号                 | px   | uni-app H5 会按视口宽度缩放根字号（1rem ≈ 视口宽度 / 23.4375），rem 字号在 320px 宽会缩到约 12px；固定 px 让两端同值且不缩水 |
| 间距、宽高           | rem  | 构建时由 weapp-tailwindcss 换算成小程序 rpx；H5 的根字号同样随视口缩放，两端等比（375px 宽时 1rem = 16px / 32rpx）           |
| 触控下限、边框、圆角 | px   | 44px 触控下限与控件外观不随视口缩小；圆角 9 / 5 / 15 / 18px 与旧 Web 一致                                                    |
| 断点                 | px   | rem 断点在 rpx 换算后不可靠，`sm:` / `md:` / `lg:` 固定 640 / 768 / 1024px                                                   |

组件类内部同样遵守该约定：`.hhr-button`、`.hhr-input` 的 `min-height` 写 44px，内边距与间距写 rem，边框与圆角写 px。页面自定义触控区用 `min-h-[44px]` 这类 px 任意值，不要用会随视口缩小的 `h-11`。

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

| 类名                                                        | 说明                                                                         |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `hhr-page` / `hhr-page__inner`                              | 页面容器：24px / 20px 留白、底部安全区、长文本换行、最大 640px               |
| `hhr-panel` / `hhr-card` / `hhr-eyebrow`                    | 面板、卡片与小字号引导文字                                                   |
| `hhr-button`                                                | 主要按钮；`--secondary`、`--soft`、`--danger`、`--inline` 切换外观           |
| `hhr-button` 状态                                           | `[disabled]` / `.is-disabled` 半透明禁用；`.is-loading` + `hhr-spinner` 加载 |
| `hhr-badge`                                                 | 状态标签；`--warning`、`--muted`、`--danger`                                 |
| `hhr-field` / `hhr-label` / `hhr-input` / `hhr-field-error` | 表单字段、16px 输入框与错误提示                                              |
| `hhr-state` / `hhr-state--error` / `hhr-notice`             | 空态、加载、失败状态块与提醒条                                               |

### 两端差异与验证边界

- `page` 是两端共同根节点：H5 编译为 `uni-page-body`，小程序保留 `page`；基础样式不写 `body`，也不引入浏览器 reset。
- 禁用态用 `[disabled]` 与 `.is-disabled`：H5 把 button 渲染成 `uni-button` 自定义元素，`:disabled` 伪类不匹配；两端框架给 `[disabled]` 的灰色底由组件类按变体覆盖。
- 悬停只在 `@media (hover: hover)` 内生效；小程序构建会移除该规则，移动端不出现粘滞高亮。
- 响应式：`sm:` 在 H5 输出 `@media (width >= 640px)`，小程序构建改写为 `@media (min-width: 640px)`；小程序端实际表现待真机确认。
- 焦点：H5 输入框通过 `:focus-within` 显示 3px 焦点环；`uni-button` 不带 `tabindex`，键盘无法聚焦，属框架限制，页面任务需要时补 `tabindex` / `role`。
- 安全区 `env(safe-area-inset-bottom)` 已在容器中预留，iOS 真机与微信基础库表现转 #85。
- 本轮验证范围为 H5 320 / 375 / 390 / 430px 与 mp-weixin 编译产物；微信开发者工具运行、真机与系统大字号未验证。

## 项目 Logo 与顶栏

项目 Logo 使用用户提供的“禾伙搭”品牌图，资源为 `apps/web/src/assets/hehuoda-logo.png`，通过 `ProjectLogo.vue` 复用，并用于浏览器图标；图片与品牌名称一起展示时使用空替代文本，避免屏幕阅读器重复朗读。保留完整 PNG 与等比显示；迁移 uni-app 时改用本地 `image` 与 `aspectFit`，微信小程序图标配置另行验证。

学生端顶栏采用白底、左侧 Logo 与“禾伙搭”、右侧通知及个人资料线条图标，不显示“学生端 DEMO”。图标入口保留可访问名称、44px 点击区域和主题焦点轮廓；链接到对应路由占位页。登录与注册仍可通过个人资料页进入。

## 图标与交互约定

导航与顶栏通过 `AppIcon.vue` 使用 Lucide `@lucide/vue` 1.51.0：仅在 `app-icons.ts` 静态导入 House、Users、Network、Mail、Star、Bell、UserRound，使用业务名称映射，不加载全集。来源为 [Lucide 官方 Vue 文档](https://lucide.dev/guide/vue)，ISC 许可证；包中部分 Feather 派生图标另含 MIT 声明，完整通知随仓库保留于 [third-party-notices/lucide-LICENSE.txt](../third-party-notices/lucide-LICENSE.txt)。

AppIcon 均为装饰图标，隐藏于辅助技术且不可聚焦，名称由可见文字或链接 aria-label 提供。按钮明确原生 type：密码显隐、验证码、健康刷新为 button，登录/注册为 submit。密码按钮高度44px，提交与刷新按钮最小高度44px；禁用反馈与加载文字同时存在，LoadingIndicator 尊重减少动态效果设置。

当前库渲染 Web SVG，在 uni-app H5 可作为待验证的 Web 方案；微信小程序不能据此宣称兼容，需在统一入口替换为 image 与适合目标端的资源。官方 image 说明指出小程序 SVG 仅支持网络地址，迁移优先考虑本地 PNG，重新处理 currentColor、多主题颜色和尺寸。依据与集中待办见[迁移提醒约定](agents/uni-app-migration.md)。

## 开发产物

设计预览、截图、研究原图和验收记录仅保留本地并由 .gitignore 排除；验证结果写入 PR。应用运行所需的 Logo、院徽、组件及许可证继续提交。
