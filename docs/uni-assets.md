# 用户端图标与品牌资源

`apps/uni` 独立维护运行资源，不从 `apps/web/src` 跨应用导入。资源回归入口为 `pages/style/index`；页面展示完整业务图标、正常与异常图片、加载指示及所有学院。

## 组件契约

- `AppIcon`：沿用 `home/users/team/leaf/book/shield/pencil/mail/star/bell/user`。`size` 为 px，默认 24；默认继承当前文字颜色，支持主题工具类和显式 `color`。状态由调用方决定，不自行改变收藏、授权等业务状态。未知名称显示 `?`，包括原型链属性名称。默认装饰模式，独立图标传 `label`，操作名称和至少 44px 的触控区域仍由按钮或导航负责。
- `ProjectLogo`：40px 等比显示完整 Logo，默认装饰模式，独立使用传 `:decorative="false"`。本地 160px PNG 支持 40px 下 4 倍密度；大尺寸品牌展示另准备派生资源，不放大该缩略图代替原图。
- `CollegeEmblem`：以 `collegeId` 查本地目录，默认 40px；27 个稳定 ID、25 张院徽，农业工程学院和土木工程学院仍无独立院徽。缺失、未知和加载失败显示学院名称；白色透明院徽保留主题绿底。选择器外圈、内图尺寸和选中态由 #66 的容器按旧端布局实现，此组件不承担筛选行为。
- `ResourceImage`：`mode="aspectFit"`，不裁剪或拉伸；`src` 为空不创建图片，错误后显示 `fallback`，切换 `src` 重置失败状态并重试。`label` 必填；与可见学院名称或品牌名并排时启用 `decorative` 避免重复朗读。
- `LoadingIndicator`：20px、2px 圆环、继承颜色，默认装饰模式；独立使用传 `label` 提供状态语义。H5 尊重 `prefers-reduced-motion`；微信对媒体查询和辅助技术的实际支持交 #85 验证。

## 来源与再生成

图标来自 `@lucide/vue` 1.51.0 的 House、Users、Handshake、Leaf、BookOpen、ShieldCheck、Pencil、Mail、Star、Bell、UserRound 静态节点，依次对应上述业务名称。正式字体保留 24×24 坐标、1.5px 描边和圆头；通过字体实现颜色继承，不把动态 Vue SVG 或内联 SVG 放入微信模板。字体以 base64 内嵌在现有 `base.css` 中，原生底栏使用同源的普通/选中态 PNG；不访问外网图标服务，不引入额外样式生成链。

Lucide 的 ISC 与 Feather 派生 MIT 通知保留于根目录 `third-party-notices/lucide-LICENSE.txt`，同时随 `static/licenses/lucide-LICENSE.txt` 进入构建产物。Logo 沿用用户提供的禾伙搭品牌图；院徽沿用旧 Web 已收录的学院展示资源及原有学院稳定 ID、白色图案标记。它们不因技术迁移而变成 Lucide 的 ISC/MIT 授权资源，也不新增学校授权声明。

一次性图片/字体生成脚本、中间输入、工具环境与验收输出仅留本地 `apps/uni/.local/`，不进入应用构建或 Git。仓库保留正式字体、PNG、业务映射、许可证和维护型源码测试；构建不要求安装 Python。后续更新图标时按以上固定版本、来源节点、坐标和描边生成资源，同步业务名称/字形映射；修改底栏主题色后同步普通/选中 PNG。

资源更新时逐项核对原图和目标字形，防止空心形状被填实；院徽转码保持原比例和白色图案标记。日常 CI 沿用 `node --test`：检查固定业务名称契约、本地图标、PNG、资源预算，并执行真实 Vue 图片错误/换源与加载语义测试，不读取本地中间输入。

## 资源预算与平台边界

采用 PNG 作为 Logo/院徽/底栏图标的共同格式。当前 25 张院徽保持原始 52–80px 范围的宽高，不因格式转换放大图案；提供的长方形院徽也保持原始比例。PNG 比 WebP 体积增加，换取旧 iOS 等环境无需 WebP 解码回退。将来增加更高分辨率源图时，仍按实际显示尺寸生成资源，而非直接打包大原图。

维护预算：`src/static` 不超过 350,000 字节（单元测试约束），当前所有页面仍在主包；为后续业务预留空间，主包采用 2 MiB 的保守内部预算，规划新增分包时也逐包量测。它是内部预算，不是对微信最新上传限额的声明。构建目录字节总和不等于开发者工具上传包大小，最终主包/分包及总包由 #87 用实际发布账号、当时官方规则和上传工具再次核验。

依据：[uni-app image](https://uniapp.dcloud.net.cn/component/image.html) 的 `aspectFit`、本地路径与 WebP 限制，[字体图标](https://uniapp.dcloud.net.cn/component/uniui/uni-icons.html) 的自定义字体机制；微信最新限制应核对[分包文档](https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages.html)。真实微信字体渲染、辅助技术、低端 iOS/Android 清晰度仍交 #85，不以 H5 或编译成功代替真机结论。
