import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { readCatalog } from "../competitions/catalog.js";
import {
  BoundedFetcher,
  BudgetExhaustedError,
  defaultLimits,
  normalizeUrl,
  type HttpLimits,
  extractArticle,
  extractList,
  isCompetitionNotice,
  containsApplicantList,
  parseCandidate,
  sourceById,
  type ListItem,
  NoticeParseError,
  channelById,
} from "@hehuoda/sicau-connectors/notices";

import { noticeDirectory, platformCandidate } from "./connector-adapter.js";

import { initializeSources, persistArticle, transaction } from "./store.js";
import { channelFingerprint, readChannel } from "./channel-store.js";

export type ScanPhase = "fresh" | "backfill" | "revisit" | "retry";

export interface ScanOptions {
  requestId?: string;
  sourceId: string;
  from?: string;
  to?: string;
  url?: string;
  preview?: boolean;
  resume?: string;
  trigger?: "manual" | "scheduled" | "resume";
  channelId?: string;
  phase?: ScanPhase;
  taskId?: string;
  roundId?: string;
  rebuildTaskId?: string;
  /** 调度器内部工作片，只能收紧来源预算。 */
  workSliceRequests?: number;
  workSliceDurationMs?: number;
}
interface Cursor {
  pages: string[];
  pending: ListItem[];
  seen: string[];
}
interface Counts {
  discovered: number;
  new: number;
  changed: number;
  unchanged: number;
  ignored: number;
  failed: number;
}
export function dateRange(options: ScanOptions, now = new Date()) {
  const today = new Date(now.getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 10);
  const to = options.to ?? today;
  const from =
    options.from ??
    new Date(Date.parse(to) - 89 * 86400000).toISOString().slice(0, 10);
  for (const date of [from, to])
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      throw new Error("日期须为有效 YYYY-MM-DD");
  if (from > to || Date.parse(to) - Date.parse(from) > 365 * 86400000)
    throw new Error("日期范围须为 1–366 天");
  return { from, to };
}
const errorSummary = (error: unknown) =>
  error instanceof NoticeParseError ||
  (error instanceof Error && !("code" in error))
    ? error.message.slice(0, 500)
    : "数据库或网络错误；未输出连接信息";

