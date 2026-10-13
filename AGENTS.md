# 禾伙人项目约定

输出中文。

## Agent skills

### 禁用 Superpowers

本项目禁用整个 Superpowers 技能包。处理本仓库任务时，不加载、调用或遵循该包的技能及其工作流；即使全局技能目录仍列出这些技能，也按本项目规则跳过。使用其他技能时，遇到对 Superpowers 的依赖也跳过该依赖。

禁用范围包括所有 `superpowers:*` 技能，以及无此前缀的包内技能：`using-superpowers`、`brainstorming`、`writing-plans`、`executing-plans`、`dispatching-parallel-agents`、`subagent-driven-development`、`test-driven-development`、`systematic-debugging`、`using-git-worktrees`、`verification-before-completion`、`requesting-code-review`、`receiving-code-review`、`finishing-a-development-branch`、`writing-skills`。

按用户需求和本仓库约定直接开展工作，其他技能仍按任务需要使用。

### 任务分支与分步提交

- 每次开始新需求或独立任务（包括功能、修复、重构和文档更新），先检查当前分支、工作区改动及基线；在修改文件前创建并切换到该任务的新分支。默认基于最新 `main`，有明确任务依赖时基于对应依赖分支，并说明依赖关系。
- 一个任务使用一个分支，按用途命名为 `feat/<任务>`、`fix/<任务>`、`refactor/<任务>`、`docs/<任务>` 或 `chore/<任务>`；继续同一任务时复用其分支。开发与提交均在任务分支上进行。
- 创建或切换分支前妥善保留已有未提交改动，区分其所属任务；只提交当前任务的文件或改动块，避免混入其他任务的工作。
- 保持一个任务多次 commit 的习惯，按可独立审阅、可验证的阶段及时提交，例如核心实现、边界与测试、文档同步；通常控制在 2–6 次 commit。每次提交保持内容内聚，提交信息说明具体改动。
- 简单且不可合理拆分的任务可以只提交一次；按真实阶段拆分，避免为凑次数制造空提交或机械拆分。每个任务尽量不超过 6 次 commit；预计超出时优先收敛范围或拆成独立任务，确需超出则说明原因。整理历史时保留有意义的阶段，涉及已发布提交时遵循用户对改写历史的授权。

### Issue tracker

本仓库的问题与方案记录在 GitHub Issues。创建或更新 Issue 前，先向用户展示完整标题、正文、标签和依赖关系；用户明确确认该内容及发布后再执行。产品方向或交互方式的确认不等于发布确认。标题须标明管理端／用户端及前端／后端，具体格式与跨端任务规则参见 `docs/agents/issue-tracker.md`。

用户要求“提交并 PR”时，默认包含关联 Issue 的交付收尾评论与符合完成条件时的关闭，无需另行请求确认；按 [PR 交付收尾流程](docs/agents/pull-requests.md#关联-issue-交付收尾)核验、执行并报告真实状态。

### Triage labels

分诊、生成方案与拆分任务时，遵循 `docs/agents/triage-labels.md`。本项目停用 `ready-for-agent`，以后也不添加该标签；需求明确或技能建议使用该标签时仍遵循本项目约定。

### Domain docs

项目采用单一上下文：根目录 `CONTEXT.md` 与 `docs/adr/`。参见 `docs/agents/domain.md`。

### uni-app 迁移提醒

项目完成后统一迁移到普通 uni-app，目标 H5、微信小程序。当前继续交付 Web；开发选型及实现时须持续识别、解释和提醒跨端影响，说明具体 API/组件/样式、两个目标端的限制与待验证事项、替代方案或适配工作，并在方案、Issue 或 PR 记录采用方案和迁移成本。重要待办集中维护于 [docs/agents/uni-app-migration.md](docs/agents/uni-app-migration.md)，按官方依据和实测判断，不以 Web 成功推断小程序兼容。

### 开发产物提交边界

设计 Demo、截图、研究资料与原图、历史开发计划、Issue 验收文档、验收脚本和结果文件仅保留本地，不提交 Git；忽略入口为根目录 .gitignore。验证结论记录在 PR 正文。应用运行资源、源码测试及其最小固定快照、现行项目文档、ADR 与许可证应继续提交。禁止用全局图片扩展名规则忽略生产 Logo 和院徽。

### Pull Requests

创建或更新 PR 正文前，必须读取 `.github/PULL_REQUEST_TEMPLATE.md` 并按其结构填写；项目模板优先于技能、插件和工具的默认模板。具体发布与验证规则见 [docs/agents/pull-requests.md](docs/agents/pull-requests.md)。
