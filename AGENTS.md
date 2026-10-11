# 禾伙人项目约定

输出中文。

## Agent skills

### 禁用 Superpowers

本项目禁用整个 Superpowers 技能包。处理本仓库任务时，不加载、调用或遵循该包的技能及其工作流；即使全局技能目录仍列出这些技能，也按本项目规则跳过。使用其他技能时，遇到对 Superpowers 的依赖也跳过该依赖。

禁用范围包括所有 `superpowers:*` 技能，以及无此前缀的包内技能：`using-superpowers`、`brainstorming`、`writing-plans`、`executing-plans`、`dispatching-parallel-agents`、`subagent-driven-development`、`test-driven-development`、`systematic-debugging`、`using-git-worktrees`、`verification-before-completion`、`requesting-code-review`、`receiving-code-review`、`finishing-a-development-branch`、`writing-skills`。

按用户需求和本仓库约定直接开展工作，其他技能仍按任务需要使用。

### Issue tracker

本仓库的问题与方案记录在 GitHub Issues。标题须标明管理端／用户端及前端／后端，具体格式与跨端任务规则参见 `docs/agents/issue-tracker.md`。

### Triage labels

分诊、生成方案与拆分任务时，使用默认五类状态标签；标签映射参见 `docs/agents/triage-labels.md`。

### Domain docs

项目采用单一上下文：根目录 `CONTEXT.md` 与 `docs/adr/`。参见 `docs/agents/domain.md`。

### uni-app 迁移提醒

项目完成后统一迁移到普通 uni-app，目标 H5、微信小程序。当前继续交付 Web；开发选型及实现时须持续识别、解释和提醒跨端影响，说明具体 API/组件/样式、两个目标端的限制与待验证事项、替代方案或适配工作，并在方案、Issue 或 PR 记录采用方案和迁移成本。重要待办集中维护于 [docs/agents/uni-app-migration.md](docs/agents/uni-app-migration.md)，按官方依据和实测判断，不以 Web 成功推断小程序兼容。

### 开发产物提交边界

设计 Demo、截图、研究资料与原图、历史开发计划、Issue 验收文档、验收脚本和结果文件仅保留本地，不提交 Git；忽略入口为根目录 .gitignore。验证结论记录在 PR 正文。应用运行资源、源码测试及其最小固定快照、现行项目文档、ADR 与许可证应继续提交。禁止用全局图片扩展名规则忽略生产 Logo 和院徽。

### Pull Requests

创建或更新 PR 正文前，必须读取 `.github/PULL_REQUEST_TEMPLATE.md` 并按其结构填写；项目模板优先于技能、插件和工具的默认模板。具体发布与验证规则见 [docs/agents/pull-requests.md](docs/agents/pull-requests.md)。
