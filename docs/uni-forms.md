# uni-app 复用表单与受控弹层

Issue #65 提供 `apps/uni` 内部复用能力。业务页面仍由 #67、#71、#72、#73、#74 接入；这里不实现登录、资料页或招募页，也不建立认证、网络写入、持久化或通用 UI 框架。

## 组件契约

| 入口（相对 `apps/uni/src`）   | 契约                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/FormButton.vue`   | `disabled`、`loading`、`variant`（primary/secondary/soft/danger/reveal），显式 `click`；不关联 HTML form，不隐式提交。H5 提供可聚焦的按钮角色及 Enter/Space 操作，微信使用原生 button。                                                                                                                       |
| `components/FormInput.vue`    | 必填 `id`、`label`、`modelValue`；`update:modelValue`/`input` 返回未 trim 原值，`change` 在失焦时返回值；支持 `error`、`hint`、`placeholder`、`focus`、`disabled`、`loading`、`maxlength`、`multiline`、`secret`、`type`、`email`、`autocomplete`、`adjustPosition`。密码显隐不发提交；`confirm` 只通知父层。 |
| `components/FormPicker.vue`   | 必填 `id`、`label`、`modelValue`；`options` 为稳定 `value`/可读 `label`；`mode` 为 selector/date/time；`update:modelValue` 与 `change` 返回选中值，取消不写回。支持错误/提示、禁用/加载、H5 focus；微信 picker 没有程序化 focus，使用滚动定位和明确错误文本。                                                 |
| `components/FormDateTime.vue` | 两个选择器组合为无时区的北京时间 `YYYY-MM-DDTHH:mm`；缺一项保持未完成值，交给校验拒绝，不默认补日期或时间。用共享 `deadlineInstant` 校验并转为时间戳，不能按设备时区解析。支持 `error`、`disabled` 和首错 `focus`。                                                                                           |
| `components/FormDialog.vue`   | 必填 `id`、`open`、`title`；支持 `saving`、`saveLabel`、`errorTarget`。显式发出 `save`/`cancel`，父层拥有 open 与保存结果。`errorTarget` 是 scroll-view 内目标字段容器的 ID。                                                                                                                                 |

每个字段的容器 ID 为 `${id}-field`，错误文本为 `${id}-error`。组件不自行决定必填、业务角色、日期上下界或破坏性操作；消费方复用共享校验及动作，破坏性操作在确认弹层之后执行，禁止在“打开确认”时就调用业务动作。

## 草稿与保存

`forms/use-draft-form.ts` 的 `useDraftForm({ read, clone, validate, save })` 返回响应式的 `opened`、`draft`、`errors`、`firstError`、`submitting`、`submitError` 以及 `begin/cancel/submit`。

- `read` 读取所属 store 的当前已保存状态；`clone` 必须复制所有可编辑嵌套集合，不能只复制含共享数组的外层对象。
- `begin` 复制最新状态，清理上次错误。`cancel` 关闭并丢弃草稿；不调用保存动作。
- `validate` 返回按页面字段顺序排列的错误对象，空对象表示通过。失败保持弹层与草稿，不调用保存，`firstError` 用于定位。
- `save` 是同步内存会话动作；通过后才写回并关闭，同一轮连点不会重复保存。异常保留草稿并显示通用失败文本，不泄漏异常详情。此接口不支持异步请求，不得传入 async 回调或借此接真实持久化。
- 保存中的 UI 由 `saving`/`loading` 禁用，页面离开仍丢弃草稿。统一 session reset 时，消费页面须同时调用 `cancel`；组件不维护第二份业务 store。

首错定位时，先清空页面自己的 `focusField`，等待 `nextTick` 后设置为 `firstError`；给对应控件传 `focus`，给弹层传 `${字段id}-field`。这样连续两次提交同一错误也能重新滚动/聚焦。最小可运行写法见 `apps/uni/scripts/fixtures/FormFixture.vue`；fixture 的保存值只在测试组件内，不是新增业务会话。

## 平台与交互边界

H5 从条件编译分支加载 `NativeTextControl.h5.vue`、`NativePicker.h5.vue`，由 render 创建真实 input/textarea/select/date/time，标签名称、错误关联及焦点落在真实控件上。普通 uni 标签在 H5 渲染为包装元素，不能只给包装层画焦点环或设置 aria。邮箱键盘/自动填充仅 H5 使用对应原生属性，微信保留平台输入能力。

`forms/dialog-h5.ts` 是唯一浏览器弹层适配器：处理 Escape 取消、Tab 循环、焦点恢复、背景 inert、滚轮隔离及 visualViewport。其 DOM 查询和 focus 不进入 mp-weixin 依赖图；不使用 HTMLDialogElement、showModal、HTML form 关联或 body 滚动锁。H5 原生日期/时间弹出面板的键盘行为由浏览器管理，移动 Safari 仍需真机验证。

微信以 `onPageHide`/`onUnload` 和组件卸载清理监听；页面隐藏时通知父层取消。当前策略也会在小程序切后台时丢弃草稿；未来消费页面若引入 chooseImage/chooseLocation 等可能触发页面隐藏的全屏原生流程，须先区分临时窗体与路由离开，再接入该流程，本票未提供这类控件。微信原生导航返回不支持 `onBackPress`，所以返回会离开当前页并丢弃草稿，不实现“先关闭弹层、再返回”的伪拦截。弹层底部有显式取消，遮罩不关闭。原生 tabBar 位于页面视图之外，tab 页面打开弹层时暂时隐藏，关闭/离开后恢复；单页同一时刻仅打开一个弹层，不支持嵌套弹层。

标题与底部操作固定，中部 `scroll-view` 使用有确定高度的 Flex 剩余区（父面板高度确定、滚动区 height:0 + flex:1）。微信使用 `uni.onKeyboardHeightChange` 扣减可用高度，关闭时以原回调调用 `offKeyboardHeightChange`；弹层内输入须传 `adjustPosition=false`，避免平台再次顶起页面。H5 用 visualViewport 调整高度/偏移；底部保留安全区。原生 textarea/picker、真实键盘、页面栈与安全区的最终效果交 #85 验证。

## 样式与消费方责任

沿现行主题和旧 Web AuthInput/ProfileTeamDialog/ProfileView 的控件样式：13px 标签、16px 输入、11px/12px 输入内边距、9px 控件圆角、18px 弹层圆角及至少 44px 的按钮触控区域。输入行固定像素尺寸用于与旧端对照，作为 `docs/student-ui-style.md` 单位策略的局部例外；日期时间在窄屏换行，避免日期片段被裁切。

受控弹层是固定标题/操作和中部滚动的基础设施，默认宽度上限 680px、高度为可用视口减去上下各 16px，不复制某一个业务弹窗的完整模板。后续页面须按源页面补齐标题动作、说明、确认文案和其实际尺寸，完成各自整页视觉对照；不能把本票 fixture 当作登录/个人中心/招募页面已迁移。

## 维护型测试与本地预览

`pnpm --filter @hehuoda/uni test:unit` 沿用 node --test。新增测试通过公开事件执行真实 SFC setup/template，分别预处理 H5/MP-WEIXIN 分支；测试宿主只替换平台 API、页面生命周期和渲染节点，不替换组件或草稿逻辑。它验证取消/重开、错误定位、防重、密码原值、北京时间组合、微信键盘高度与监听清理；不能证明微信真实控件或真机键盘通过。

fixture 保存在 `scripts/fixtures`，不注册生产路由，也不在生产页挂载。需要人工双端预览时，在忽略的 `src/.local/` 复制 fixture（它与 scripts/fixtures 同目录深度，相对导入可直接复用），临时从现有样式基线页挂载；验证后恢复页面并移除临时副本。不要直接从 `src` 导入 scripts 下的 fixture 做微信构建，DCloud 不接受生成到源码根目录以外的 chunk。截图、测量结果、临时入口保留本地。

官方依据：[input](https://uniapp.dcloud.net.cn/component/input.html)、[picker](https://uniapp.dcloud.net.cn/component/picker.html)、[scroll-view 固定高度](https://uniapp.dcloud.net.cn/component/scroll-view.html)、[键盘 API](https://uniapp.dcloud.net.cn/api/key.html)、[页面生命周期与 onBackPress 支持范围](https://uniapp.dcloud.net.cn/tutorial/page.html)、[组合式组件页面生命周期](https://uniapp.dcloud.net.cn/tutorial/vue3-composition-api.html)。平台支持应以当前锁定版本和目标运行时实测为准。
