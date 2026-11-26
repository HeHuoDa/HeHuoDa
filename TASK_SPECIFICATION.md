# Issue #83 技术规格

## 1. Task Metadata

| 项目     | 内容                                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------------- |
| 仓库     | `HeHuoDa/HeHuoDa`                                                                                         |
| Issue    | #83 · [Task][用户端][前端] 建立 H5 与 Android 双端构建及客户端回归自动化门禁                              |
| 任务分支 | `jingtll/issue83`，复用 Orca 为本任务创建的分支                                                           |
| 核对基线 | `ccaf85a4c581f35cbc3022ce8a6f4ce139794c4b`，开工时与本地 `main` 及缓存的 `origin/main` 一致               |
| 依赖     | #219 的 App-Plus 资源构建入口已由 PR #240 合入基线，足以实施 #83。#219 所列原生打包与真机剩余项仍独立验收 |
| 规格版本 | 2026-11-26                                                                                                |
| 执行顺序 | Pi 实施并本地验证，Agy 按项目规范和本规格独立审核                                                         |

## 2. Project Context

用户端是普通 uni-app（Vue 3）工程 `apps/uni`。现行发布目标是同源 H5 和由受控 HTTPS 入口分发的签名 Android APK。M1 保留三栏导航、公开比赛浏览、暂缓提示和会话内临时收藏。M2 采用川农统一身份认证，H5 刷新走 HttpOnly Cookie，Android 安全持久化由 #220 交付。参见 [ADR 0011](docs/adr/0011-android-h5-and-sicau-only-auth.md)、[业务领域词汇](GLOSSARY.md) 与 [迁移现状和 #219 记录](docs/agents/uni-app-migration.md#issue-219android-本地资源构建现行2026-11-26)。

仓库使用 pnpm 工作区和 Node 自带测试运行器。GitHub Actions 使用根级命令，`ci-gate` 汇总质量与镜像冒烟检查。旧用户端 `apps/web` 保留作历史对照及回滚入口，管理端 `apps/admin` 独立。#83 对应的使用者是提交客户端改动的开发者，以及需要依据自动检查判断改动能否进入主线的维护者。

## 3. Original Issue

以下忠实转述委派任务提供的 #83 正文要点。完整原文、评论及远端元数据未提供，本轮授权仅限本地核对。

1. **CI 与本地双端构建门禁**。纳入可自动执行的 Android `app` 资源编译，H5 与 Android 构建门禁使用相同的本地和 CI 命令，不依赖 `UNI_MP_WEIXIN_APPID`。
2. **核心客户端单元测试与契约守护**。覆盖导航映射、安全 URL 策略、API 配置校验、会话状态机（含 Cookie 模式与存储适配器）、暂缓页状态和表单校验。先盘点现有测试，只补实质缺口。
3. **跨平台静态防退化检查**。对通用或 H5 代码明文持久化刷新令牌以及引入微信专属接口的违规写法给出可自动失败的检查。

Issue 非目标原样保留：

- 不要求 CI 每次 PR 云端打最终签名 APK（签名发布归 #87）。
- 不承担 #84 的浏览器验收。

## 4. Objective

当前 PR 的根级构建验证了 H5 和遗留小程序资源。Android 资源编译和部分跨端安全契约已有独立入口，维护者仍可能在 CI 全绿时漏掉 Android 编译失败或新增平台专属调用。

让每次现有 CI 触发都实际编译 H5 和 App-Plus 资源，并沿用同一组本地入口。利用测试和 ESLint 在更早阶段拦截客户端契约退化，使用已有模块和测试夹具给出可定位的失败信息。

## 5. Current Behavior

下表的行号均基于 `ccaf85a`。

