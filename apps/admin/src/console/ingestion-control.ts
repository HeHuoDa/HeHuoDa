import type { InjectionKey } from "vue";
import { ServiceUnavailable } from "../services";
import { validDate } from "./review";
import { type PageQuery, type PageResult } from "./resource";
import type { Schema } from "../http";
// 页面模型：待 #39 合并后用生成契约接线，不在浏览器加载 Node 采集器。
export const fixedSources = [
  {
    id: "information-engineering",
    publisher: "信息工程学院",
    listUrl: "https://xxgc.sicau.edu.cn/xygl/tz.htm",
  },
  {
    id: "life-sciences",
    publisher: "生命科学学院",
    listUrl: "https://smkx.sicau.edu.cn/xwjtz/tzgg.htm",
  },
] as const;
// 依据 apps/api/src/ingestion/http.ts defaultLimits 与 store.ts configureSource。
export const defaultSettings = {
  maxPages: 10,
  frequencyMinutes: 60,
  requests: 80,
  intervalMs: 2000,
  timeoutMs: 15000,
  durationMs: 600000,
  bytes: 2097152,
};
export type SourceSettings = typeof defaultSettings;
export const settingFields: {
  key: keyof SourceSettings;
  label: string;
  min: number;
  max: number;
}[] = [
  { key: "maxPages", label: "最大页数", min: 1, max: 10 },
  { key: "frequencyMinutes", label: "最小调度间隔（分钟）", min: 1, max: 1440 },
  { key: "requests", label: "请求预算", min: 1, max: 200 },
  { key: "intervalMs", label: "请求间隔（毫秒）", min: 2000, max: 60000 },
  { key: "timeoutMs", label: "请求超时（毫秒）", min: 1000, max: 30000 },
  { key: "durationMs", label: "总时长（毫秒）", min: 1000, max: 900000 },
  { key: "bytes", label: "响应大小上限（字节）", min: 1024, max: 5242880 },
];
export function validateSettings(settings: SourceSettings): string | null {
  for (const field of settingFields)
    if (
      !Number.isInteger(settings[field.key]) ||
      settings[field.key] < field.min ||
      settings[field.key] > field.max
    )
      return `${field.label}须为 ${field.min}–${field.max} 的整数。`;
  return null;
}
export interface ScanInput {
  sourceId: string;
  channelId?: string;
  phase?: "fresh" | "backfill" | "revisit" | "retry";
  from: string;
  to: string;
  url: string;
  preview: boolean;
}
export function validateScan(
  input: ScanInput,
  sources: readonly { id: string; listUrl: string }[] = [],
): string | null {
  const source = sources.find((v) => v.id === input.sourceId);
  if (!source) return "请选择已实现的固定来源。";
  if (
    input.phase !== "backfill" &&
    (!validDate(input.from) ||
      !validDate(input.to) ||
      input.from > input.to ||
      Date.parse(input.to) - Date.parse(input.from) > 365 * 86400000)
  )
    return "日期范围须为有效的 1–366 天（含起止日期）。";
  if (input.url) {
    try {
      const url = new URL(input.url);
      if (
        url.protocol !== "https:" ||
        url.origin !== new URL(source.listUrl).origin ||
        url.username ||
        url.password
      )
        return "单通知 URL 须为所选来源 HTTPS 同源地址，不能包含凭据。";
    } catch {
      return "单通知 URL 无效，须填写 HTTPS 同源地址。";
    }
  }
  return null;
}
export interface SourceConfig {
  id: string;
  listUrl?: string;
  collegeId?: string;
  channels?: Schema["IngestionChannelStateDto"][];
  title: string;
  status: string;
  date: string;
  enabled: boolean;
  settings: SourceSettings;
  baseline: string;
  availability: "idle" | "running" | "locked" | "disabled" | "failed";
  lastRunId?: string;
}
export type RunStatus =
  "running" | "succeeded" | "partial" | "failed" | "interrupted";
