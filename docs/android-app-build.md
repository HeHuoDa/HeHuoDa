# Android 资源构建与签名打包说明（#219）

用户端为普通 uni-app，面向同源 H5 与 Android 签名 APK。现行平台约定见
[ADR 0011](adr/0011-android-h5-and-sicau-only-auth.md)。

## 1. 构建 App-Plus 资源

从仓库根目录执行 `pnpm install --frozen-lockfile`，再运行
`pnpm --filter @hehuoda/uni check:toolchain`。
在 `apps/uni/.env.production.local` 配置 Android 构建环境：

```dotenv
UNI_RELEASE=true
UNI_ANDROID_PACKAGE_NAME=hehuoda.app
VITE_API_BASE_URL=https://hehuoda.xyz/api/v1
```

执行 `pnpm --filter @hehuoda/uni build:app` 生成 `apps/uni/dist/build/app`。
开发模式可用 `pnpm --filter @hehuoda/uni dev:app`，产物在 `apps/uni/dist/dev/app`。
两种模式均校验完整 HTTPS API 基址，拒绝相对地址、凭据、查询及片段。
Release 必须显式指定包名。未设置的本地资源构建使用占位包名 `com.example.hehuoda`。
H5 发布使用同源 `/api/v1`。如果同一个工作树配置了 Android 的 `.env.production.local`，
先在当前终端把 `VITE_API_BASE_URL` 显式设为 `/api/v1`，再运行
`pnpm --filter @hehuoda/uni build:h5`。

DCloud 编译器固定为 5.26（`3.0.0-5020620260917001`）。选择同版 HBuilderX/App SDK，
避免版本不匹配提示。CLI 产出 App-Plus 资源；APK 由下节流程生成。
App 与 H5 命令均会重写 `apps/uni/src/manifest.json`，请串行执行并在最后一次 CLI 构建完成后
核对 HBuilderX 中的 AppID、包名和版本。当前模板版本为 `0.0.3`（`versionCode=4`），
后续覆盖升级需保持包名和签名一致并递增 `versionCode`。

## 2. 使用 HBuilderX 云打包

1. 在 HBuilderX 中导入对应仓库或工作树的 `apps/uni`，其根目录含 `package.json`，源码在 `src`。
2. 在 `src/manifest.json` 填入 DCloud 项目的 AppID，核对 Android 包名 `hehuoda.app` 和版本号。
   DCloud AppID、Android 包名和签名证书是三个独立设置。
3. 在「发行 → 原生 App 云打包」中选择 Android APK、正式包和「使用自有证书」。
   已验证路线为「快速安心打包」。使用维护者保管的同一签名库，口令由维护者在 HBuilderX 输入。
   签名库、口令以及本地生成的 manifest 和环境配置均不提交。
4. 在打包完成提示打开产物，通常位于该工程的 `dist/release/apk`。

启动器图标位于 `apps/uni/src/app-icons`。启动图位于 `apps/uni/src/app-splash`，
由 `app-plus.distribute.splashscreen` 以工程根目录相对路径引用。
这组静态 NinePatch 使用首页背景色，启动等待控件关闭，首页 WebView 就绪后自动结束过渡。
Android 12 及以上系统仍可能短暂显示系统级启动图标。启动图生效需要重新云打包。
参见 [DCloud 启动界面配置](https://uniapp.dcloud.net.cn/tutorial/app-splashscreen.html)。

如果后续需要 #87 自动化出包，可评估 [DCloud 离线 SDK](https://nativesupport.dcloud.net.cn/AppDocs/)。
离线方案要维护同版本 Android SDK/Gradle 工程，并用 DCloud 账号申请绑定 AppID、包名和
签名证书 **SHA-1** 的 [AppKey](https://nativesupport.dcloud.net.cn/AppDocs/usesdk/appkey)。

## 3. 出包核验与现状

| 核验项           | 方法与判定                                                                 |
| ---------------- | -------------------------------------------------------------------------- |
| 包名、版本和架构 | `aapt2 dump badging <apk>`，核对包名、递增版本和设备架构                   |
| 签名             | `apksigner verify --print-certs <apk>`，与上一版使用的正式签名证书指纹一致 |
| 权限             | `aapt2 dump permissions <apk>`，核对最终 APK 合并后的权限                  |
| 产物追溯         | `Get-FileHash <apk> -Algorithm SHA256`，记录 APK 文件摘要                  |
| 真机             | 覆盖安装、冷启动观察开屏和首页、检查比赛列表、详情、官方外链               |
| H5               | 单独执行 `pnpm --filter @hehuoda/uni build:h5`                             |

2026-11-28 已通过 HBuilderX 生成 `0.0.2`（`versionCode=3`）ARM64 签名测试 APK。
签名 v1/v2/v3 校验通过，文件 SHA-256 为
`deae270a271d48ad3ebbb2a17dbac8870f374cda5d4805dab077a034f223df6b`。
OPPO PKR110（Android 16）安装包与该摘要一致，冷启动后首页、筛选和正式 HTTPS API
返回的公开比赛列表正常显示。项目前端兼容修复覆盖 Android 旧版 V8 缺少
`Object.hasOwn` 和数组 `.at()` 的路径。

模板只主动声明 `INTERNET`。已签名的 `0.0.2` 仍包含 DCloud 合并的电话状态、媒体读取及
安装包相关权限，#219 仍需审查并验证权限收敛。静态开屏所在的 `0.0.3` 待签名出包和真机复测。
比赛详情、系统浏览器打开官方外链、覆盖安装过程仍待按验收清单记录。
维护者已报告第二台 Android 真机的验收表现与首台一致，待补机型、Android 版本、安装包版本和开屏画面。
完整设备矩阵见 #58/#226，Android 登录与安全会话见 #220/#222，生产下载见 #228。
