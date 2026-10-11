import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { readCatalog } from "../competitions/catalog.js";
import {
  BoundedFetcher,
  defaultLimits,
  normalizeUrl,
  type HttpLimits,
} from "./http.js";
import {
  extractArticle,
  extractList,
  isCompetitionNotice,
  containsApplicantList,
} from "./html.js";
import { parseCandidate } from "./parse.js";
import { sourceById } from "./sources.js";
import { initializeSources, persistArticle } from "./store.js";
import type { ListItem } from "./types.js";

export interface ScanOptions {
  sourceId: string;
  from?: string;
  to?: string;
  url?: string;
  preview?: boolean;
  resume?: string;
  trigger?: "manual" | "scheduled" | "resume";
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
  error instanceof Error && !("code" in error)
    ? error.message.slice(0, 500)
    : "数据库或网络错误；未输出连接信息";

export class IngestionRunner {
  constructor(
    private readonly pool: Pool,
    private readonly fetcherFactory = (
      source: ReturnType<typeof sourceById>,
      limits: HttpLimits,
    ) => new BoundedFetcher(source, limits),
  ) {}
  async scan(input: ScanOptions, signal?: AbortSignal) {
    const source = sourceById(input.sourceId);
    const range = dateRange(input);
    if (input.url) normalizeUrl(input.url, source);
    if (!input.preview) await initializeSources(this.pool);
    const lock = await this.pool.connect();
    let globalLocked = false,
      sourceLocked = false;
    let runId: string | null = null;
    const counts: Counts = {
      discovered: 0,
      new: 0,
      changed: 0,
      unchanged: 0,
      ignored: 0,
      failed: 0,
    };
    const errors: { url: string; message: string }[] = [];
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
    let options = { ...input, ...range };
    const previews: unknown[] = [];
    const checkpoint = async () => {
      if (runId)
        await this.pool.query(
          "UPDATE ingestion_runs SET cursor=$2,counts=$3,errors=$4 WHERE id=$1",
          [
            runId,
            JSON.stringify(cursor),
            JSON.stringify(counts),
            JSON.stringify(errors),
          ],
        );
    };
    try {
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
      const settings = {
        ...defaultLimits,
        maxPages: 10,
        frequencyMinutes: 60,
        ...config?.settings,
        signal,
      };
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
        input.trigger === "scheduled" &&
        config?.last_started_at &&
        Date.now() - new Date(config.last_started_at).getTime() <
          settings.frequencyMinutes * 60000
      )
        return { status: "not-due", source: source.id };
      const fetcher = this.fetcherFactory(source, settings);
      if (input.resume) {
        const previous = (
          await lock.query(
            "SELECT * FROM ingestion_runs WHERE id=$1 AND source_id=$2",
            [input.resume, source.id],
          )
        ).rows[0];
        if (!previous || previous.status === "succeeded")
          throw new Error("续跑记录不存在、来源不符或已完成");
        options = {
          ...previous.options,
          preview: input.preview,
          resume: input.resume,
          trigger: "resume",
        };
        cursor = previous.cursor;
      } else if (!input.url) {
        const known = await lock.query(
          "SELECT n.url,v.article FROM ingestion_notices n JOIN ingestion_versions v ON v.id=n.latest_version WHERE n.source_id=$1 AND (v.article->>'publishedAt' IS NULL OR v.article->>'publishedAt' >= $2) ORDER BY n.fetched_at LIMIT 150",
          [source.id, range.from],
        );
        cursor.pending = known.rows.map((row) => ({
          url: row.url,
          title: row.article.title,
          publishedAt: row.article.publishedAt,
        }));
      }
      if (!input.preview) {
        await this.pool.query(
          "UPDATE ingestion_runs SET status='interrupted',finished_at=now() WHERE source_id=$1 AND status='running'",
          [source.id],
        );
        runId = randomUUID();
        await this.pool.query(
          "INSERT INTO ingestion_runs(id,source_id,trigger,status,options,cursor,counts) VALUES($1,$2,$3,'running',$4,$5,$6)",
          [
            runId,
            source.id,
            options.trigger ?? "manual",
            JSON.stringify(options),
            JSON.stringify(cursor),
            JSON.stringify(counts),
          ],
        );
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
      };
      let pages = 0;
      while (cursor.pages.length && pages < settings.maxPages) {
        await checkStopped();
        const pageUrl = cursor.pages[0];
        if (cursor.seen.includes(pageUrl)) throw new Error("分页出现循环");
        const response = await fetcher.get(pageUrl);
        if (response.status !== 200)
          throw new Error("列表 HTTP " + response.status);
        const page = extractList(response.html, response.url, source);
        counts.discovered += page.items.length;
        for (const item of page.items)
          if (
            (!item.publishedAt ||
              (item.publishedAt >= options.from &&
                item.publishedAt <= options.to)) &&
            !cursor.pending.some((p) => p.url === item.url)
          )
            cursor.pending.push(item);
        cursor.seen.push(pageUrl);
        cursor.pages.shift();
        if (page.next) cursor.pages.push(page.next);
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
            (!isCompetitionNotice(item.title) ||
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
          if (response.status === 304 && known?.latest_version) {
            counts.unchanged++;
            if (!input.preview)
              await this.pool.query(
                "UPDATE ingestion_notices SET fetched_at=now(),health='available' WHERE id=$1",
                [known.id],
              );
          } else {
            if (response.status !== 200)
              throw new Error(
                "通知 HTTP " + response.status + "，保留原正式数据",
              );
            const article = extractArticle(response.html, response.url, source);
            if (containsApplicantList(article.title))
              throw new Error("通知涉及报名者名单，停止采集并保留正式数据");
            if (
              (!known && !isCompetitionNotice(article.title)) ||
              (!options.url &&
                article.publishedAt &&
                (article.publishedAt < options.from ||
                  article.publishedAt > options.to))
            )
              counts.ignored++;
            else {
              const parsed = parseCandidate(
                article,
                item.url,
                catalog.colleges,
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
          counts.failed++;
          errors.push({ url: item.url, message: errorSummary(error) });
          if (!input.preview)
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
        signal?.aborted || errors.some((e) => /停止/.test(e.message))
          ? "interrupted"
          : cursor.pending.length || cursor.pages.length
            ? "partial"
            : "succeeded";
      if (runId)
        await this.pool.query(
          "UPDATE ingestion_runs SET status=$2,finished_at=now(),cursor=$3,counts=$4,errors=$5 WHERE id=$1",
          [
            runId,
            status,
            JSON.stringify(cursor),
            JSON.stringify(counts),
            JSON.stringify(errors),
          ],
        );
      return {
        runId,
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
      errors.push({
        url: cursor.pages[0] ?? cursor.pending[0]?.url ?? source.listUrl,
        message: errorSummary(error),
      });
      counts.failed++;
      const status =
        signal?.aborted || /停止/.test(errorSummary(error))
          ? "interrupted"
          : "failed";
      if (runId)
        await this.pool.query(
          "UPDATE ingestion_runs SET status=$5,finished_at=now(),cursor=$2,counts=$3,errors=$4 WHERE id=$1",
          [
            runId,
            JSON.stringify(cursor),
            JSON.stringify(counts),
            JSON.stringify(errors),
            status,
          ],
        );
      return {
        runId,
        status,
        source: source.id,
        counts,
        errors,
        cursor,
      };
    } finally {
      try {
        if (globalLocked) await lock.query("SELECT pg_advisory_unlock(23000)");
        if (sourceLocked)
          await lock.query("SELECT pg_advisory_unlock(23001,hashtext($1))", [
            source.id,
          ]);
      } finally {
        // 销毁持有会话锁的连接；即使连接异常导致显式解锁失败也不会回池。
        lock.release(true);
      }
    }
  }
}
