# Android 资源构建与签名打包说明（#219 阶段一）

本文件记录**当前仓库能重现的部分**（App-Plus 资源构建）与**尚未验证的部分**（签名 APK、真机）。
任何“编译通过”都不等于 APK 可用、签名正确或真机通过。现行平台决策见
[ADR 0011](adr/0011-android-h5-and-sicau-only-auth.md)，跨端待办见
[uni-app 跨端适配清单](agents/uni-app-migration.md)。

## 1. 已验证：App-Plus 资源构建

```bash
# 资源构建（Release），产物 apps/uni/dist/build/app
VITE_API_BASE_URL=https://api.example.test/api/v1 pnpm --filter @hehuoda/uni build:app

# 开发模式，产物 apps/uni/dist/dev/app，watch 编译
VITE_API_BASE_URL=https://api.example.test/api/v1 pnpm --filter @hehuoda/uni dev:app
```

- 平台标识 `app`（DCloud 普通 uni-app），编译层为 `@dcloudio/uni-app-plus@3.0.0-5020420260813003`，与 `@dcloudio/uni-app`、`uni-h5`、`uni-mp-weixin`、`vite-plugin-uni`、`uni-cli-shared` 完全同版；内嵌运行时为 Vue 3.4.21（区别于应用依赖的 3.5.42）。
- 工程版本：`versionName 0.0.0`、`versionCode 1`（`manifest.template.json`）。**每次对外发布都要在同一提交内同时递增 `versionCode` 并审查 `versionName`**；`versionCode` 只增不减，否则覆盖安装会被系统拒绝。
- 产物是资源目录，不是 APK：`app-service.js`、`app-config-service.js`、`app-config.js`、`app.css`、`manifest.json`、`static/`、`pages/`、`uni-app-view.umd.js` 等。
- 脚本固定 `-p app`、`-m production|development` 与 `UNI_INPUT_DIR`/`UNI_OUTPUT_DIR`，**拒绝额外 CLI 参数和同名环境变量覆盖**，因此日志、退出码与实际产物目录同源；不以「目录存在」判定成功，预检失败的启动会保留上一次成功构建的产物。
- 一次只运行一个会写 `src/manifest.json` 的构建；`build:app`、`dev:app`、`build:h5`、`build:mp-weixin` 并行执行会互相覆盖该文件。
- 产物中的 `plus.distribute.google.packagename`、`minSdkVersion`、`targetSdkVersion`、权限数组来自 `manifest.template.json` 的 `app-plus.distribute.android`；DCloud 把 Android 键名渲染为 `google`，两者是同一段配置。
- `manifest.json` 顶层 `id`（DCloud appid）与 `app-plus.distribute.android.packagename`（Android 包名）是**两个不同身份**，不要互相替代。仓库不写死 DCloud appid，也不会伪造。

### 配置校验（编译前）

`pnpm build:app` / `pnpm dev:app` 在编译前强制校验 `VITE_API_BASE_URL`，DEV 与 Release 都要求完整 HTTPS：

| 拒绝的输入                                 | 说明                                 |
| ------------------------------------------ | ------------------------------------ |
| 缺失、空白、首尾空白                       | 必须先配置                           |
| 非 `https://`、相对地址、协议相对 `//host` | ADR 0011 要求 HTTPS                  |
| `https:///host`、含反斜杠                  | 解析器会自动“纠正”，无法确认真实意图 |
| 凭据 `user:pass@`、查询串、片段            | 只接受基址                           |
| 非法端口、前导零端口                       | 端口 1–65535 且不补零                |
| IP 字面量、单标签/内网主机、空主机         | 只接受多级 DNS 名称                  |
| 路径中的 `//`、`..`、非白名单字符          | 避免歧义路径                         |

同一份校验以 `src/api/config.ts` 的纯函数复核，编译期归一化结果必须与运行期一致。错误信息只说明变量与约束，不回显原值。

### 包名

- `UNI_ANDROID_PACKAGE_NAME` 留空时使用占位 `com.example.hehuoda`，只用于本地资源编译。
- `UNI_RELEASE=true` 必须显式注入受控包名；示例段（`example`）与 `io.dcloud`、`io.uni`、`com.dcloud`、`com.android` 保留前缀会被拒绝。
- 正式包名归属与域名仍属 #58/#219 后续验收，当前没有选定正式 ID。

### 权限与启动

- 仅声明 `<uses-permission android:name="android.permission.INTERNET"/>`。uni-app 运行时可能仍引入平台自身组件权限，**资源构建无法证明最终 APK 的权限清单**，必须对 APK 复核（见下）。
- 开屏沿用 DCloud 默认启动主题（`app-plus.splashscreen.autoclose`），未准备各密度启动图与原生图标。`src/static/hehuoda-logo.png` 只有 160×160（对应 40px 展示的 4 倍图），**不足** 48/72/96/144/192px 的 Android 启动器图标族，不能当作密度齐全。

## 2. 尚未验证：签名 APK

两条路径都**未在本任务执行**，选择需在 #219 后续判定。

