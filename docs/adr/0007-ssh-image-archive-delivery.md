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

计划参数是每次传输最多 10 分钟、最多 2 次、间隔 10 秒；Deploy 总上限 45 分钟，日志按连接、探针、传输校验和交付阶段报告。交付报告分别记录代码测试、完整 CI、服务器 `prepare` 演练、首次部署和必要的回滚证据。CI 通过或 PR 合并不能证明服务器演练和生产上线已完成。

## 实施记录

- CI：`image-smoke` 以 `hehuoda-local` 前缀构建并冒烟，用 `deploy/archive.mjs` 生成 `images.tar.gz` 与 `release.json`，上传 `release-archive-<sha>-<attempt>`（7 天）。`publish-images` 作业、`packages: write` 与 TCR 镜像步骤已删除，`ci-gate` 只要求 `quality` 与 `image-smoke` 成功。
- Deploy：控制器固定从 `main` 检出，目标 SHA 只提供 Compose、Nginx 与清单；下载归档后先用 `deploy/archive.mjs verify` 复核仓库、run、attempt、摘要与平台，再打包传输。单次传输 10 分钟上限、最多 2 次、间隔 10 秒，远端已存在相同摘要时直接复用。
- 动作：`workflow_dispatch` 新增 `action`（`prepare`/`deploy`/`rollback`，默认 `prepare`）。自动 `workflow_run` 在 `DEPLOY_ARCHIVE_ACTIVATE` 关闭时整体跳过；`rollback` 只传输控制器，不依赖未过期的 artifact。
- 验证边界：服务器 `prepare` 演练、`DEPLOY_ARCHIVE_ACTIVATE` 激活、首次正式部署与生产回滚仍待验收。新增 CI 以真实 loopback SSH 验证故障传输，并以真实 Docker 和独立数据库验证归档准备、更新失败恢复、归档文件不可用后的本地回滚及三版保留；隔离结果不代替生产证据。
- 首次真实演练：[prepare #40096153574](https://github.com/HeHuoDa/HeHuoDa/actions/runs/40096153574) 的约 129 MB payload 首次 SSH 传输约 609 秒后超时，第二次尝试期间人工取消，未进入导入或应用更新，激活保持关闭。具体网络或接收端根因尚未定位；后续补充小包测速、接收字节进度、完整 payload 校验和取消清理，不据此延长既定传输预算。

## SCP Action 传输调整（2026-10-25）

- 最新 prepare #40102263453 的 SSH 基础检查成功，但 1 MiB 标准输入探针 60 秒未成功完成，未开始镜像导入或应用替换；具体链路根因仍未定位。
- 使用与 iot-pillot 相同的 appleboy/scp-action v0.1.7，固定提交 917f8b81dfc1ccd331fef9e2d61bdc6c8be94634。保留现有密码或密钥认证，主机指纹从已信任的目标 known_hosts 条目生成，不自动扫描增加信任。
- 探针和归档都使用 SCP；移除旧标准输入测速、吞吐估算门禁和自定义传输心跳。探针限时 2 分钟；归档每次步骤限时 10 分钟、最多两次，30 秒连接超时，重试前检查完整远端文件，完整且摘要一致时复用。
- 私有暂存目录按运行与 attempt 隔离。Action 只解开传输外包，应用 payload 在完整长度及 SHA-256 校验通过后才解包并交给原有控制器。失败和取消时尝试清理暂存；已验证版本、备份和成功历史不在清理范围。
- CI 改用该 Action 的实际 drone-scp 镜像做隔离 SSH 验证。两仓库目标服务器不同，隔离验证或对照仓库成功均不能代替生产 prepare；激活、首次正式部署及生产回滚仍待真实验收。
