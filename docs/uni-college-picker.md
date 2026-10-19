# uni-app 学院多选组件

`apps/uni/src/components/CollegePicker.vue` 对应 Issue #66，迁移旧 Web `CollegePicker.vue`；仅提供可复用选择控件，首页和其他业务整页由后续任务消费。

## 受控接口

| 属性           | 约定                                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modelValue`   | 必传，`CollegeSelection`：`all` 表示不限、`[]` 表示未选且无结果、ID 数组表示自选。组件不另设默认值；消费页缺少筛选参数时可用共享 `parseFilters({}).hosts` 得到 `all`。 |
| `compact`      | 默认 false。常规布局、紧凑布局沿旧 Web 的字号、间距、3/4 列断点与内部滚动尺寸。                                                                                        |
| `catalog`      | 默认共享本地学院目录。消费页完成远端目录核验后传入；应与共享目录的 ID、名称、顺序完全一致。组件防御性拒绝缺项、增项、乱序、重名映射等不一致目录，不请求第二套数据。    |
| `status`       | `ready`（默认）、`loading`、`error`。非就绪或目录不一致时不展示可选项，禁用全部切换，保留父级模型。                                                                    |
| `errorMessage` | 加载失败的可见说明，默认“学院目录加载失败，请重试。”                                                                                                                   |
| `footer` 插槽  | 位于内部滚动区外，供消费页面放搜索、筛选和重置等操作。                                                                                                                 |

事件与旧组件兼容：`update:modelValue` 写回模型；用户选择非空数组触发 `select(ids)`，清空触发 `clear()`，切换为 `all` 触发 `reset()`。数组输出均按目录稳定顺序去重，两个事件各持有独立数组。共享 `normalizeCollegeSelection` / `toggleCollegeSelection` 位于 `@hehuoda/client-domain/college-selection`，不依赖 Vue 或平台。

`all` 点击单院转为该院，自选再点该院取消；`all` 点击“全部学院”变为空选，自选或空选点击该按钮变为 `all`。逐个选满不会折叠成 `all`。

父级传入未知/失效 ID 时，就绪后输出清理后的模型，触发 `invalid(ids)` 并显示“已移除…个失效学院，请重新确认选择”。重复或乱序只规范化，不触发用户 `select/clear/reset`。失败或加载中延后清理。`retry()` 只通知消费页重试，不擅自把错误切成成功；消费页负责实际请求与状态更新。

## 资源、平台与布局

院徽通过既有 `CollegeEmblem` / `ResourceImage` 入口，保留稳定学院 ID。`CollegeEmblem` 的 `picker` 变体提供与旧组件一致的圆形边框、常规/紧凑尺寸及缺图首字；白色图案保留深色底衬，加载失败后恢复浅底。普通资源展示保持原有默认行为。

微信开发者工具中发现额外自定义组件宿主会使内部百分比高度失去确定参照，出现圆框正常而图片空白。图片改由 `ResourceImage` 自身的 `size` / `smallSize` 像素尺寸决定，常规桌面/手机分别 40px/28px、紧凑 26px；H5 与微信使用同一尺寸规则，不依赖虚拟宿主或父级百分比高度。

组件自身使用原生 `button`，使微信样式和 aria 属性直接落在真实按钮节点，不依赖 H5 的自定义组件根属性透传。H5 另显式提供 tabindex 与 Enter/Space；选择通过勾选、边框、文字共同反馈。实例无固定 DOM ID，可同时挂载。

内部滚动使用 `scroll-view`，标题、选择反馈与 footer 位于其外，不拦截全页触摸事件。紧凑滚动高度手机 200px、桌面 186px；常规桌面 248px，手机面板 40vh 并由滚动区承担剩余空间，H5 用 40svh 贴近旧组件。手机宽度小于 360px 时三列，其余四列。常规/紧凑的 44px 全部按钮及至少 68px/80px 学院按钮沿旧端，桌面紧凑模式保留旧端 28px 全部按钮。

H5 的内部滚动条样式仅在 H5 条件编译分支定位框架滚动容器；微信不使用 DOM 查询、动态 SVG 或浏览器事件拦截。官方依据：[scroll-view 区域滚动与固定高度](https://uniapp.dcloud.net.cn/component/scroll-view.html)、[button 平台属性](https://uniapp.dcloud.net.cn/component/button.html)。微信真实触摸、滚动边界、辅助技术及 iOS/Android 真机交 #85；编译与宿主替身测试不能代替这些验收。

## 维护型 fixture 与验证

`scripts/college-picker.test.mjs` 通过既有 SFC 宿主分别执行 H5/MP-WEIXIN 的三态、全量自选、目录错误、失效选择、坏图、键盘与跨实例同步；共享纯规则测试在 `packages/client-domain/test/college-selection.test.mjs`。不新增运行器。

`apps/uni/scripts/fixtures/CollegePickerFixture.vue` 是维护型最小交互 fixture：常规、紧凑实例共用一个受控模型，包含加载/失败/不一致/失效选择入口以及滚动区外操作。它不挂载到生产页面，也不注册生产路由。

人工预览沿 `docs/uni-forms.md` 约定：复制到忽略的 `src/.local/`，临时从样式基线页挂载；它与 scripts/fixtures 同目录深度，相对导入可复用。两端编译此入口后再检查 H5 的 320/375/390/430px 与桌面 1440px；验证后恢复样式基线页。截图、临时页面及结果保留本地，不提交。

微信原生自动化需要访问组件内部时，可把 fixture 临时作为样式页内容（仅将 `../../src/components/` 导入改为 `../../components/`），保留真实 `CollegePicker` 子组件，通过 `compact-colleges` / `regular-colleges` 标识取得 SDK 自定义组件，再查询其原生按钮；不要把组件宿主的点击当作内部按钮点击。此变换与截图/脚本均留本地，验证后恢复原页。

H5 比较应以相同面板宽度、数据及选择状态对照旧 Web 原组件。原生导航与页面容器继续遵循 ADR 0005；本票 fixture 不证明 #68 首页已迁移，也不接真实比赛 API 或业务写 API。