export const runStates: Record<RunStatus, string> = {
  running: "执行中",
  succeeded: "本次范围处理完成",
  partial: "部分完成，尚有待处理",
  failed: "失败",
  interrupted: "已中断，可核对续跑",
};
export const availabilityLabels = {
  idle: "可请求执行",
  running: "执行中，请查看运行",
  locked: "被锁占用，请稍后重新查询",
  disabled: "来源已停用",
  failed: "最近请求失败，可核对后重试",
};
export interface IngestionRun {
  channelId?: string;
  phase?: string | null;
  taskId?: string | null;
  budgetUsage?: Record<string, unknown> | null;
  id: string;
  title: string;
  status: RunStatus;
  date: string;
  sourceId: string;
  range: { from: string; to: string; url: string };
  trigger: "manual" | "scheduled" | "resume";
  settings: Partial<SourceSettings>;
  counts: {
    discovered: number;
    new: number;
    changed: number;
    unchanged: number;
    ignored: number;
    failed: number;
  };
  errors: { message: string; url: string; kind?: string }[];
  cursor: { pages: number; pending: number; seen: number };
  previousRunId: string | null;
  nextRunId: string | null;
}
export interface AcceptedRequest {
  channelId?: string | null;
  phase?: string | null;
  taskProgress?: Record<string, unknown> | null;
  budgetUsage?: Record<string, unknown> | null;
  state: "accepted" | "running" | "completed" | "failed" | "interrupted";
  requestId: string;
  runId?: string;
  message: string;
  result?: unknown;
  error?: string | null;
  errorCode?: string | null;
}
export interface IngestionControlService {
  attachment(
    id: string,
    operation: "recheck" | "reparse",
    body: Schema["AttachmentCommandDto"] & { versionId?: string },
  ): Promise<AcceptedRequest>;
  sources(): Promise<SourceConfig[]>;
  configure(
    id: string,
    config: {
      enabled: boolean;
      settings: SourceSettings;
      baseline: string;
      reason: string;
      operationId: string;
    },
  ): Promise<void>;
  runs(query: PageQuery, sourceId: string): Promise<PageResult<IngestionRun>>;
  run(id: string): Promise<IngestionRun>;
  scan(
    input: ScanInput & { reason: string; operationId: string },
  ): Promise<AcceptedRequest>;
  resume(
    id: string,
    input: { reason: string; operationId: string },
  ): Promise<AcceptedRequest>;
  retry(
    id: string,
    input: { reason: string; operationId: string },
  ): Promise<AcceptedRequest>;
  request(id: string): Promise<AcceptedRequest>;
  recover?(operationId: string): Promise<AcceptedRequest>;
  pendingOperation?(): string | null;
  recoverPending?(): Promise<AcceptedRequest>;
}
export const ingestionControlKey: InjectionKey<IngestionControlService> =
  Symbol("ingestion-control");
// 由未来 HTTP 适配器映射已核实的服务端原因，不预设 #39 的响应字段。
export class IngestionControlError extends Error {
  constructor(public reason: "disabled" | "running" | "locked" | "failed") {
    super(
      {
        disabled:
          "来源已停用，将在下一次请求前停止；未受理续跑，请重新查询来源。",
        running: "该运行或来源正在执行中，未重复受理，请查看当前运行。",
        locked: "采集锁占用，未受理请求，请稍后重新查询并确认。",
        failed: "执行失败，请查询请求及运行错误，核对后再重试。",
      }[reason],
    );
  }
}
const unavailable = async (): Promise<never> => {
  throw new ServiceUnavailable(
    "采集管理服务未开放，未保存配置、扫描或续跑；浏览器不会抓取官网或执行 CLI。",
  );
};
export const unavailableControl: IngestionControlService = {
  attachment: unavailable,
  sources: unavailable,
  configure: unavailable,
  runs: unavailable,
  run: unavailable,
  scan: unavailable,
  resume: unavailable,
  retry: unavailable,
  request: unavailable,
};
export function canResume(run: IngestionRun) {
  return (
    ["partial", "failed", "interrupted"].includes(run.status) &&
    !run.nextRunId &&
    (run.cursor.pages > 0 || run.cursor.pending > 0)
  );
}
