# Pull Request 约定

## 项目模板优先

创建或更新 PR 正文前，必须读取根目录 `.github/PULL_REQUEST_TEMPLATE.md`，按其中的章节、顺序和检查项填写。项目模板优先于全局技能、插件、CLI 和其他工具的默认模板；`pr` 等技能可补充章节内的内容，正文结构以项目模板为准。

模板是正文结构的唯一来源，此文档不复制章节清单。用户明确指定其他格式时，按用户要求执行。

## 填写与发布

1. 核对目标分支、任务提交与改动范围，只包含当前任务。
2. 读取项目模板，保留全部章节与检查项；不适用的部分明确填写“不适用”并简述原因。
3. 将实际检查命令、结果、未验证部分和迁移影响填入对应章节。仅在检查实际通过或满足不适用条件时勾选；区分本地检查与远端 CI。
4. 界面变更的截图按项目产物边界保留本地，在截图章节记录视口、验证结论和截图保留位置；未上传时明确说明。
5. 使用 `gh pr create/edit --body-file` 或结构化工具参数发布时，正文必须包含已填写的项目模板；显式传入正文不会自动套用仓库模板。
6. 发布后重新读取远端 PR，核对正文各章节、检查项与关联 Issue 均正确。
7. 执行下文关联 Issue 的交付收尾，并核验远端结果。

