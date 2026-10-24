# ADR-0007：以 SSH 归档直传分发生产应用镜像

- 状态：采纳；代码与工作流已实现，服务器演练、激活与生产切换待验收，见 [Issue #143](https://github.com/HeHuoDa/HeHuoDa/issues/143)
- 日期：2026-10-24

## 背景

主分支 CI 对 TCR 的 API 镜像连续三次推送超时，远端 manifest 检查未发现目标镜像。既有重试和诊断改善了失败边界，但没有解除镜像仓库分发阻塞。只根据重复等待的 layer ID 不能判定 TCR 服务端根因。

项目已具备实际 API 与 uni H5 镜像冒烟，并有 SSH 配置传输、数据库备份、迁移、健康检查和应用失败恢复。服务器拉取 GHCR/TCR 的网络路径不再作为新版本应用镜像的必经条件。

## 决策

主分支 CI 把冒烟通过的同一份 API/Web 镜像保存为带版本化清单的归档 artifact。Deploy 核验仓库、完整 SHA、CI run/attempt、artifact 状态、文件摘要、平台和 image ID 后，通过严格主机指纹校验的 SSH 传输到服务器。服务器验证并导入本地 Docker，再沿用现有 Compose、数据库备份/迁移、健康检查及应用回滚机制。

GitHub artifact 保留 7 天，服务器保留最近三个成功版本。手动默认动作是 `prepare`：只传输、验证和导入，不替换服务、不推进成功历史。首次服务器演练通过后，维护者开启 `DEPLOY_ARCHIVE_ACTIVATE` 并显式部署同一归档。`DEPLOY_ENABLED` 继续控制自动部署，不因本决策改变其当前设置。新 CI 不再向 GHCR/TCR 上传应用镜像，同时保留已有镜像和旧 digest 清单的兼容恢复能力。

回滚必须使用准确 SHA；服务器上的成功历史可在 GitHub artifact 过期后提供受验证的本地镜像和配置。不能将目录存在视为成功发布。仅在成功并通过健康检查后更新状态与清理超出保留范围的登记资源；不执行全局 Docker prune。应用回滚不自动降级数据库。新受信 main 控制器与目标 SHA 的历史 Compose/清单分开使用，防止旧版本控制器无法读取新状态。

## 后果与验收

该决策移除了服务器下载 API/Web 镜像的仓库链路，但会增加 runner 到服务器的 SSH 传输时间和服务器镜像导入所需空间。SSH 链路仍可能失败；有限重试和远端摘要校验可以安全复用完整文件，不能保证网络永不故障。单实例替换可能短暂中断，数据库迁移兼容性仍影响应用回滚。

计划参数是每次传输最多 10 分钟、最多 2 次、间隔 10 秒；Deploy 总上限 45 分钟，日志进度每 30 秒报告。交付报告分别记录代码测试、完整 CI、服务器 `prepare` 演练、首次部署和必要的回滚证据。CI 通过或 PR 合并不能证明服务器演练和生产上线已完成。

## 实施记录

- CI：`image-smoke` 以 `hehuoda-local` 前缀构建并冒烟，用 `deploy/archive.mjs` 生成 `images.tar.gz` 与 `release.json`，上传 `release-archive-<sha>-<attempt>`（7 天）。`publish-images` 作业、`packages: write` 与 TCR 镜像步骤已删除，`ci-gate` 只要求 `quality` 与 `image-smoke` 成功。
- Deploy：控制器固定从 `main` 检出，目标 SHA 只提供 Compose、Nginx 与清单；下载归档后先用 `deploy/archive.mjs verify` 复核仓库、run、attempt、摘要与平台，再打包传输。单次传输 10 分钟上限、最多 2 次、间隔 10 秒，远端已存在相同摘要时直接复用。
- 动作：`workflow_dispatch` 新增 `action`（`prepare`/`deploy`/`rollback`，默认 `prepare`）。自动 `workflow_run` 在 `DEPLOY_ARCHIVE_ACTIVATE` 关闭时整体跳过；`rollback` 只传输控制器，不依赖未过期的 artifact。
- 未完成：服务器 `prepare` 演练、`DEPLOY_ARCHIVE_ACTIVATE` 激活、首次正式部署与回滚证据。GitHub artifact 过期后的服务器本地回滚只有单元测试覆盖。
