# 管理端采集控制页面（#43）

运行 `pnpm dev:admin`，访问 `/ingestion/sources`、`/ingestion/runs`、`/ingestion/runs/:id`。旧 `/sources`、`/runs` 重定向到对应页面。默认管理适配未开放，查询显示错误及重试；显式 `preview=1` 才读取独立页面样例，不把样例或“已受理”当作实际完成。

`apps/admin/src/console/ingestion-control.ts` 是页面模型。真实控制 HTTP 由 #39 提供、#46 接线，后续依据合并的生成类型实现服务，不假定当前已有管理 DTO。默认及示例的保存、扫描、续跑均抛出“服务未开放”，不修改固定样例、不创建采集记录、不执行 CLI 或浏览器抓取。

固定来源仅信息工程学院和生命科学学院，各一个现行 listUrl；不提供任意来源、URL 适配器或 cron 编辑。调度保持北京时间 09:00、18:00，frequency 仅为最小调度间隔。默认配置与边界依据服务端 `ingestion/http.ts` 的 defaultLimits 和 `store.ts` 的 configureSource：maxPages 10、frequencyMinutes 60、requests 80、intervalMs 2000、timeoutMs 15000、durationMs 600000、bytes 2097152。各字段限制、1–366 天范围及选定来源的 HTTPS 同源单通知 URL 在提交前校验；前端校验不代替服务端 DNS、重定向、robots、TLS 与 SSRF 防护。停用将在下一请求前停止，不提供杀进程。

来源启停、可执行状态、受理请求和采集运行四者分开。受理模型的 accepted/running/completed/failed 与运行 running/succeeded/partial/failed/interrupted 分开显示；手动查询受理状态并跳转关联运行，不通过等待时间推断完成。部分完成展示原范围、预算、计数、错误、游标摘要及续跑链，明确不代表全站遍历。续跑仅提交原运行 ID、理由和 operationId，不允许改写旧范围；执行中或已有后续运行不能重复续跑。

写适配的 IngestionControlError 只提供有限页面原因：disabled、running、locked、failed。未来适配器依据核实后的服务错误映射，不能把未经筛选的服务消息直接展示。前三种要求重新查询当前状态；普通 409 锁定本轮确认并保留输入，403、失败与不可用均不冒充成功。提交中禁止重复操作及离页，未保存配置/范围离页须确认。查询代次隔离旧来源、运行详情、列表及请求状态响应；已受理后不重复提交同一扫描/续跑，须查询结果后重新准备新请求。

该功能只交付管理端桌面 Web；浏览器检查目标为 1024px、1440px，验证加载/空/错、长文本、筛选分页、键盘焦点及表格/弹层滚动。格式、lint、typecheck、build 与源码测试按根脚本执行，实际结果记录 PR；临时脚本、截图、结果留本地。管理端 Element Plus、DOM、History 与服务端 Node 采集、锁和调度不迁入普通 uni-app H5/微信小程序。本次没有公开响应或学生端变更，微信开发者工具验收不适用，浏览器示例不代表真实服务或生产验收。