| 主题              | 当前行为与证据                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI 调度           | [.github/workflows/ci.yml:3–22](.github/workflows/ci.yml#L3-L22) 定义 PR、主线 push、手动触发、并发策略与 Ubuntu `quality` 15 分钟限额。第 37–63 行使用 Node/pnpm，依次运行格式、Lint、部署测试、隔离 SSH、OpenAPI 生成与差异校验、类型检查、构建、单元、集成和 E2E。第 65–68、112–124 行将 `quality` 串到 `image-smoke`，两者成功才通过 `ci-gate`。                                                                                   |
| 构建入口          | [package.json:8–17](package.json#L8-L17) 以 `pnpm -r --if-present build` 执行工作区构建，Lint、类型、单测也递归执行。[apps/uni/package.json:5–17](apps/uni/package.json#L5-L17) 的默认 `build` 调用版本预检、H5、`mp-weixin`，`build:app` 独立。CI 当前编译 H5 与 `mp-weixin`，Android 尚未接入。                                                                                                                                      |
| 平台预检          | [platform-config.mjs:169–205](apps/uni/scripts/platform-config.mjs#L169-L205) 的 `app` 分支先返回，AppID 与 Android 配置独立。H5 也会落入微信 AppID 校验，这是本次复核发现的隐性依赖。没有 AppID 且未启用 `UNI_RELEASE` 时，遗留小程序分支沿用游客编译，第 42–45 行打印提示；见 [run-uni.mjs](apps/uni/scripts/run-uni.mjs#L42-L45)。                                                                                                  |
| Manifest 与子进程 | [run-uni.mjs:9–56](apps/uni/scripts/run-uni.mjs#L9-L56) 校验入口、合并 Vite 环境、由模板生成 `src/manifest.json`。[第 57–79 行](apps/uni/scripts/run-uni.mjs#L57-L79) 用当前 Node 启动 DCloud CLI，传递退出码。[run-config.mjs:23–56、65–103](apps/uni/scripts/run-config.mjs#L23-L56) 固定 App 编译的 mode 和输入输出目录，回填校验后的配置，并拒绝覆盖参数。                                                                         |
| 工具链            | [check-toolchain.mjs:10–25、48–74](apps/uni/scripts/check-toolchain.mjs#L10-L25) 验证 Vue、Pinia、DCloud 依赖和内嵌运行时，包括当前仍强制校验的小程序专用包及 `uni-mp-vue`。工具链检查的成功提示规定了证据边界。                                                                                                                                                                                                                       |
| API 地址和超时    | [config.ts:7–33](apps/uni/src/api/config.ts#L7-L33) 是运行期纯函数。H5 开发缺地址时默认相对 `/api/v1`，正式 H5 可使用相对地址。Android 启动时额外要求完整 HTTPS，入口预检还严格拒绝歧义地址。[client.ts:44–57](apps/uni/src/api/client.ts#L44-L57)、[platform-config.mjs:9–27、39–130](apps/uni/scripts/platform-config.mjs#L39-L130)。超时省略或空白时默认 5000 ms，显式配置须为 1–60000 ms 的整数。                                  |
| 登录与存储        | [stores/auth.ts:18–50](apps/uni/src/stores/auth.ts#L18-L50) 将平台模式和存储适配器注入状态机。[platform-storage.ts:16–59](apps/uni/src/auth/platform-storage.ts#L16-L59) 仅 `mp-weixin` 读写 uni 存储，H5（`web`）、Android（`app`/App-Plus）及未知端读取 `null`、写入和清理为空操作。H5 多标签协调另有一处合法 Web Storage 写入，使用固定键存协调元数据。[h5-tab-sync.ts:4–31、154–183](apps/uni/src/auth/h5-tab-sync.ts#L154-L183)。 |
| 现有静态检查      | [eslint.config.mjs:22–52](eslint.config.mjs#L22-L52) 声明 H5 适配器和 uni 平台全局量，[apps/uni/package.json:14–17](apps/uni/package.json#L14-L17) 接入 Lint 与 `node --test`。已有局部源码契约和可执行单测，缺少统一的客户端 Web Storage 与微信专属调用约束。                                                                                                                                                                         |
| 生成文件          | `git ls-files` 未列出生成 manifest、uni `dist/` 或 `*.tsbuildinfo`。[`.gitignore`:18–23、93–105](.gitignore#L18-L23) 排除这些文件及目录，受跟踪输入为 [manifest.template.json](apps/uni/manifest.template.json)。现有 CI 差异检查只限定两个 OpenAPI 文件，见 [ci.yml:57–58](.github/workflows/ci.yml#L57-L58)。                                                                                                                        |

Windows 基线实测（Node 24.15.0、pnpm 10.30.3）：`pnpm --filter @hehuoda/uni typecheck` 退出 0，`pnpm --filter @hehuoda/uni test:unit` 281 项通过。直接执行 `node --test apps/uni/scripts` 在该版本把目录视为入口，报 `MODULE_NOT_FOUND`，后续统一使用包脚本。以 `https://api.hehuoda.test/api/v1`、15000 ms 与占位包名执行 `build:app` 退出 0，用时约 36 秒。回读 `dist/build/app/manifest.json` 与 `app-service.js` 一致，生成文件未进入 Git 状态。

## 6. Expected Behavior

1. 作为开发者，我可以运行 CI 用的命令生成 H5 和 App-Plus 资源，以便在提交前发现任一目标的编译错误。
2. 作为开发者，我在未配置微信 AppID 或本机残留无效微信 AppID 时仍可编译两端，避免由已退役的交付目标阻塞。
3. 作为开发者，我可以依靠配置错误与构建退出码诊断失败，即使磁盘上还保留着上次成功构建。
4. 作为维护者，我可以通过现有 `ci-gate` 看到任一目标编译、Lint 或客户端单测失败后的阻断结果。
5. 作为手机用户，我原有的导航映射、安全链接判断、暂缓页行为及表单校验继续由自动化测试守护。
6. 作为已登录的 H5 用户，我的访问令牌继续仅驻留内存，刷新继续走 Cookie；多标签协调所需的非敏感元数据仍可保存。
7. 作为 Android 客户端的维护者，我可以观察到当前空存储适配器的契约，并在 #220 实施时有明确的测试更新位置。
8. 作为审核者，我能分辨构建证据、测试替身的行为证据、浏览器验收、真机验收和签名发布的完成程度。

## 7. Scope / Out of Scope

- **本次交付**。实现 H5 与 App-Plus 顺序编译的 CI 与本地入口，解除 H5 构建预检对微信 AppID 的访问，新增少量最能覆盖实际缺口的单测，并以现有 Lint 阻断客户端跨平台违规写法。
- **后续 Issue**。#224 和 #223 承担遗留微信平台、登录、依赖与条件分支清理。#220 承担 Android Keystore、安全存储降级提示及生命周期适配，#221/#222 承担认证接入，#225/#226 承担 H5 登录与 Android 真机全流程。
- **签名、分发和浏览器验证**。#87 承担签名发布，#219 剩余工作按原边界跟踪，#84 承担 H5 浏览器验收。应用商店、iOS、生产切流、发布产物上传以及服务端接口和迁移均不在本次实施范围。

## 8. Codebase References

| 路径                                                                                                                                                                                                                                         | 这里改什么                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [.github/workflows/ci.yml](.github/workflows/ci.yml#L48-L63)                                                                                                                                                                                 | 给现有工作区构建步骤注入 H5 同源地址，紧随其后新增 App-Plus 构建步骤与该步骤的测试环境变量。                                                                                                                                      |
| [package.json](package.json#L8-L17)                                                                                                                                                                                                          | 继续用根级递归入口承接 H5、类型、Lint 与单测，根脚本无需修改。                                                                                                                                                                    |
| [apps/uni/package.json](apps/uni/package.json#L5-L17)                                                                                                                                                                                        | 默认 `build` 保留工具链预检和 H5 编译，移除默认链里的遗留小程序编译；两个目标的直接构建命令仍可单独调用。                                                                                                                         |
| [platform-config.mjs](apps/uni/scripts/platform-config.mjs#L169-L225)                                                                                                                                                                        | 明确 H5 配置与 manifest 分支，隔离 AppID 读取和写入；保留 App 与遗留小程序的各自预检。                                                                                                                                            |
| [run-uni.mjs](apps/uni/scripts/run-uni.mjs#L17-L80)、[run-config.mjs](apps/uni/scripts/run-config.mjs#L23-L56)                                                                                                                               | 复用 CLI 入口、退出语义和输出目录，无需增添 runner、临时 manifest 或自动清理。                                                                                                                                                    |
| [check-toolchain.mjs](apps/uni/scripts/check-toolchain.mjs#L10-L74)                                                                                                                                                                          | 默认仅校验 H5、App 及共用工具链；现有小程序专用包与内嵌运行时版本检查放到显式遗留选项。                                                                                                                                           |
| [run-config.test.mjs](apps/uni/scripts/run-config.test.mjs#L134-L185)、[platform-config.test.mjs](apps/uni/scripts/platform-config.test.mjs#L21-L62)、[app-entry.test.mjs](apps/uni/scripts/app-entry.test.mjs#L150-L230)                    | 补 H5 明确隔离 AppID 的用例，保留 Android 配置、CLI 退出和遗留预检已有用例。                                                                                                                                                      |
| [eslint.config.mjs](eslint.config.mjs#L22-L65)                                                                                                                                                                                               | 为客户端源码配置基于语法树的限制，精确限定两个存储适配器和旧微信登录的例外。新增规则的回归测试使用现有 `node --test`。                                                                                                            |
| [http.test.mjs](apps/uni/scripts/http.test.mjs#L55-L112)、[auth-login.test.mjs](apps/uni/scripts/auth-login.test.mjs#L269-L292)、[h5-tab-sync.test.mjs](apps/uni/scripts/h5-tab-sync.test.mjs#L114-L155)                                     | 分别补端别配置边界、Android 和未知端空存储、真实 H5 默认存储适配器。被测 [API 配置](apps/uni/src/api/config.ts)、[存储模块](apps/uni/src/auth/platform-storage.ts) 和 [协调模块](apps/uni/src/auth/h5-tab-sync.ts) 保持现行行为。 |
| [teams-deferred.test.mjs](apps/uni/scripts/teams-deferred.test.mjs#L50-L124)、[notifications-deferred.test.mjs](apps/uni/scripts/notifications-deferred.test.mjs#L56-L124)、[component-host.mjs](apps/uni/scripts/component-host.mjs#L7-L34) | 在已有组件宿主增加 `APP-PLUS` 的暂缓态与跳转失败断言，复用已有状态夹具。                                                                                                                                                          |
| [README.md](README.md#L118-L133)                                                                                                                                                                                                             | 补本地复跑的命令、所需变量与产物说明。历史迁移篇章保留。                                                                                                                                                                          |

## 9. Design Specification

**无 UI 视觉变更。** 改动仅覆盖 CI、构建预检、工具链检查、ESLint 与测试。暂缓页、表单、文案、导航、触控和运行时安全策略继续沿用现有程序。H5/Android 双端也不新增浏览器或原生 API。

组件宿主只验证转译到 H5、`APP-PLUS` 时的既有契约。320/375/390/430px 布局与真实浏览器状态由 #84 等任务验证，Android 硬件返回、安全区与冷启动由 #220/#226 验证。实施中若发现必须改变页面或运行时逻辑，记录触发该结论的失败和归属 Issue；任何另外授权的 UI 改动需按 `AGENTS.md` 实测四个宽度、受影响的长文本/空态/加载/错误态，并独立记录真机验证。

## 10. Architecture Decisions

1. **Ubuntu 执行真实资源编译。** `build:app` 只通过 Node 调用 npm 安装的 DCloud CLI 生成 App-Plus www 资源，使用现有 Node/pnpm 安装步骤即可，HBuilderX、Android SDK 和 JDK 无需成为该门禁的依赖。代码路径见 [run-uni.mjs:47–79](apps/uni/scripts/run-uni.mjs#L47-L79) 与 [run-config.mjs:45–55、86–103](apps/uni/scripts/run-config.mjs#L86-L103)，原生集成和签名边界见 [#219 构建说明](docs/android-app-build.md#2-尚未验证签名-apk)。官方将该类资源编译列为可在 CI 运行的 CLI 能力，本项目用锁定工具链实际跑 `-p app`，输出目录以脚本为准。[DCloud CLI 快速上手](https://uniapp.dcloud.net.cn/quickstart.html)

   当前没有 Ubuntu 实跑证据。先按正常门禁接入，从同一工作区用匹配 Node/pnpm 的可用本地 Linux 或后续获准的 CI 执行确认。遇到 Linux 专属失败，保留非零退出并优先修复可移植性。仅在确认该锁定编译器无法在 Ubuntu 执行且协调者确认降级时，才考虑 CI 继续运行工具链、App 预检/入口替身测试及类型检查，并将真实资源编译转交受支持环境作为单独证据；这无法拦截 Linux 上实际资源编译、打包图或平台插件回归，默认验收仍要求 Ubuntu 运行真实编译。

2. **沿用 `quality`。** App 构建紧跟根级 `pnpm build`，前序失败时正常停止。沿用工作流级 `concurrency`、`image-smoke needs: quality`、`ci-gate needs: [quality, image-smoke]`，保留 15 分钟限额。该改动替换原有小程序编译并共享安装，Windows App 单独编译约 36 秒，Ubuntu 的 `quality` 总时间仍待观察。只有在允许取得可复查的超时证据后再调整预算或讨论独立 job；若拆分，须把新 job 纳入 `ci-gate.needs` 和成功条件。[CI 调度与汇总](.github/workflows/ci.yml#L14-L22)、[质量步骤](.github/workflows/ci.yml#L47-L67)、[ci-gate](.github/workflows/ci.yml#L112-L124)
3. **门禁与微信解耦。** 默认包级构建变为 `pnpm check:toolchain && pnpm build:h5`，App 由 CI 下一步与本地同命令独立编译。H5 预检直接返回空 AppID 和现有 `release` 值，H5 manifest 使用克隆模板，只有 `mp-weixin` 分支写入微信 AppID。Android 已独立，继续使用原分支。将仅遗留端使用的 `@dcloudio/uni-mp-weixin` 和 `uni-mp-vue` 校验收至 `--include-legacy-weixin`。保留 H5/App 和共用 Vite/Tailwind 校验（包括两端均在用的 `weapp-tailwindcss`），依赖声明、显式小程序构建命令及现有 `MP-WEIXIN` 代码留给 #224。[默认构建](apps/uni/package.json#L5-L17)、[预检与 manifest 分发](apps/uni/scripts/platform-config.mjs#L169-L225)、[工具链](apps/uni/scripts/check-toolchain.mjs#L10-L74)、[共用 Vite 插件](apps/uni/vite.config.ts#L10-L19)
4. **按步骤注入编译变量。** 根级 `pnpm build` 的步骤环境设 `VITE_API_BASE_URL=/api/v1`，仓库其他现行工作区没有读取该变量的应用入口。App 步骤使用 `VITE_API_BASE_URL=https://api.hehuoda.test/api/v1`、`VITE_API_TIMEOUT_MS="15000"`、`UNI_RELEASE="false"` 与 `UNI_ANDROID_PACKAGE_NAME=com.example.hehuoda`。仅用于构建，地址无须连通。步骤标题明确 H5/工作区与 Android App-Plus 资源构建，保留已有预检的变量名、错误约束和非零退出，不打印被拒绝的原值。两步均不写真实域名、账号凭据、正式 AppID 或签名材料。[环境优先级与错误传播](apps/uni/scripts/run-uni.mjs#L17-L31)、[API 预检](apps/uni/scripts/platform-config.mjs#L9-L27)、[包名及 release 分支](apps/uni/scripts/platform-config.mjs#L169-L205)
5. **按 Git 忽略规则隔离生成文件。** 同一工作区的两种目标顺序构建，避免同时覆盖 `apps/uni/src/manifest.json`。沿用现有忽略项，提交前核对 Git 状态、暂存区和生成文件跟踪状态。既有 OpenAPI 差异检查继续只针对原两文件；额外的工作区清洁核对放在本地验证，避免从忽略目录清理或添加生成文件。出错时以退出码为准，旧产物目录保留并可能仍存在。[写入与退出](apps/uni/scripts/run-uni.mjs#L53-L79)、[忽略规则](.gitignore#L18-L23)、[manifest 忽略](.gitignore#L93-L105)、[CI 差异检查](.github/workflows/ci.yml#L57-L58)
6. **变动发生在构建与门禁。** 显式配置相同的生产构建保持原运行时功能，H5 的新行为是预检跳过与目标无关的 AppID，CI 的 H5 产物按部署契约使用同源 API。客户端代码中的 URL、会话和存储逻辑由现有模块负责；H5/App 的替身断言与资源编译证据不能替代手机浏览器、WebView 或真机接受度。执行范围按第 9 节。[H5/App 平台运行时入口](apps/uni/src/api/client.ts#L8-L14)、[H5 与 App 参数边界](apps/uni/scripts/run-config.mjs#L60-L103)

### 静态规则的边界

- 使用当前 ESLint 的 `no-restricted-syntax` 约束客户端脚本，Vue 模板表达式用现有插件的 `vue/no-restricted-syntax` 补齐。范围为 `apps/uni/src` 与 `packages/client-domain/src` 下被 ESLint 解析的生产脚本，以及 uni 的 Vue SFC。用 AST 规则匹配代码用法，普通注释或测试 fixture 不参与生产规则。依赖现有根级 `pnpm lint` 和包级 `lint`，规则级别为 `error`。
- 限制直接使用 `localStorage`、`sessionStorage`，至少覆盖裸标识符、`window` / `globalThis` 的点号与字符串字面量下标。唯一 `localStorage` 例外是 `apps/uni/src/auth/h5-tab-sync.ts` 的既有协调适配器，该文件仍受 `sessionStorage` 限制，默认适配器的实际落盘内容由行为测试约束。规则禁止新增公共模块直接绕到 `uni` 的明文存储 API（`getStorage[Sync]`、`setStorage[Sync]`、`removeStorage[Sync]`、`clearStorage[Sync]`，含字面量下标），唯一现有例外为 `apps/uni/src/auth/platform-storage.ts` 的遗留适配器，边界由端别替身测试守护。
- 限制 `wx` 全局接口的直接使用，覆盖裸对象、显式全局属性、字面量下标等常见写法。限制 `uni.login` 和成员名明确含 `Weixin` 的专用入口，仅在既有 `apps/uni/src/auth/wechat-login.ts` 许可 `uni.login`。通过 `no-restricted-imports` 禁止生产源码新增对旧登录适配器或 `@dcloudio/uni-mp-weixin` 的静态导入，覆盖省略或带 `.ts` 的本地导入路径。普通 `uni.request`、`uni.switchTab` 等共享 API 不受限制，保留既有编译宏。新增代码不得用别名、动态计算属性或行内忽略规避约束，AST 规则的非目标是跨文件数据流证明。
- H5 Cookie 协议和多标签协调经现有客户端入口测试。浏览器存储允许保存无身份、无令牌的协调元数据。规划时核对了 `modern-web-guidance` 的 `privacy` 与 `security` 指南，分别守护 Web Storage 中无敏感令牌、会话 Cookie 使用 HttpOnly；现有 Cookie 属性以 ADR 0011 为准。[OWASP Web Storage 指南](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#storage-apis)

## 11. Implementation Steps

1. 从 Orca 当前任务分支开工。用 `git status --short --branch` 与 `git log -3 --oneline` 核对当前分支和规格提交。使用 `.nvmrc` 的 Node 24 与 pnpm 10.30.3，依赖未准备时使用 `pnpm install --frozen-lockfile`。
2. 在 `run-config.test.mjs` 或 `platform-config.test.mjs` 先写 H5 隔离测试。H5 对缺失 AppID、不可用的历史 AppID 和有效的 `UNI_RELEASE=true` 都正常生成编译计划，原模板不被修改。App 使用有效 HTTPS 与有效包名时忽略无效遗留 AppID；遗留目标仍拒绝无效 AppID 或 release 缺 AppID。先确认 H5 用例因现有隐式共享分支失败，然后修改 `platform-config.mjs` 的 H5/manifest 分发，保留原 H5 Vite 参数透传。
3. 修改 `apps/uni/package.json` 的默认 `build` 与 `check-toolchain.mjs` 的默认检查目标。默认验证 H5/App 与共用工具链，显式遗留选项追加既有小程序专用检查。给 CI 的原构建步骤加入 H5 环境，随后接入 App 步骤；原工具链安装、测试顺序、镜像与汇总条件沿用。README 同步第 14 节的本地复跑方法。
4. 核对下列测试清单，扩充已有测试入口。使用行为返回值、与替身的交互以及真实组件宿主的可观察状态，避免对内部实现文本重复锁定。

   | 契约                    | 现有覆盖                                                                                                                                                                                                                                | 需要补的缺口                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
   | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | 导航映射                | `navigation-contract.test.mjs:54–259` 双向一致、三栏 tabBar、旧链接与参数异常；`h5-router.test.mjs:29–99` 真实 Vue Router 内存历史、深链与跳转失败。                                                                                    | 复用现有用例。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
   | 安全 URL                | `source-actions.test.mjs:10–193` 区分通用来源地址、手工比赛外链和遗留承载页，覆盖危险输入及 H5/管理端一致性；`auth-login.test.mjs:294` 起验证返回目标限制。                                                                             | 复用现有用例。Android 系统浏览器调起归 #219 后续。                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
   | API 配置                | `http.test.mjs:55–112` 覆盖 H5 同源、默认值与常见非法值；`platform-config.test.mjs:64–191` 与 `app-entry.test.mjs:174–229` 覆盖 Android 严格预检、错误和 Vite 子进程环境。                                                              | 在 `http.test.mjs` 直接补 `platform: "app"` 的运行期纯函数用例：正式 App 走完整 HTTPS 并归一尾斜杠，拒绝相对和正式明文地址。用 H5 同源作为对照；增加超时恰好 1 和 60000 的接受样例，非法值沿用现有用例。App 开发 HTTP 的运行时额外拒绝由 `app-platform.test.mjs` 和编译期预检守护。                                                                                                                                                                                                                                             |
   | 会话、Cookie 与平台存储 | `auth-session.test.mjs:115–276、370–487` 覆盖恢复、刷新单飞、登出、过期、账号切换与 Cookie 模式；`auth-client.test.mjs:124–245` 覆盖 Cookie + CSRF、无 Bearer 与响应守卫；`h5-tab-sync.test.mjs:114–413` 覆盖多标签、不可用存储与竞态。 | 扩展 `auth-login.test.mjs` 的现有存储用例，使用预置旧刷新令牌的 uni spy，H5、`app`（可含 `app-plus`）、未知端、平台探测抛错时 `read()` 都返回 `null`，`write()`/`clear()` 不触发平台存储；遗留端仍保留既有读写语义。追加默认 H5 adapter 的行为测试，如利用 `createH5TabSync` 的 fake locks/channel 但省略 `coordStorage`，替换并恢复 `globalThis.localStorage`，经登录广播及刷新/退出抓取每次实际写入，检查仅固定键、JSON 顶层字段仅 `seq/roundId/status/ownerTabId/logoutSeq/updatedAt/retryUntil`，值不含测试令牌和用户标识。 |
   | 暂缓页状态              | `teams-deferred.test.mjs:50–124`、`notifications-deferred.test.mjs:56–124` 已通过 H5/MP-WEIXIN fixture 检查暂缓、不可执行演示写入及主导航，失败用例目前仅 H5。                                                                          | 在相同组件契约下加入 `APP-PLUS` fixture，覆盖找队友、旧发布招募、旧队伍详情和站内通知，以及首页/个人中心跳转失败后的可重试提示。保留既有测试目标。                                                                                                                                                                                                                                                                                                                                                                              |
   | 表单校验                | `draft-form.test.mjs:5–72` 已验证首错、保留草稿、防重复保存及密码不 trim；`school-login.test.mjs:137–258` 和 `auth-login.test.mjs:152–267` 已验证弱网以外的字段和验证码约束；`forms.test.mjs:99–140` 验证 H5 禁用、加载态和空值分支。   | 复用现有用例。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

5. 落地第 10 节静态规则，并新增 `apps/uni/scripts/cross-platform-lint.test.mjs`。使用已安装 ESLint 的 `lintText`，给虚拟源码指定真实规则范围内的 `filePath`，断言诊断规则和错误严重级别。负例包含 H5/common 的刷新令牌 Web Storage 写入、方括号形式、`uni.setStorageSync`、`wx.request` 以及非旧适配器中的 `uni.login` 或对旧登录适配器的导入。验证 Vue SFC 的脚本和模板负例以及共享模块负例，正例使用普通 `uni` API、注释中的术语和三处受控例外。静态规则与运行期写入断言分别验证边界。
6. 完成第 14 节验证，按可独立审查的阶段提交构建门禁、契约与静态检查改动。暂存前审阅差异，仅记录实际证据，向 Agy 交付提交范围和命令输出摘要。

## 12. Technical Constraints

- 使用仓库锁定工具链、已有 ESLint/Vue 解析器和 Node 单测入口。无需新增依赖或路由、页面、接口、数据库迁移及部署改动。
- #224 专属平台代码、依赖声明与已有可选入口保留；#87 签名发布和历史迁移文件保留原样。
- `apps/uni/src/**` 的行为以当前版本为准。对 `APP-PLUS` 暂缓态和默认空存储使用行为断言。#220 实施真实安全存储时再更新 App 专属契约。
- 原始外部输入、秘密、测试 APK、生成 manifest、缓存和构建目录均不得提交。现行 README 可记录复跑办法，验收截图和原始输出仍按项目约定保留本地。
- CI 的 HTTPS 域名是保留测试域，禁止当作正式服务验证资源。远端 CI 查询、发布、部署、Issue/PR 更改按独立授权执行。

## 13. Edge Cases & Risks

- 有旧 `.env.local`：进程变量高于 Vite 文件配置；H5 跳过 AppID，App 配置校验保持原策略。若设了 CLI 禁止的 App 目录/子包覆盖，现有预检会失败并报告变量，纠正环境后重跑。
- 刚构建过另一个目标：两个构建与本地 watch 共用生成 manifest。一次只运行一个同工作区命令。错误后即使仍有旧产物也按失败记录。
- 现有非致命 Node `MODULE_TYPELESS_PACKAGE_JSON` 提示可作为编译日志区分。禁止用过滤错误、`continue-on-error`、目录存在或伪造产物让门禁成为成功。
- 静态语法检查覆盖约定的存储和微信 API 访问方式。运行期构造属性、第三方依赖内部与跨模块流向仍需代码审查，存储适配器由行为测试盯住。
- 组件宿主、假存储与 HTTP 替身只能覆盖自动化契约。浏览器 Cookie 设置、真实 TLS、Android 原生桥、SDK 包权限与签名证书仍需各自的目标环境。Linux 编译兼容性和 CI 总耗时待真实运行证据。
- Issue 正文仅有委派提供的要点，历史远端标签、评论和状态本轮没有核对。

## 14. Testing Requirements

从仓库根目录执行。表中的新增测试在 Pi 实施后生效，当前规格阶段实测结果见第 5 节。

| 证据                | 可执行命令                                                                                                                                                                                                                     | 预期                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 本地工具链          | `pnpm --filter @hehuoda/uni check:toolchain`                                                                                                                                                                                   | H5 与 App 及其共用工具链的配套检查退出 0。显式旧端验证可用 `pnpm --filter @hehuoda/uni check:toolchain --include-legacy-weixin`，无需纳入 #83 通过条件。                            |
| 本地目标测试        | `node --test apps/uni/scripts/run-config.test.mjs apps/uni/scripts/platform-config.test.mjs apps/uni/scripts/app-entry.test.mjs apps/uni/scripts/app-platform.test.mjs apps/uni/scripts/cross-platform-lint.test.mjs`          | App/H5 预检与固定子进程契约通过。违规虚拟源码有预期 error 诊断，合法用法无相关诊断。                                                                                                |
| 本地客户端回归      | `pnpm --filter @hehuoda/uni test:unit`                                                                                                                                                                                         | 导航、安全 URL、两端配置、会话、Cookie、存储、暂缓页和表单全部通过；报告实测数量。CI 相同入口由根 `pnpm test:unit` 递归调用。                                                       |
| 本地工作区静态质量  | `pnpm format:check`、`pnpm lint`、`pnpm --filter @hehuoda/uni typecheck`                                                                                                                                                       | 退出 0。CI 还运行原有工作区类型及其他质量步骤。                                                                                                                                     |
| 本地 H5 与 App-Plus | 按下方平台对应命令依次运行                                                                                                                                                                                                     | H5 退出 0 并生成 `apps/uni/dist/build/h5/index.html`；App 退出 0 并生成 `apps/uni/dist/build/app/manifest.json` 和 `app-service.js`。资源的包名、API 基址与超时与测试构建配置一致。 |
| 本地失败路径        | 暂把 App 的 `VITE_API_BASE_URL` 改为 `/api/v1` 或把 `VITE_API_TIMEOUT_MS` 改为 `60001`，各自执行 `pnpm --filter @hehuoda/uni build:app`，随后恢复正确环境并重跑。                                                              | 两个负例均非零，分别指出变量名与约束，无本次成功提示。旧产物存在时仍判定失败。                                                                                                      |
| 本地 Git 状态       | `git ls-files -- apps/uni/src/manifest.json apps/uni/dist ':(glob)**/*.tsbuildinfo'`、`git diff --exit-code -- apps/uni/src/manifest.json apps/uni/dist ':(glob)**/*.tsbuildinfo'`、`git status --short --untracked-files=all` | 首两条无生成文件，状态中只有计划改动。再用 `git diff --cached --name-only` 核对实际提交边界。                                                                                       |
| CI                  | 现有 `.github/workflows/ci.yml` 自动执行下方 Bash 中的两条构建命令及原有质量检查                                                                                                                                               | 串行执行成功才使 `quality` 成功；编译、Lint、单测的任何失败阻断 `ci-gate`。未获远端查询授权时记录“远端 CI 未查验”，以已运行的本地证据交付。                                         |
| 浏览器/真机/生产    | 本次无执行命令，分别由 #84/#225、#219 后续/#226 和发布任务验证                                                                                                                                                                 | 记录“本轮无浏览器、签名 APK、真机或生产验收”。                                                                                                                                      |

Bash（CI 分别使用步骤级 `env`）：

```bash
env -u UNI_MP_WEIXIN_APPID VITE_API_BASE_URL=/api/v1 pnpm build &&
  env -u UNI_MP_WEIXIN_APPID VITE_API_BASE_URL=https://api.hehuoda.test/api/v1 \
    VITE_API_TIMEOUT_MS=15000 UNI_RELEASE=false UNI_ANDROID_PACKAGE_NAME=com.example.hehuoda \
    pnpm --filter @hehuoda/uni build:app
```

PowerShell（在专用于验收的终端执行）：

```powershell
Remove-Item Env:UNI_MP_WEIXIN_APPID -ErrorAction SilentlyContinue
$env:VITE_API_BASE_URL = '/api/v1'
pnpm build
if ($LASTEXITCODE -ne 0) { throw '工作区构建失败' }

$env:VITE_API_BASE_URL = 'https://api.hehuoda.test/api/v1'
$env:VITE_API_TIMEOUT_MS = '15000'
$env:UNI_RELEASE = 'false'
$env:UNI_ANDROID_PACKAGE_NAME = 'com.example.hehuoda'
pnpm --filter @hehuoda/uni build:app
if ($LASTEXITCODE -ne 0) { throw 'App-Plus 资源构建失败' }
```

仅迭代 uni 时可将第一条构建缩小为 `pnpm --filter @hehuoda/uni build`。验证表中的双端命令使用隔离环境，若本机设置了遗留产物、输入或子包覆盖变量，应在本次测试进程中取消这些变量。

## 15. Acceptance Criteria

- [ ] 现有 CI 工作流顺序运行 H5 和 App-Plus 两端真实资源编译，干净环境无需微信 AppID、HBuilderX 或原生 SDK。相同命令可在本地复跑。
- [ ] 默认链路的构建目标和小程序专用版本检查已解耦，H5 与 App 在旧 AppID 无效时仍可生成编译计划，显式遗留小程序入口保留。
- [ ] API 基址和超时负例产生可定位错误及非零退出，CI 与本地使用显式测试配置。顺序构建之后 Git 未出现生成文件变更。
- [ ] 第 11 节六类客户端契约由既有与增量测试共同守护。Cookie 请求、H5 跨标签协调、Android/未知端空存储与 `APP-PLUS` 暂缓页有可复查断言。
- [ ] 普通客户端源码中加入最小负例时，现有 Lint 入口按规则报错并失败。H5 合法协调元数据和遗留受控适配器通过，令牌落盘的回归用例会失败。
- [ ] 原 `ci-gate` 名称、并发策略与镜像 smoke 前置关系沿用。签名发布及浏览器/真机证据分别按关联 Issue 跟踪。

## 16. Definition of Done

实现分支上的 CI 定义、默认构建、Lint、增量测试和 README 可由同一提交范围审查。第 15 节每个条件都有工作流配置、命令结果或断言对应，Agy 能据此独立核对项目规范与需求规格。以默认命令复跑第 14 节本地检查，记录结果及仍需实际 Ubuntu 运行确认的事项。严格区分本地、远端 CI、浏览器、真机和生产证据，避免把本地编译成功作为后续 Issue 的完成凭据。