开发收尾涉及 uni-app／mp-weixin 迁移，或改动微信端独有的组件、导航、生命周期、平台 API、触控/滚动、视口/安全区、资源渲染与失败回退时，按下方[微信开发者工具人工验收流程](#微信开发者工具人工验收按需)判断适用性，并人工提示用户可调用。纯 Web 且没有微信端适配影响的任务不需要提示。该流程是按需的人机协作验收，不作为每个 PR 的固定门槛；用户可以在会话中要求执行。若当次未执行，PR 与 Issue 收尾须记录“未执行/原因”和待验证范围，不把编译结果写成模拟器验收。

提交、推送、创建或更新 PR、合并和开启自动合并分别依据用户授权执行；已授权的动作直接完成，不重复请求确认。

## 关联 Issue 交付收尾

用户要求“提交并 PR”（含同义表达）时，默认授权对本任务关联 Issue 发布交付评论，并在满足以下完成条件时关闭，无需再询问。此授权仅覆盖本次交付收尾；新建 Issue、修改需求正文、标题、标签或依赖，以及合并 PR、开启自动合并仍遵循各自授权规则。

1. 读取关联 Issue 的完整范围、验收标准与评论，核对实际提交、PR 状态及当前提交对应的检查结果。依据 Issue 约定的交付范围判断完成，区分会话演示、真实服务和未验证目标端。无关联 Issue 时在 PR 中说明，不为收尾另行创建 Issue。
2. **已合并且范围与验收全部完成**：先发布完成评论，包含 PR 链接、实际交付内容、检查结果、未纳入范围的能力与迁移待验证项；随后按 `completed` 关闭 Issue。即使 PR 含 `Closes #…`，也须读取 Issue 实际状态；自动关闭未生效时执行关闭。
3. **PR 待合并、检查未通过或验收尚有剩余项**：发布进展评论，包含 PR 链接、已完成内容、实际检查结果、阻塞或剩余项及下一步，保持 Issue 开放。后续继续本任务、获知 PR 合并或恢复验收时，重新核对并按上述完成条件收尾。
4. 关联 Issue 已关闭且已有匹配本次交付的完整评论时，核验即可；缺少交付证据时补充评论。先读取既有评论，避免重复发布相同内容。
5. 评论和关闭后重新读取远端状态与评论，最终答复提供 Issue／评论链接及真实状态；有未完成项时明确说明。PR 创建或合并本身均不作为 Issue 已关闭的证据。

评论通过 `--body-file` 或结构化参数保留正文换行；验证截图、脚本及结果文件继续遵循本地产物边界。只处理当前任务关联 Issue，不批量关闭其他任务。

## 微信开发者工具人工验收（按需）

此流程用于 uni-app 微信小程序构建后检查微信运行时行为。它不替代 H5 检查，也不等同于真机、生产服务或发布验收。判断命中上方触发条件时，收尾人员先向用户提供明确提示，例如：“本次改动影响 mp-weixin 运行时；可以按[微信开发者工具人工验收流程](#微信开发者工具人工验收按需)打开并验证。是否现在执行？”用户要求执行时继续；用户未执行或当前环境不可用时，记录原因与剩余验证，不擅自声称通过。

1. **固定被测版本。** 确认当前任务 worktree、分支和待验收提交；在这个 worktree 编译 mp-weixin，使用对应输出目录打开项目。不能拿另一个 worktree 或旧构建目录代替。记录 commit、构建命令、成功结果及产物路径。

2. **准备 AppID 与构建产物。** 从仓库根目录运行 `pnpm --filter @hehuoda/uni build:mp-weixin`。AppID 的项目配置入口是 `apps/uni/.env` 里的 `UNI_MP_WEIXIN_APPID`；以 `apps/uni/.env.example` 为模板，仅在 `.env` 不存在时复制，不能覆盖已有本地设置。账号准备任务 #58 完成后填入对应小程序 AppID。当前 Windows 开发机留存的可复用配置在 `E:\HeHuoDa\apps\uni\.env.local`，其中同一变量也会被 Vite 读取；此路径是本机工作区备忘，其他开发机或清理 worktree 后不保证存在。需要查账号可管理的 ID 时，走官方 `get_user_appids --type miniprogram`，不要猜值。检查生成的 `apps/uni/src/manifest.json` 及构建产物 `apps/uni/dist/build/mp-weixin/project.config.json` 是否对应目标 AppID；生成文件和 `.env*` 均忽略且不得提交。构建未配置 ID 时会使用 DCloud `touristappid`，只能证明本地编译，不能用于 DevTools 账号运行验收。

3. **检查并调用开发者工具。** 当前 Windows 开发机已验证安装目录 `D:\微信web开发者工具`，官方技能 CLI 为 `D:\微信web开发者工具\wechatide.cmd`，桌面程序为 `D:\微信web开发者工具\微信开发者工具.exe`。这些是本机定位提示；工具移位时先用 `Get-Command wechatide`，再查官方 wechatide-skill 的安装目录与运行前检查，不要自行拼凑 CLI 参数。使用项目内已经安装的官方 wechatide-skill/连接工具，并按它当前 frontmatter `version` 传版本号。PowerShell 命令示例（在仓库根目录执行）：

   ```powershell
   $wechatide = 'D:\微信web开发者工具\wechatide.cmd'
   $skillVersion = '0.3.9' # 示例值；以本机 wechatide-skill/SKILL.md 的 version 为准
   $projectPath = (Resolve-Path 'apps/uni/dist/build/mp-weixin').Path

   & $wechatide -c Codex check_wechatide_status --skill-version $skillVersion
   & $wechatide -c Codex open_project_window --project $projectPath --window-mode liteMode
   ```

   `-c` 的 `Codex` 必须与官方授权客户端名称一致；改用 MCP/注册工具时使用同一客户端授权。首次状态检查须确认版本关系兼容、`loginExpired: false`，并处理 `tokenRequired` 门禁；若需令牌，不从项目配置或本机文件翻找，按官方授权流程停下并请用户处理。若登录过期，调用 `login --type window` 后由用户扫码，并依官方异步任务流程等到最终成功；不要把“二维码已显示”当作已登录。`open_project_window` 默认 `liteMode` 只开模拟器，需编辑器/调试器时用 `fullMode`。不要使用发布/上传命令代替打开验收。

4. **处理连接失败。** 只有官方命令不可用时才进入官方安装诊断；命令可用但端口连接失败时，在微信开发者工具“设置 → 安全设置”核对“服务端口”是否开启以及当前显示端口，不要假定固定端口。遇到授权弹窗、启用端口或扫码登录，由用户在开发者工具里完成。若工具仍持有旧端口，先请用户保存其他窗口工作，再正常退出并重新启动工具，然后重跑状态检查；不强杀进程、不绕过授权，也不读取或输出令牌/密钥。连接稳定后，确认项目窗口对应本次绝对构建路径。

5. **按改动执行真实交互。** 在已打开的模拟器内，先按 `apps/uni/src/pages.json` 找目标页，再从 automator scene 调用 `simulator_open_page`、`automation_element_action`（真实点击/输入/触摸）、`automation_page_action`（查询节点/页面状态）；需要刷新时调用 `simulator_refresh`。示例：

   ```powershell
   & $wechatide -c Codex simulator_open_page --project $projectPath --page 'pages/example/index'
   & $wechatide -c Codex automation_element_action --project $projectPath --selector '.submit-button' --action tap
   & $wechatide -c Codex simulator_screenshot --project $projectPath --path 'docs/screenshots/local-wechat.png'
   & $wechatide -c Codex get_simulator_console --project $projectPath --command 'grep -i error'
   ```

   示例页面和选择器要换成当前源码实际值；调用前用对应 scene 的官方 `--help` / `tools.yaml` 核对参数。`simulator_refresh` 成功仅表示触发刷新，不代表编译或行为通过；完整编译证据来自前面的 uni build。用真实界面操作完成状态变化，不直接篡改 page data。若需查询自定义组件内部控件，先取得自定义组件实例再查其内部节点；只点中宿主不能算点中了内部按钮。错误图片请求、资源错误事件注入和静态缺图回退分别记录。

6. **读取运行反馈并保存证据。** 检查页面状态、必要的截图及模拟器 console。按错误级别/关键词筛选为空时，只报告“该筛选无匹配项”，不要称日志完全为空。记录 DevTools 版本、基础库、模拟器机型、屏幕/窗口尺寸、worktree 与 commit、项目路径、实际操作和结果。截图、脚本、运行 JSON 留在 `.gitignore` 覆盖的本地验收目录，提交前确认没有进入 diff。发现缺陷先修复，再重新构建并重跑受影响场景。

7. **收尾时分层报告。** PR/Issue 记录构建命令和产物、AppID 来源变量（不复制值）、运行环境、页面/操作/结果、console 筛选条件、截图位置及未覆盖项；区分源码/构建、微信模拟器、真机与生产状态。模拟器通过仅证明本次工具和构建下行为；真机、系统版本、辅助技术、线上域名/服务等未实际验证时列为后续事项。人工完成的登录、扫码或工具设置要写明用户做了什么、随后如何复核。需要联网/写入的业务流程未被当前 Issue 授权时，不用模拟器验收扩大测试范围。

首次接触或工具行为变化时优先阅读已安装微信开发者工具的官方技能及配套自动化文档，使用其当前支持的命令和授权路径；不把某一台机器的可执行文件路径、端口、CLI 子命令或 SDK 版本写成全项目常量。截图、临时脚本、运行结果留在本地；可复用的源码测试及正式项目文档按常规提交边界处理。
