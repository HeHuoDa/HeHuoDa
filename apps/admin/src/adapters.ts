import type { AdminHttp, Schema } from "./http";
import type { AdminServices } from "./services";
import {
  defaultSettings,
  runStates,
  type IngestionControlService,
  type IngestionRun,
  type AcceptedRequest,
} from "./console/ingestion-control";
import type { ReviewService, ReviewInput } from "./console/review";
import { ConsoleError, type PageQuery } from "./console/resource";
type Transport = Pick<AdminHttp, "request">;
const ingestion = "/ingestion";
const idPath = (kind: string, id: string) =>
  `${ingestion}/${kind}/${encodeURIComponent(id)}`;
function pageParams(query: PageQuery, status = true, datesOnly = false) {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (status && query.status) params.set("status", query.status);
  if (query.from)
    params.set("from", query.from + (datesOnly ? "" : "T00:00:00+08:00"));
  if (query.to)
    params.set("to", query.to + (datesOnly ? "" : "T23:59:59.999+08:00"));
  return params;
}
export function createAdminServices(http: AdminHttp): AdminServices {
  return {
    login: http.login,
    async getOverview() {
      const { modules } =
        await http.request<Schema["AdminDashboardDto"]>("/dashboard");
      const summary = {
        pending: null,
        drafts: null,
        published: null,
        sources: null,
      } as Awaited<ReturnType<AdminServices["getOverview"]>>;
      for (const item of modules)
        summary[item.module] = item.available ? item.count : null;
      return { ...summary, modules };
    },
  };
}
function mapRun(run: Schema["IngestionRunDto"]): IngestionRun {
  return {
    id: run.id,
    title: `${run.sourceId} · ${runStates[run.status]}`,
    status: run.status,
    date: run.startedAt,
    sourceId: run.sourceId,
    range: {
      from: run.options.from ?? "",
      to: run.options.to ?? "",
      url: run.options.url ?? "",
    },
    trigger: run.trigger,
    settings: {},
    counts: run.counts,
    errors: run.errors,
    cursor: {
      pages: run.cursor.pages.length,
      pending: run.cursor.pending.length,
      seen: run.cursor.seen.length,
    },
    previousRunId: run.options.resume ?? null,
    nextRunId: run.resumedBy[0] ?? null,
  };
}
function mapRequest(value: Schema["IngestionRequestDto"]): AcceptedRequest {
  return {
    requestId: value.requestId,
    state: value.status,
    ...(value.runId ? { runId: value.runId } : {}),
    message:
      value.status === "interrupted"
        ? "服务中断，请核对原运行。"
        : value.status === "failed"
          ? "执行失败，请核对运行错误。"
          : value.options?.preview
            ? "扫描预览：未写入采集业务数据。"
            : "受理状态不代表运行成功。",
    result: value.result,
  };
}
export function createControlService(http: Transport): IngestionControlService {
  return {
    async sources() {
      const rows = await http.request<Schema["IngestionSourceDto"][]>(
        `${ingestion}/sources`,
      );
      return rows.map((row) => ({
        id: row.id,
        title: row.publisher,
        status: row.enabled ? "enabled" : "disabled",
        date: row.latestRun?.startedAt ?? "",
        enabled: row.enabled,
        settings: { ...defaultSettings, ...row.settings },
        baseline: row.baseline,
        availability: !row.enabled
          ? "disabled"
          : row.latestRun?.status === "running"
            ? "running"
            : "idle",
        lastRunId: row.latestRun?.id,
      }));
    },
    async configure(id, config) {
      await http.request(idPath("sources", id), {
        method: "PATCH",
        body: config,
      });
    },
    async runs(query, sourceId) {
      const params = pageParams(query, true, true);
      if (sourceId) params.set("sourceId", sourceId);
      const result = await http.request<Schema["IngestionRunsDto"]>(
        `${ingestion}/runs?${params}`,
      );
      return { items: result.items.map(mapRun), total: result.total };
    },
    async run(id) {
      return mapRun(
        await http.request<Schema["IngestionRunDto"]>(idPath("runs", id)),
      );
    },
    async scan(input) {
      const { url, ...body } = input;
      const value = await http.request<Schema["IngestionAcceptedDto"]>(
        `${ingestion}/scans`,
        {
          method: "POST",
          body: {
            ...body,
            ...(url ? { url } : {}),
          } satisfies Schema["ScanDto"],
        },
      );
      return {
        state: value.status,
        requestId: value.requestId,
        message: "仅已受理，尚未完成。",
      };
    },
    async resume(id, body) {
      const value = await http.request<Schema["IngestionAcceptedDto"]>(
        idPath("runs", id) + "/resume",
        { method: "POST", body },
      );
      return {
        state: value.status,
        requestId: value.requestId,
        message: "仅已受理原范围续跑。",
      };
    },
    async request(id) {
      return mapRequest(
        await http.request<Schema["IngestionRequestDto"]>(
          idPath("requests", id),
        ),
      );
    },
  };
}
function reviewInput(file: Schema["AdminReviewFileDto"]): ReviewInput {
  return {
    ...file,
    batch: { ...file.batch, competitions: file.batch.competitions ?? [] },
  };
}
export function createReviewService(http: Transport): ReviewService {
  return {
    async list(kind, query) {
      if (kind !== "candidates")
        throw new ConsoleError(400, "请使用通知追溯入口");
      const result = await http.request<Schema["AdminCandidateListDto"]>(
        `${ingestion}/candidates?${pageParams(query)}`,
      );
      return {
        total: result.total,
        items: result.items.map((row) => ({
          id: row.candidateId,
          title: row.article.title,
          status: row.status,
          date: row.fetchedAt,
        })),
      };
    },
    async detail(kind, id, version, targetId) {
      if (kind !== "candidates")
        throw new ConsoleError(400, "请使用通知追溯入口");
      const base = idPath(kind, id);
      const detail =
        await http.request<Schema["AdminCandidateDetailDto"]>(base);
      const file = await http.request<Schema["AdminReviewFileDto"]>(
        base +
          "/review" +
          (targetId ? "?targetId=" + encodeURIComponent(targetId) : ""),
      );
      const notice = await http.request<Schema["AdminNoticeDetailDto"]>(
        idPath("notices", detail.noticeId),
      );
      if (version && version !== file.sourceVersion)
        throw new ConsoleError(409, "历史正文只读，请从通知追溯入口查看。");
      return {
        id,
        title: file.article.title,
        status: detail.status,
        date: detail.updatedAt,
        versions: [file.sourceVersion],
        latestVersion: notice.latestVersion?.id ?? "",
        material: reviewInput(file),
        stateBaseline: detail.baseline,
        requiresReapproval: detail.requiresReview,
      };
    },
    async preview(material, action) {
      const body = {
        operationId: crypto.randomUUID(),
        reason: action === "import" ? "核对导入预览" : "核对独立发布预览",
      };
      const result = await http.request<
        Schema["AdminReviewImportPreviewResultDto"]
      >(idPath("candidates", material.candidateId) + `/${action}-preview`, {
        method: "POST",
        body:
          action === "import"
            ? { ...body, review: material }
            : {
                ...body,
                sourceVersion: material.sourceVersion,
                candidateRevision: material.candidateRevision,
                baseline: material.baseline,
              },
      });
      return { contentKey: JSON.stringify(material), token: result.previewId };
    },
    async change(action, material, reason, operationId, receipt, options) {
      const base = idPath("candidates", material.candidateId);
      const body = { operationId, reason };
      const snapshot = {
        sourceVersion: material.sourceVersion,
        candidateRevision: material.candidateRevision,
        baseline: material.baseline,
      };
      if (
        (action === "import" || action === "publish") &&
        (!receipt?.token || receipt.contentKey !== JSON.stringify(material))
      )
        throw new ConsoleError(409, "请重新预览");
      if (action === "reject" || action === "reopen") {
        if (!options?.stateBaseline)
          throw new ConsoleError(409, "请重新载入候选基线");
        await http.request(base + "/" + action, {
          method: "POST",
          body: {
            ...body,
            ...snapshot,
            baseline: options.stateBaseline,
          } satisfies Schema["AdminReviewStateCommandDto"],
        });
      } else if (action === "publish") {
        await http.request(base + "/publish", {
          method: "POST",
          body: {
            ...body,
            ...snapshot,
            previewId: receipt!.token,
            confirm: true,
          } satisfies Schema["AdminReviewPublishCommandDto"],
        });
      } else if (action === "import") {
        await http.request(base + "/import", {
          method: "POST",
          body: {
            ...body,
            review: material,
            previewId: receipt!.token,
            confirmPublished: options?.confirmPublished ?? false,
          },
        });
      } else
        await http.request(
          base + (action === "save" ? "/review" : "/approve"),
          {
            method: action === "save" ? "PUT" : "POST",
            body: { ...body, review: material },
          },
        );
    },
  };
}