### 路径 A（推荐首轮）：DCloud 离线 SDK 的本机 Android Studio/Gradle 打包

1. 从 DCloud 官方离线 SDK（[App 离线 SDK 文档](https://nativesupport.dcloud.net.cn/AppDocs/)）取得与本仓库编译层（`5.24` / `3.0.0-5020420260813003`）**匹配**的 Android SDK，或按该版本说明在 Android Studio 中打开官方离线工程模板。
2. **申请 AppKey（3.1.10 及以后的离线 SDK 同样必须）**：用 DCloud 开发者账号在开发者中心「应用管理 → 各平台信息 → 新增 Android」申请离线 AppKey，登记 DCloud 应用 AppID、Android 包名与签名证书 **SHA-1**（[申请 Appkey](https://nativesupport.dcloud.net.cn/AppDocs/usesdk/appkey)）。三者在打包后必须与实际产物一致，否则运行时报「未配置AppKey或配置错误」。这一步依赖 DCloud 账号，属 #58 外部条件，本任务未执行。
3. 将 `apps/uni/dist/build/app` 作为 www 资源放入工程（各 SDK 版本目录名不同，需按该版本官方文档核对）。
4. 核对包名：用 `UNI_ANDROID_PACKAGE_NAME` 注入并编译，再回读生成的两份 manifest——`apps/uni/src/manifest.json` 的 `app-plus.distribute.android.packagename`，以及 App 资源 `apps/uni/dist/build/app/manifest.json` 的 `plus.distribute.google.packagename`（两个键是同一段配置的生成前/生成后形态）。把该值写入原生工程 `applicationId`（同时对齐 `AndroidManifest.xml` 的 `package`）。`manifest.template.json` 里的 `com.example.hehuoda` **只是占位**，不是已选定包名。
5. 配置 `versionCode`/`versionName` 与产物 `manifest.json` 一致。
6. 用自有 Keystore 签名：`./gradlew assembleRelease`（keystore 与口令只放在本机或 CI 密钥，不入库）。

选择理由：离线 SDK 在**本机原生环境**完成编译与签名，不需要把签名证书、口令与 App 资源交给云端打包服务器；也便于把构建纳入自动化（#87）。代价是要维护 SDK 与编译层版本匹配，并且仍需 DCloud 开发者账号申请 AppKey（3.1.10+ 离线 SDK 不再是纯离线免申请）。

### 路径 B：DCloud 云打包

需要 HBuilderX 与 DCloud 开发者账号，在 IDE 内上传资源与签名证书并选择打包。账号、证书与配额均属 #58 外部条件，未准备；该路径会把签名材料交给云端打包服务器。

### 出包后必须核验（当前均未执行）

| 项             | 命令/方法                                                                     | 期望                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 包名           | `aapt2 dump badging app-release.apk` 或 `apkanalyzer manifest application-id` | 与 `UNI_ANDROID_PACKAGE_NAME` 注入并写入生成 manifest 的包名、原生工程 `applicationId`、申请 AppKey 时登记的包名四者一致 |
| 版本           | 同上 `versionCode` / `versionName`                                            | 与提交内的 `manifest.template.json` 一致且 `versionCode` 递增                                                            |
| 签名           | `apksigner verify --print-certs app-release.apk`                              | 证书 SHA-1 与申请离线 AppKey 时登记的值一致，未使用调试证书                                                              |
| 权限           | `aapt2 dump permissions app-release.apk`                                      | 只有实际需要的权限；出现定位/存储/相机等即需解释                                                                         |
| 摘要           | `Get-FileHash app-release.apk -Algorithm SHA256`                              | APK 文件本身的 SHA-256，记录到交付说明，供下载页与追溯（#86/#87/#228）；与证书指纹和 AppKey 登记无关                     |
| 安装           | `adb install -r app-release.apk`                                              | 覆盖安装成功，`versionCode` 递增生效                                                                                     |
| 冷启动         | 首次安装后强制停止再启动                                                      | 无白屏卡死，开屏正常关闭，且不提示「未配置AppKey或配置错误」（AppID、包名、证书 SHA-1 需与登记值一致）                   |
| API 连通       | 受控测试域名                                                                  | 只走 HTTPS，无明文与证书忽略                                                                                             |
| 系统浏览器外链 | 比赛详情官方来源                                                              | `CompetitionSourceAction.vue` 目前只有 H5/MP-WEIXIN 分支，Android 分支尚未实现，属 #219 剩余工作                         |

## 3. 明确未验证 / 不在本阶段

- 签名 APK 生成、证书与口令、离线 AppKey 申请与校验、`apksigner`/`aapt2` 实测输出、权限清单实测。
- 真机安装、覆盖升级、冷启动、状态栏/安全区/硬件返回键（#220/#226）。
- 正式包名、正式域名、DCloud 账号与云打包配额（#58）。
- Android 系统浏览器外链（#219 真机阶段）；本阶段未改 `CompetitionSourceAction.vue`，避免认证与 UI 改造外溢。
- iOS、微信小程序继承路径不做新增适配。
