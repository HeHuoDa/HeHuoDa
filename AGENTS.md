# 禾伙搭项目约定

输出中文。

## Agent skills

### 技能限制与 Matt 工作流例外

本项目默认禁用 Superpowers 技能包中的工作流。**Matt 工作流是明确例外**：用户调用 `ask-matt` 或 Matt 工作流时，允许按其路由加载、调用并遵循相关技能及其直接依赖；该例外优先于下方禁用清单中重名的技能。使用其他技能时，遇到不属于 Matt 工作流的 Superpowers 依赖仍跳过该依赖。

例外覆盖 `ask-matt` 中定义或其流程直接调用的相关技能，例如 `grill-with-docs`、`grilling`、`domain-modeling`、`to-spec`、`to-tickets`、`implement`、`implement-spec`、`tdd`、`code-review`、`pr`、`retro`、`prototype`、`handoff`、`wayfinder`、`triage`、`research`、`codebase-design`、`wizard` 及流程明确要求的上下文工具。除该例外外，禁用范围包括所有 `superpowers:*` 技能，以及无此前缀的包内技能：`using-superpowers`、`brainstorming`、`writing-plans`、`executing-plans`、`dispatching-parallel-agents`、`subagent-driven-development`、`test-driven-development`、`systematic-debugging`、`using-git-worktrees`、`verification-before-completion`、`requesting-code-review`、`receiving-code-review`、`finishing-a-development-branch`、`writing-skills`。

按用户需求和本仓库约定直接开展工作，其他技能仍按任务需要使用。

### 任务分支与分步提交

- 每次开始新需求或独立任务（包括功能、修复、重构和文档更新），先检查当前分支、工作区改动及基线；在修改文件前创建并切换到该任务的新分支。默认基于最新 `main`，有明确任务依赖时基于对应依赖分支，并说明依赖关系。
- 一个任务使用一个分支，按用途命名为 `feat/<任务>`、`fix/<任务>`、`refactor/<任务>`、`docs/<任务>` 或 `chore/<任务>`；继续同一任务时复用其分支。开发与提交均在任务分支上进行。
- 创建或切换分支前妥善保留已有未提交改动，区分其所属任务；只提交当前任务的文件或改动块，避免混入其他任务的工作。
- 保持一个任务多次 commit 的习惯，按可独立审阅、可验证的阶段及时提交，例如核心实现、边界与测试、文档同步；通常控制在 2–6 次 commit。每次提交保持内容内聚，提交信息说明具体改动。
- 简单且不可合理拆分的任务可以只提交一次；按真实阶段拆分，避免为凑次数制造空提交或机械拆分。每个任务尽量不超过 6 次 commit；预计超出时优先收敛范围或拆成独立任务，确需超出则说明原因。整理历史时保留有意义的阶段，涉及已发布提交时遵循用户对改写历史的授权。

### Issue tracker

本仓库的问题与方案记录在 GitHub Issues。创建或更新 Issue 前，先向用户展示完整标题、正文、标签和依赖关系；用户明确确认该内容及发布后再执行。产品方向或交互方式的确认不等于发布确认。标题须标明管理端／用户端及前端／后端，具体格式与跨端任务规则参见 `docs/agents/issue-tracker.md`。

每次新建 Issue（包括子任务、技能拆票和分诊生成的任务），必须先读取并执行 [Issue 可开工标准](docs/agents/issue-tracker.md#issue-可开工标准)。正文须让未参与当前聊天的 Agent 仅凭 Issue、仓库及明确链接即可执行并验收；影响开工的缺口先核实或向用户澄清，再提交完整草稿审阅。

用户要求“提交并 PR”时，默认包含关联 Issue 的交付收尾评论与符合完成条件时的关闭，无需另行请求确认；按 [PR 交付收尾流程](docs/agents/pull-requests.md#关联-issue-交付收尾)核验、执行并报告真实状态。

### Triage labels

分诊、生成方案与拆分任务时，遵循 `docs/agents/triage-labels.md`。本项目停用 `ready-for-agent`，以后也不添加该标签；需求明确或技能建议使用该标签时仍遵循本项目约定。

### Domain docs

项目采用单一上下文：根目录 `CONTEXT.md` 与 `docs/adr/`。参见 `docs/agents/domain.md`。

### 用户端 H5 手机端优先

- 用户端的页面设计、实现与验收以 H5 手机端为优先目标，先保证手机竖屏下的布局、阅读和触控体验，再兼顾桌面端；管理端按其任务要求验证。
- 代码审查涉及用户端页面、组件或共享样式时，必须专项检查手机端样式及受影响页面，尤其关注固定宽高、最小宽度、横向溢出、长文本换行、图片缩放、按钮触控区域，以及依赖 hover 的交互。
- 弹窗、抽屉、表单与固定导航重点检查窄屏布局、滚动区域、层级、底部安全区，以及软键盘和浏览器地址栏变化造成的遮挡；主要操作应始终可见、可触达。
- 用户端界面变更至少在 320px、375px、390px、430px 宽度下检查布局，并验证长文本、空态、加载态和错误态等受影响状态。审查结论须记录实际检查的视口、页面与结果；区分静态代码检查、浏览器模拟和真机验证，未验证的部分明确说明，不能仅凭桌面截图或构建通过认定手机端样式正常。
- 手机端发现的样式或交互问题应作为审查问题列出，说明复现视口、受影响操作与具体代码位置；H5 验证与后续 uni-app／微信小程序适配分别记录，迁移要求见下节。

### uni-app 迁移提醒

项目完成后统一迁移到普通 uni-app，目标 H5、微信小程序。当前继续交付 Web；开发选型及实现时须持续识别、解释和提醒跨端影响，说明具体 API/组件/样式、两个目标端的限制与待验证事项、替代方案或适配工作，并在方案、Issue 或 PR 记录采用方案和迁移成本。重要待办集中维护于 [docs/agents/uni-app-migration.md](docs/agents/uni-app-migration.md)，按官方依据和实测判断，不以 Web 成功推断小程序兼容。uni-app／mp-weixin 迁移或平台特有交互进入开发收尾时，应按 [微信开发者工具人工验收流程](docs/agents/pull-requests.md#微信开发者工具人工验收按需)判断是否适用，并人工提示用户可调用；它是按需的模拟器验收，不代替真机检查。

### 开发产物提交边界

设计 Demo、截图、研究资料与原图、历史开发计划、Issue 验收文档、验收脚本和结果文件仅保留本地，不提交 Git；忽略入口为根目录 .gitignore。验证结论记录在 PR 正文。应用运行资源、源码测试及其最小固定快照、现行项目文档、ADR 与许可证应继续提交。禁止用全局图片扩展名规则忽略生产 Logo 和院徽。

### Pull Requests

创建或更新 PR 正文前，必须读取 `.github/PULL_REQUEST_TEMPLATE.md` 并按其结构填写；项目模板优先于技能、插件和工具的默认模板。具体发布与验证规则见 [docs/agents/pull-requests.md](docs/agents/pull-requests.md)。
