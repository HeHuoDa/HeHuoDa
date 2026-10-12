# ADR 0002：学生端样式统一与 uni-app 迁移边界

状态：Accepted · 2026-10-03 · 关联 [Issue #19](https://github.com/HeHuoRen-Sicau/HeHuoRen/issues/19)

## 背景

原学生端将 Vant、Tailwind 与普通 CSS 混用，全局样式、主题覆盖和组件行为分散，后续普通 uni-app 的 H5 与微信小程序迁移需要明确渲染边界。沿用 Vant 可以减少控件开发，但会继续维护覆盖和 Web 组件耦合；改用另一套完整 UI 库仍有同类成本。

## 决策

完整移除 Vant，采用 Tailwind 为主、少量普通 CSS、按实际复用与行为封装组件。保留品牌、布局、--hhr-* 主题与语义工具类；复用 AuthInput、CollegePicker 和状态模型。原生 button 明确类型，语义 HTML 展示请求 ID；LoadingIndicator 提供共享加载视觉。

用户选择按需开源图标库，采用 Lucide @lucide/vue 1.51.0，静态导入七个图标，经 AppIcon 统一业务名称与渲染入口。图标许可证与来源见[样式约定](../student-ui-style.md)。相比自绘 SVG，库提供一致线条与可维护资源；代价是新增小依赖和未来小程序渲染适配。

项目完成后统一迁移到普通 uni-app，目标 H5、微信小程序；当前继续 Web 交付。持续解释并记录 API、组件与样式影响，集中待办见[迁移规则](../agents/uni-app-migration.md)。

## 后果与适用边界

- 局部控件尺寸、焦点、禁用、加载与键盘行为由项目维护，测试和浏览器验收保护原行为。
- AppIcon 当前为 Web SVG，不能直接证明微信小程序兼容；迁移时保留业务名称入口，替换为目标平台支持的 image 资源或适配组件并实测。
- Tailwind Web CSS 不等于小程序可直接使用：主题变量、选择器、工具类生成及布局须在迁移时核对。
- 本决策部分替代 [ADR 0001](0001-phase-one-technology-foundation.md) 的 Vant 组件与样式选型，其他工程基础不变。
- 本次不预开发 Popup/Dialog/Picker 等控件，不搭建 uni-app 工程；浏览器验收与构建对比记录在 Issue #19 对应 PR，验收产物仅保留本地。