export class IngestionRunner {
  constructor(
    private readonly pool: Pool,
    private readonly fetcherFactory = (
      source: ReturnType<typeof sourceById>,
      limits: HttpLimits,
    ) => new BoundedFetcher(source, limits),
    private readonly now = () => new Date(),
  ) {}
  async scan(
    input: ScanOptions,
    signal?: AbortSignal,
    roundContext?: { roundId: string },
  ) {
    // 调度权限来自调用上下文，持久化/HTTP续跑参数中的roundId不能授予锁绕过能力。
    input = { ...input, roundId: roundContext?.roundId };
    if (
      input.phase &&
      !["fresh", "backfill", "revisit", "retry"].includes(input.phase)
    )
      throw new Error("未知扫描阶段");
    // 续跑以原运行的栏目/阶段为准；调用方不能重写历史范围。
    if (input.resume) {
      const previous = (
        await this.pool.query(
          "SELECT options FROM ingestion_runs WHERE id=$1 AND source_id=$2",
          [input.resume, input.sourceId],
        )
      ).rows[0];
      if (previous)
        input = {
          ...input,
          channelId: previous.options.channelId,
          phase: previous.options.phase,
          taskId: previous.options.taskId,
        };
    }
    const registered = sourceById(input.sourceId);
    const channel = channelById(registered, input.channelId);
    const source = {
      ...registered,
      listUrl: channel.listUrl,
      version: channel.version,
    };
    const fingerprint = channelFingerprint(registered, channel);
    let range = dateRange(input, this.now());
    if (
      input.url &&
      !new RegExp(channel.noticePath).test(
        new URL(normalizeUrl(input.url, source)).pathname,
      )
    )
      throw new Error("通知路径不在所选栏目白名单");
    if (!input.preview) await initializeSources(this.pool);
    const lock = await this.pool.connect();
    let globalLocked = false,
      sourceLocked = false;
    let coordinatorLocked = false;
    let runId: string | null = null;
    let taskId: string | null = null;
    let fetcher: BoundedFetcher | undefined;
    let pages = 0;
    let sourceFailed = false;
    const isSourceFailure = (error: unknown) =>
      !(error instanceof BudgetExhaustedError) &&
      !(
        error instanceof Error &&
        "code" in error &&
        !(error instanceof NoticeParseError)
      ) &&
      !signal?.aborted &&
      !/(?:来源|栏目).*已停止/.test(errorSummary(error));
    const counts: Counts = {
      discovered: 0,
      new: 0,
      changed: 0,
      unchanged: 0,
      ignored: 0,
      failed: 0,
    };
    const errors: {
      url: string;
      message: string;
      kind?: "skipped" | "budget" | "diagnostic";
      code?: string;
    }[] = [];
    let cursor: Cursor = {
      pages: input.url ? [] : [source.listUrl],
      pending: input.url
        ? [
            {
              url: normalizeUrl(input.url, source),
              title: "单通知重跑",
              publishedAt: null,
            },
          ]
        : [],
      seen: [],
    };
    let options: ScanOptions & {
      from: string;
      to: string;
      scheduledPhase?: "fresh" | "resume";
    } = { ...input, ...range, channelId: channel.id };
    const previews: unknown[] = [];
    const checkpoint = async () => {
      if (runId)
        await transaction(this.pool, async (client) => {
          await client.query(
            "UPDATE ingestion_runs SET cursor=$2,counts=$3,errors=$4,budget_usage=$5 WHERE id=$1",
            [
              runId,
              JSON.stringify(cursor),
              JSON.stringify(counts),
              JSON.stringify(errors),
              JSON.stringify(fetcher ? { ...fetcher.usage, pages } : {}),
            ],
          );
          if (taskId)
            await client.query(
              "UPDATE ingestion_scan_tasks SET cursor=$2,updated_at=now() WHERE id=$1",
              [taskId, JSON.stringify(cursor)],
            );
        });
    };
    const finish = async (status: string) => {
      if (!runId) return;
      await transaction(this.pool, async (client) => {
        await client.query(
          "UPDATE ingestion_runs SET status=$2,finished_at=now(),cursor=$3,counts=$4,errors=$5,budget_usage=$6 WHERE id=$1",
          [
            runId,
            status,
            JSON.stringify(cursor),
            JSON.stringify(counts),
            JSON.stringify(errors),
            JSON.stringify(
              fetcher
                ? { ...fetcher.usage, pages }
                : { requests: 0, downloadedBytes: 0, elapsedMs: 0, pages },
            ),
          ],
        );
        if (taskId)
          await client.query(
            "UPDATE ingestion_scan_tasks SET cursor=$2,status=$3,updated_at=now() WHERE id=$1",
            [
              taskId,
              JSON.stringify(cursor),
              status === "succeeded"
                ? "succeeded"
                : status === "failed"
                  ? "failed"
                  : "partial",
            ],
          );
      });
    };
    try {
      if (!input.roundId) {
        coordinatorLocked = (
          await lock.query("SELECT pg_try_advisory_lock(23006) AS locked")
        ).rows[0].locked;
        if (!coordinatorLocked)
          return { status: "locked", source: source.id, channelId: channel.id };
      }
      sourceLocked = (
        await lock.query(
          "SELECT pg_try_advisory_lock(23001,hashtext($1)) AS locked",
          [source.id],
        )
      ).rows[0].locked;
      if (!sourceLocked) return { status: "locked", source: source.id };
      globalLocked = (
        await lock.query("SELECT pg_try_advisory_lock(23000) AS locked")
      ).rows[0].locked;
      if (!globalLocked) return { status: "locked", source: source.id };
      const config = (
        await lock.query("SELECT * FROM ingestion_sources WHERE id=$1", [
          source.id,
        ])
      ).rows[0];
      if (config && !config.enabled)
        return { status: "disabled", source: source.id };
      const channelConfig = await readChannel(lock, source.id, channel.id);
      if (
        !channelConfig &&
        !(
          registered.legacyDefaultEnabled &&
          channel.id === registered.defaultChannelId
        )
      )
        return { status: "disabled", source: source.id, channelId: channel.id };
      if (channelConfig && !channelConfig.enabled)
        return { status: "disabled", source: source.id, channelId: channel.id };
      if (
        channelConfig &&
        channelConfig.verification_status !== "verified" &&
        !(
          registered.legacyDefaultEnabled &&
          channel.id === registered.defaultChannelId &&
          channelConfig.verification_status === "pending"
        )
      )
        return { status: "disabled", source: source.id, channelId: channel.id };
      const settings = {
        ...defaultLimits,
        maxPages: 10,
        frequencyMinutes: 60,
        ...config?.settings,
        ...channelConfig?.settings,
        signal,
      };
      if (input.workSliceRequests !== undefined) {
        if (
          !Number.isInteger(input.workSliceRequests) ||
          input.workSliceRequests < 1
        )
          throw new Error("工作片预算无效");
        settings.requests = Math.min(
          settings.requests,
          input.workSliceRequests,
        );
        settings.maxPages = 1;
      }
      if (input.workSliceDurationMs !== undefined)
        settings.durationMs = Math.min(
          settings.durationMs,
          input.workSliceDurationMs,
        );
      if (
        !Number.isInteger(settings.maxPages) ||
        settings.maxPages < 1 ||
        settings.maxPages > 10
      )
        throw new Error("每次扫描页数须为 1–10");
      if (
        !Number.isInteger(settings.frequencyMinutes) ||
        settings.frequencyMinutes < 1 ||
        settings.frequencyMinutes > 1440
      )
        throw new Error("来源频率须为 1–1440 分钟");
      if (
        !input.phase &&
        input.trigger === "scheduled" &&
        config?.last_started_at &&
        Date.now() - new Date(config.last_started_at).getTime() <
          settings.frequencyMinutes * 60000
      )
        return { status: "not-due", source: source.id };
      fetcher = this.fetcherFactory(source, {
        ...settings,
        onUsage: async (usage) => {
          if (runId)
            await this.pool.query(
              "UPDATE ingestion_runs SET budget_usage=$2 WHERE id=$1",
              [runId, JSON.stringify({ ...usage, pages })],
            );
        },
        beforeRequest: async (url) => {
          if (
            url.pathname !== "/robots.txt" &&
            !new RegExp(channel.listPath).test(url.pathname) &&
            !new RegExp(channel.noticePath).test(url.pathname)
          )
            throw new Error("请求路径不在所选栏目白名单");
          if (
            (
              await lock.query(
                "SELECT enabled FROM ingestion_sources WHERE id=$1",
                [source.id],
              )
            ).rows[0]?.enabled === false ||
            (await readChannel(lock, source.id, channel.id))?.enabled === false
          )
            throw new Error("来源或栏目已停止");
        },
      });
      let resumeId = input.resume;
      let scheduledFresh = true;
      if (input.phase) {
        if (!input.preview)
          await lock.query(
            "UPDATE ingestion_scan_tasks t SET status='succeeded',cursor=r.cursor,updated_at=now() FROM ingestion_runs r WHERE t.leaf_run_id=r.id AND t.source_id=$1 AND t.channel_id=$2 AND r.status='succeeded' AND t.status NOT IN ('succeeded','superseded')",
            [source.id, channel.id],
          );
        if (input.rebuildTaskId && !input.preview) {
          const old = (
            await lock.query(
              "SELECT *,from_date::text AS from_date,to_date::text AS to_date FROM ingestion_scan_tasks WHERE id=$1 AND source_id=$2 AND channel_id=$3 AND phase=$4",
              [input.rebuildTaskId, source.id, channel.id, input.phase],
            )
          ).rows[0];
          if (!old) throw new Error("重建任务不存在或栏目不符");
          const rebuilt = (
            await lock.query(
              "SELECT id FROM ingestion_scan_tasks WHERE rebuild_of=$1",
              [old.id],
            )
          ).rows[0];
          if (rebuilt) input = { ...input, taskId: rebuilt.id };
          else
            await lock.query(
              "UPDATE ingestion_scan_tasks SET status='superseded',updated_at=now() WHERE id=$1",
              [old.id],
            );
          resumeId = undefined;
        }
        let task = input.taskId
          ? (
              await lock.query(
                "SELECT * FROM ingestion_scan_tasks WHERE id=$1 AND source_id=$2 AND channel_id=$3 AND phase=$4",
                [input.taskId, source.id, channel.id, input.phase],
              )
            ).rows[0]
          : undefined;
        if (!task && !input.rebuildTaskId && !input.preview) {
          task = (
            await lock.query(
              `SELECT t.*,t.from_date::text AS from_date,t.to_date::text AS to_date FROM ingestion_scan_tasks t WHERE t.source_id=$1 AND t.channel_id=$2 AND t.phase=$3 AND t.status NOT IN ('succeeded','superseded') AND ($3<>'fresh' OR $4::text IS NULL OR t.round_id=$4) ORDER BY t.created_at,t.id LIMIT 1`,
              [source.id, channel.id, input.phase, input.roundId ?? null],
            )
          ).rows[0];
        }
        if (
          input.taskId &&
          (!task || ["succeeded", "superseded"].includes(task.status))
        )
          throw new Error("任务不存在、已完成或已被重建");
        if (task && task.config_hash !== fingerprint)
          return {
            status: "failed",
            source: source.id,
            channelId: channel.id,
            taskId: task.id,
            counts,
            errors: [
              {
                url: channel.listUrl,
                code: "task-config-changed",
                message: "栏目配置已变化，必须显式重建任务；原范围与游标保留",
              },
            ],
            cursor: task.cursor,
          };
        if (task) {
          taskId = input.preview ? null : task.id;
          range = {
            from: String(task.from_date).slice(0, 10),
            to: String(task.to_date).slice(0, 10),
          };
          cursor = task.cursor;
          resumeId = task.leaf_run_id ?? undefined;
        } else {
          if (input.phase === "backfill") {
            const activated = channelConfig?.activated_on;
            const to = activated
              ? String(activated).slice(0, 10)
              : dateRange(input, this.now()).to;
            range = {
              from: new Date(Date.parse(to) - 365 * 86400000)
                .toISOString()
                .slice(0, 10),
              to,
            };
            if (
              (input.from && input.from !== range.from) ||
              (input.to && input.to !== range.to)
            )
              throw new Error(
                "backfill范围固定为启用日期前365天，请用旧手动扫描执行自定义范围",
              );
          }
          if (input.phase === "revisit" || input.phase === "retry") {
            cursor.pages = [];
            const known = await lock.query(
              `SELECT n.url,v.article FROM ingestion_notices n JOIN ingestion_notice_channels nc ON nc.notice_id=n.id AND nc.source_id=n.source_id JOIN ingestion_versions v ON v.id=n.latest_version WHERE n.source_id=$1 AND nc.channel_id=$2 AND ($3<>'retry' OR n.health='needs-check') ORDER BY n.fetched_at,n.id LIMIT 150`,
              [source.id, channel.id, input.phase],
            );
            cursor.pending = known.rows.map((row) => ({
              url: row.url,
              title: row.article.title,
              publishedAt: row.article.publishedAt,
            }));
            if (input.phase === "retry") {
              const failed = (
                await lock.query(
                  "SELECT r.cursor FROM ingestion_runs r WHERE r.source_id=$1 AND r.channel_id=$2 AND COALESCE((r.counts->>'failed')::int,0)>0 AND NOT EXISTS(SELECT 1 FROM ingestion_runs child WHERE child.options->>'resume'=r.id) ORDER BY r.started_at,r.id",
                  [source.id, channel.id],
                )
              ).rows;
              for (const row of failed)
                for (const item of (row.cursor.pending ?? []) as ListItem[]) {
                  try {
                    if (
                      new RegExp(channel.noticePath).test(
                        new URL(normalizeUrl(item.url, source)).pathname,
                      ) &&
                      !cursor.pending.some((p) => p.url === item.url)
                    )
                      cursor.pending.push(item);
                  } catch {
                    /* 旧错误记录也必须满足当前注册边界。 */
                  }
                }
            }
          }
          if (!input.preview) {
            taskId = randomUUID();
            await lock.query(
              "INSERT INTO ingestion_scan_tasks(id,source_id,channel_id,phase,from_date,to_date,config_hash,cursor,status,round_id,rebuild_of) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10)",
              [
                taskId,
                source.id,
                channel.id,
                input.phase,
                range.from,
                range.to,
                fingerprint,
                JSON.stringify(cursor),
                input.roundId ?? null,
                input.rebuildTaskId ?? null,
              ],
            );
          }
        }
        options = {
          ...options,
          ...range,
          taskId: taskId ?? undefined,
          channelId: channel.id,
        };
      }
      if (
        !input.phase &&
        !resumeId &&
        !input.url &&
        input.trigger === "scheduled"
      ) {
        const latest = (
          await lock.query(
            "SELECT options FROM ingestion_runs WHERE source_id=$1 AND channel_id=$2 AND (trigger='scheduled' OR (trigger='resume' AND options->>'scheduledPhase' IS NOT NULL)) ORDER BY started_at DESC,id DESC LIMIT 1",
            [source.id, channel.id],
          )
        ).rows[0];
        // 一轮新扫描、一轮恢复，避免小页数预算下首页永远挡住后续页。
        scheduledFresh =
          latest?.options.scheduledPhase === "resume" ||
          (!latest?.options.scheduledPhase && !!latest?.options.resume);
        if (!latest) scheduledFresh = true;
        resumeId = (
          await lock.query(
            "SELECT r.id FROM ingestion_runs r WHERE r.source_id=$1 AND r.channel_id=$2 AND (r.trigger='scheduled' OR (r.trigger='resume' AND r.options->>'scheduledPhase' IS NOT NULL)) AND r.status IN ('partial','interrupted','running','failed') AND r.options->>'url' IS NULL AND (jsonb_array_length(r.cursor->'pages')>0 OR jsonb_array_length(r.cursor->'pending')>0) AND NOT EXISTS (SELECT 1 FROM ingestion_runs child WHERE child.options->>'resume'=r.id::text) ORDER BY r.started_at,r.id LIMIT 1",
            [source.id, channel.id],
          )
        ).rows[0]?.id;
      }
      if (resumeId) {
        const previous = (
          await lock.query(
            "SELECT r.* FROM ingestion_runs r WHERE r.id=$1 AND r.source_id=$2 AND NOT EXISTS (SELECT 1 FROM ingestion_runs child WHERE child.options->>'resume'=r.id::text)",
            [resumeId, source.id],
          )
        ).rows[0];
        if (!previous || previous.status === "succeeded")
          throw new Error("续跑记录不存在、来源不符、已完成或已被续跑");
        if (
          previous.channel_id !== channel.id ||
          (previous.config_hash && previous.config_hash !== fingerprint)
        )
          throw new Error("栏目配置已变化或续跑栏目不符，必须重建任务");
        options = {
          ...previous.options,
          preview: input.preview,
          resume: resumeId,
          trigger: input.trigger === "scheduled" ? "scheduled" : "resume",
        };
        cursor = previous.cursor;
        if (!input.phase && input.trigger === "scheduled") {
          options.scheduledPhase = scheduledFresh ? "fresh" : "resume";
          if (scheduledFresh) {
            // 新扫描继承同一待处理链，不另造重复积压；日期窗口按本轮配置刷新。
            options = {
              ...input,
              ...range,
              resume: resumeId,
              scheduledPhase: "fresh",
            };
            cursor = {
              ...cursor,
              pages: [
                source.listUrl,
                ...cursor.pages.filter((page) => page !== source.listUrl),
              ],
              seen: cursor.seen.filter((page) => page !== source.listUrl),
            };
          }
        }
      } else if (!input.phase && !input.url) {
        const known = await lock.query(
          "SELECT n.url,v.article FROM ingestion_notices n JOIN ingestion_versions v ON v.id=n.latest_version WHERE n.source_id=$1 AND (v.article->>'publishedAt' IS NULL OR (v.article->>'publishedAt' >= $2 AND v.article->>'publishedAt' <= $3)) ORDER BY n.fetched_at,n.id LIMIT 150",
          [source.id, range.from, range.to],
        );
        cursor.pending = known.rows.map((row) => ({
          url: row.url,
          title: row.article.title,
          publishedAt: row.article.publishedAt,
        }));
        if (input.trigger === "scheduled") options.scheduledPhase = "fresh";
      }
      // A resumed HTTP execution belongs to its new request; CLI resumes have no HTTP owner.
      if (input.requestId) options.requestId = input.requestId;
      else delete options.requestId;
      if (input.roundId) options.roundId = input.roundId;
      else delete options.roundId;
      if (taskId) options.taskId = taskId;
      options.channelId = channel.id;
      delete options.workSliceRequests;
      delete options.workSliceDurationMs;
      delete options.rebuildTaskId;
      if (!input.preview) {
        await this.pool.query(
          "UPDATE ingestion_runs SET status='interrupted',finished_at=now() WHERE source_id=$1 AND status='running'",
          [source.id],
        );
        runId = randomUUID();
        await transaction(this.pool, async (client) => {
          await client.query(
            "INSERT INTO ingestion_runs(id,source_id,trigger,status,options,cursor,counts,channel_id,phase,config_hash,task_id,round_id) VALUES($1,$2,$3,'running',$4,$5,$6,$7,$8,$9,$10,$11)",
            [
              runId,
              source.id,
              options.trigger ?? "manual",
              JSON.stringify(options),
              JSON.stringify(cursor),
              JSON.stringify(counts),
              channel.id,
              options.phase ?? null,
              fingerprint,
              taskId,
              input.roundId ?? null,
            ],
          );
          if (taskId)
            await client.query(
              "UPDATE ingestion_scan_tasks SET leaf_run_id=$2,status='running',updated_at=now() WHERE id=$1",
              [taskId, runId],
            );
        });
        await this.pool.query(
          "UPDATE ingestion_sources SET last_started_at=now() WHERE id=$1",
          [source.id],
        );
      }
      const access = await fetcher.checkRobots();
      const checkStopped = async () => {
        if (signal?.aborted) throw new Error("采集已停止");
        if (
          (
            await lock.query(
              "SELECT enabled FROM ingestion_sources WHERE id=$1",
              [source.id],
            )
          ).rows[0]?.enabled === false
        )
          throw new Error("来源已停止");
        if ((await readChannel(lock, source.id, channel.id))?.enabled === false)
          throw new Error("栏目已停止");
      };
      let freshCount = 0;
      while (cursor.pages.length && pages < settings.maxPages) {
        if (
          pages > 0 &&
          fetcher.remainingRequests <= 1 &&
          cursor.pending.some(
            (item) =>
              isCompetitionNotice(item.title) &&
              !containsApplicantList(item.title),
          )
        )
          break;
        await checkStopped();
        const pageUrl = cursor.pages[0];
        if (cursor.seen.includes(pageUrl)) throw new Error("分页出现循环");
        const response = await fetcher.get(pageUrl);
        if (response.status !== 200)
          throw new Error("列表 HTTP " + response.status);
        if (!new RegExp(channel.listPath).test(new URL(response.url).pathname))
          throw new Error("列表重定向路径不在栏目白名单");
        const page = extractList(
          response.html,
          response.url,
          source,
          channel.id,
        );
        for (const item of page.items)
          if (!item.publishedAt)
            errors.push({
              url: item.url,
              kind: "diagnostic",
              code: "missing-list-date",
              message:
                "列表未提供可解析的完整发布日期；保留未知，不据此截断分页",
            });
        for (const skipped of page.skipped ?? []) {
          counts.ignored++;
          errors.push({
            url: pageUrl,
            message: `跳过列表条目 ${skipped.title.slice(0, 100)}：${skipped.reason}`,
            kind: "skipped",
          });
        }
        counts.discovered += page.items.length;
        const existing = new Set(
          (
            await lock.query(
              "SELECT url FROM ingestion_notices WHERE source_id=$1 AND url=ANY($2::text[])",
              [source.id, page.items.map((item) => item.url)],
            )
          ).rows.map((row) => row.url),
        );
        if (!input.preview && existing.size)
          await lock.query(
            "INSERT INTO ingestion_notice_channels(notice_id,source_id,channel_id) SELECT id,source_id,$3 FROM ingestion_notices WHERE source_id=$1 AND url=ANY($2::text[]) ON CONFLICT(notice_id,source_id,channel_id) DO UPDATE SET last_discovered_at=now()",
            [source.id, [...existing], channel.id],
          );
        const fresh: ListItem[] = [];
        for (const item of page.items)
          if (
            (!item.publishedAt ||
              (item.publishedAt >= options.from &&
                item.publishedAt <= options.to)) &&
            !cursor.pending.some((p) => p.url === item.url)
          )
            if (existing.has(item.url)) cursor.pending.push(item);
            else fresh.push(item);
        cursor.pending.splice(freshCount, 0, ...fresh);
        freshCount += fresh.length;
        cursor.seen.push(pageUrl);
        cursor.pages.shift();
        if (page.next && options.phase !== "fresh")
          cursor.pages.push(normalizeUrl(page.next, source));
        pages++;
        await checkpoint();
      }
      const catalog = await readCatalog(lock);
      const attempted = new Set<string>();
      while (cursor.pending.length) {
        const item = cursor.pending[0];
        if (attempted.has(item.url)) break;
        attempted.add(item.url);
        try {
          await checkStopped();
          if (
            !options.url &&
            options.phase !== "retry" &&
            ((item.publishedAt &&
              (item.publishedAt < options.from ||
                item.publishedAt > options.to)) ||
              !isCompetitionNotice(item.title) ||
              containsApplicantList(item.title))
          ) {
            counts.ignored++;
            cursor.pending.shift();
            await checkpoint();
            continue;
          }
          const known = (
            await lock.query(
              "SELECT n.*,v.adapter_version FROM ingestion_notices n LEFT JOIN ingestion_versions v ON v.id=n.latest_version WHERE n.source_id=$1 AND n.url=$2",
              [source.id, item.url],
            )
          ).rows[0];
          const headers: Record<string, string> = {};
          if (known?.adapter_version === source.version) {
            if (known.etag) headers["If-None-Match"] = known.etag;
            if (known.last_modified)
              headers["If-Modified-Since"] = known.last_modified;
          }
          const response = await fetcher.get(item.url, headers);
          if (
            !new RegExp(channel.noticePath).test(new URL(response.url).pathname)
          )
            throw new Error("通知重定向路径不在栏目白名单");
          if (response.status === 304 && known?.latest_version) {
            counts.unchanged++;
            if (!input.preview)
              await this.pool.query(
                "UPDATE ingestion_notices SET fetched_at=now(),health='available' WHERE id=$1",
                [known.id],
              );
            if (!input.preview)
              await lock.query(
                "INSERT INTO ingestion_notice_channels(notice_id,source_id,channel_id) VALUES($1,$2,$3) ON CONFLICT(notice_id,source_id,channel_id) DO UPDATE SET last_discovered_at=now()",
                [known.id, source.id, channel.id],
              );
          } else {
            if (response.status !== 200)
              throw new Error(
                "通知 HTTP " + response.status + "，保留原正式数据",
              );
            const article = extractArticle(
              response.html,
              response.url,
              source,
              channel.id,
            );
            if (!article.publishedAt)
              errors.push({
                url: item.url,
                kind: "diagnostic",
                code: "missing-article-date",
                message:
                  "正文未提供可解析的完整发布日期；保留未知，不计算小时级发现延迟",
              });
            if (containsApplicantList(article.title))
              throw new Error("通知涉及报名者名单，停止采集并保留正式数据");
            if (
              (!known && !isCompetitionNotice(article.title)) ||
              (!options.url &&
                options.phase !== "retry" &&
                article.publishedAt &&
                (article.publishedAt < options.from ||
                  article.publishedAt > options.to))
            )
              counts.ignored++;
            else {
              const parsed = platformCandidate(
                parseCandidate(
                  article,
                  item.url,
                  noticeDirectory(catalog.colleges),
                ),
              );
              if (input.preview)
                previews.push({ url: item.url, article, candidate: parsed });
              else {
                const result = await persistArticle(
                  this.pool,
                  source,
                  item.url,
                  response,
                  article,
                  parsed,
                  channel.id,
                );
                if (result.action === "new") counts.new++;
                else if (result.action === "changed") counts.changed++;
                else counts.unchanged++;
              }
            }
          }
          cursor.pending.shift();
          await checkpoint();
        } catch (error) {
          sourceFailed ||= isSourceFailure(error);
          if (!(error instanceof BudgetExhaustedError)) counts.failed++;
          errors.push({
            url: item.url,
            message: errorSummary(error),
            ...(error instanceof NoticeParseError ? { code: error.code } : {}),
            ...(error instanceof BudgetExhaustedError
              ? { kind: "budget" as const }
              : {}),
          });
          if (!input.preview && !(error instanceof BudgetExhaustedError))
            await this.pool.query(
              "UPDATE ingestion_notices SET health='needs-check' WHERE source_id=$1 AND url=$2",
              [source.id, item.url],
            );
          // 限流、拦截和预算终止来源，不继续请求其他通知。
          if (
            /停止|预算|时长|拒绝|验证码|登录|robots|危险|白名单|Retry-After|限流/.test(
              errorSummary(error),
            )
          )
            break;
          cursor.pending.push(cursor.pending.shift()!);
          await checkpoint();
        }
      }
      const status =
        signal?.aborted ||
        errors.some((e) => e.kind !== "skipped" && /停止/.test(e.message))
          ? "interrupted"
          : cursor.pending.length || cursor.pages.length
            ? "partial"
            : "succeeded";
      await finish(status);
      return {
        runId,
        channelId: channel.id,
        phase: options.phase ?? null,
        taskId,
        roundId: input.roundId ?? null,
        range: { from: options.from, to: options.to },
        budgetUsage: { ...fetcher.usage, pages },
        status,
        source: source.id,
        adapterVersion: source.version,
        access,
        counts,
        errors,
        cursor,
        previews,
      };
    } catch (error) {
      sourceFailed ||= isSourceFailure(error);
      errors.push({
        url: cursor.pages[0] ?? cursor.pending[0]?.url ?? source.listUrl,
        message: errorSummary(error),
        ...(error instanceof NoticeParseError ? { code: error.code } : {}),
        ...(error instanceof BudgetExhaustedError
          ? { kind: "budget" as const }
          : {}),
      });
      if (!(error instanceof BudgetExhaustedError)) counts.failed++;
      const status =
        signal?.aborted || /停止/.test(errorSummary(error))
          ? "interrupted"
          : error instanceof BudgetExhaustedError
            ? "partial"
            : "failed";
      await finish(status);
      return {
        runId,
        channelId: channel.id,
        phase: options.phase ?? null,
        taskId,
        roundId: input.roundId ?? null,
        range: { from: options.from, to: options.to },
        budgetUsage: fetcher
          ? { ...fetcher.usage, pages }
          : { requests: 0, downloadedBytes: 0, elapsedMs: 0, pages },
        status,
        source: source.id,
        counts,
        errors,
        cursor,
      };
    } finally {
      try {
        if (runId && fetcher) {
          await this.pool.query(
            "UPDATE ingestion_runs SET budget_usage=$2 WHERE id=$1",
            [runId, JSON.stringify({ ...fetcher.usage, pages })],
          );
          if (sourceFailed)
            await this.pool.query(
              "UPDATE ingestion_channels SET failure_count=failure_count+1,backoff_until=$3::timestamptz + make_interval(mins => LEAST(360,15*power(2,LEAST(failure_count,5)))::int),last_started_at=$3 WHERE source_id=$1 AND id=$2",
              [source.id, channel.id, this.now()],
            );
          else if (!signal?.aborted)
            await this.pool.query(
              "UPDATE ingestion_channels SET last_started_at=$3,last_successful_check=CASE WHEN $4 THEN $3 ELSE last_successful_check END,failure_count=CASE WHEN $5 THEN 0 ELSE failure_count END,backoff_until=CASE WHEN $5 THEN NULL ELSE backoff_until END WHERE source_id=$1 AND id=$2",
              [
                source.id,
                channel.id,
                this.now(),
                pages > 0 && !counts.failed,
                !counts.failed &&
                  (pages > 0 ||
                    (fetcher.usage.requests > 1 && !cursor.pending.length)),
              ],
            );
        }
        if (globalLocked) await lock.query("SELECT pg_advisory_unlock(23000)");
        if (sourceLocked)
          await lock.query("SELECT pg_advisory_unlock(23001,hashtext($1))", [
            source.id,
          ]);
        if (coordinatorLocked)
          await lock.query("SELECT pg_advisory_unlock(23006)");
      } finally {
        // 销毁持有会话锁的连接；即使连接异常导致显式解锁失败也不会回池。
        lock.release(true);
      }
    }
  }
}
