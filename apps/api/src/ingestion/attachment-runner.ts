import type { Pool } from "pg";
import {
  BoundedFetcher,
  defaultLimits,
  sourceById,
  normalizeAttachmentUrl,
  attachmentEligibility,
  classifyAttachment,
  attachmentExtractorVersion,
  type Article,
  type AttachmentMediaType,
} from "@hehuoda/sicau-connectors/notices";
import { parseAttachmentIsolated } from "./attachment-parser.js";
import { reserveAttachmentNetworkRequest } from "./attachment-budget.js";
import {
  persistAttachment,
  readAttachmentPlan,
  markAttachmentNeedsReview,
  readAttachmentVersionForReparse,
  persistAttachmentReparseRevision,
  canonicalAttachmentUrl,
} from "./attachment-store.js";
import type { IsolatedAttachmentResult } from "./attachment-parser.js";

type AttachmentParser = (
  bytes: Uint8Array,
  mediaType: AttachmentMediaType,
  options?: { signal?: AbortSignal },
) => Promise<IsolatedAttachmentResult>;

/** Called only while the scanner owns the global network lock and shared fetcher. */
export async function checkNoticeAttachments(
  pool: Pool,
  fetcher: BoundedFetcher,
  noticeId: string,
  parse = parseAttachmentIsolated,
  onlyUrl?: string,
) {
  if (process.env.INGESTION_ATTACHMENTS_ENABLED !== "true") return;
  const row = (
    await pool.query(
      "SELECT n.latest_version,v.article FROM ingestion_notices n JOIN ingestion_versions v ON v.id=n.latest_version WHERE n.id=$1",
      [noticeId],
    )
  ).rows[0];
  if (!row) throw new Error("附件来源通知不存在");
  const article = row.article as Article;
  const known = await readAttachmentPlan(pool, { noticeId, limit: 1000 });
  const links = new Map<string, string>();
  for (const attachment of article.attachments) {
    const url = canonicalAttachmentUrl(attachment.url);
    links.set(
      url,
      [links.get(url), attachment.title].filter(Boolean).join("\n"),
    );
  }
  for (const a of known)
    if (!links.has(a.url)) links.set(a.url, "赛事规则附件");
  for (const [url, title] of links) {
    if (onlyUrl && url !== onlyUrl) continue;
    const eligibility = attachmentEligibility(
      title,
      article.paragraphs.join("\n"),
    );
    // No remote bytes or personal list summaries are retained on a denied title/context.
    if (eligibility !== "eligible") {
      if (known.some((a) => a.url === url))
        await markAttachmentNeedsReview(
          pool,
          known.find((a) => a.url === url)!.attachmentId,
          eligibility === "blocked"
            ? "applicant-list"
            : "manual-classification",
          eligibility === "blocked" ? "blocked" : "needs-review",
        );
      else
        await persistAttachment(pool, {
          noticeId,
          noticeVersion: row.latest_version,
          url,
          mediaType: "application/octet-stream",
          extractorVersion: attachmentExtractorVersion,
          status: eligibility === "blocked" ? "blocked" : "needs-review",
          segments: [],
          body: new Uint8Array(),
          persistContent: false,
          errorCode:
            eligibility === "blocked"
              ? "applicant-list"
              : "manual-classification",
        });
      continue;
    }
    let canonical: string;
    try {
      canonical = normalizeAttachmentUrl(url, fetcher.source);
    } catch {
      await persistAttachment(pool, {
        noticeId,
        noticeVersion: row.latest_version,
        url,
        mediaType: "application/octet-stream",
        extractorVersion: attachmentExtractorVersion,
        status: "needs-review",
        segments: [],
        body: new Uint8Array(),
        persistContent: false,
        errorCode: "unapproved-attachment-url",
      });
      continue;
    }
    try {
      const response = await fetcher.getAttachment(canonical);
      if (response.status !== 200) throw new Error("attachment-http-status");
      const mediaType = classifyAttachment(
        response.body,
        response.headers["content-type"],
      );
      if (!mediaType) throw new Error("unsupported-attachment-type");
      const result = await parse(response.body, mediaType);
      await persistAttachment(pool, {
        noticeId,
        noticeVersion: row.latest_version,
        url: canonical,
        ...result,
        body: response.body,
        persistContent: result.status === "extracted",
      });
    } catch (error) {
      if (error instanceof Error && /预算|时长|采集已停止/.test(error.message))
        throw error;
      const code =
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : "attachment-fetch-or-parse-failed";
      const existing = known.find((a) => a.url === canonical);
      if (existing)
        await markAttachmentNeedsReview(pool, existing.attachmentId, code);
      else
        await persistAttachment(pool, {
          noticeId,
          noticeVersion: row.latest_version,
          url: canonical,
          mediaType: "application/octet-stream",
          extractorVersion: attachmentExtractorVersion,
          status: "needs-review",
          segments: [],
          body: new Uint8Array(),
          persistContent: false,
          errorCode: code,
        });
      // Budget exhaustion must leave the scanner's notice cursor pending for recovery.
      if (
        error instanceof Error &&
        /预算|时长|采集已停止|停止来源|拒绝|危险|白名单|robots|限流/.test(
          error.message,
        )
      )
        throw error;
    }
  }
}

export class AttachmentRunner {
  constructor(
    private readonly pool: Pool,
    private readonly parse: AttachmentParser = parseAttachmentIsolated,
  ) {}
  private async locked<T>(
    id: string,
    expected: number | undefined,
    work: (row: {
      notice_id: string;
      source_id: string;
      canonical_url: string;
      latest_version: string;
      notice_version: string;
      evidence_revision: number;
    }) => Promise<T>,
  ) {
    const client = await this.pool.connect();
    try {
      if (
        !(await client.query("SELECT pg_try_advisory_lock(23000) AS locked"))
          .rows[0].locked
      )
        throw new Error("附件运行冲突");
      const row = (
        await client.query(
          "SELECT a.*,n.source_id,n.latest_version AS notice_version,n.evidence_revision FROM ingestion_attachments a JOIN ingestion_notices n ON n.id=a.notice_id WHERE a.id=$1",
          [id],
        )
      ).rows[0];
      if (!row) throw new Error("附件不存在");
      if (expected !== undefined && Number(row.evidence_revision) !== expected)
        throw new Error("附件证据基线已过期");
      return await work(row);
    } finally {
      await client
        .query("SELECT pg_advisory_unlock(23000)")
        .catch(() => undefined);
      client.release(true);
    }
  }
  async recheck(id: string, expected?: number, signal?: AbortSignal) {
    return this.locked(id, expected, async (row) => {
      if (process.env.INGESTION_ATTACHMENTS_ENABLED !== "true")
        throw new Error("附件提取已关闭");
      const enabled = (
        await this.pool.query(
          "SELECT enabled FROM ingestion_sources WHERE id=$1",
          [row.source_id],
        )
      ).rows[0]?.enabled;
      if (enabled === false) throw new Error("来源已停止");
      const source = sourceById(row.source_id);
      const fetcher = new BoundedFetcher(source, {
        ...defaultLimits,
        requests: 10,
        signal,
        beforeRequest: () => reserveAttachmentNetworkRequest(this.pool),
      });
      await fetcher.checkRobots();
      // Explicit rechecks use the same safety gates as scheduled scans.
      if (process.env.INGESTION_ATTACHMENTS_ENABLED !== "true")
        throw new Error("附件提取已关闭");
      await checkNoticeAttachments(
        this.pool,
        fetcher,
        row.notice_id,
        (bytes, mediaType) =>
          parseAttachmentIsolated(bytes, mediaType, { signal }),
        row.canonical_url,
      );
      return { attachmentId: id, usage: fetcher.usage };
    });
  }
  async reparse(
    id: string,
    versionId: string,
    expected?: number,
    signal?: AbortSignal,
  ) {
    return this.locked(id, expected, async (row) => {
      signal?.throwIfAborted();
      const source = await readAttachmentVersionForReparse(
        this.pool,
        id,
        versionId,
      );
      if (!source) throw new Error("附件版本不存在");
      const baseline = {
        noticeVersion: row.notice_version,
        evidenceRevision: Number(row.evidence_revision),
        latestAttachmentVersion: row.latest_version,
      };
      let result: IsolatedAttachmentResult;
      try {
        const mediaType = classifyAttachment(source.body, source.mediaType);
        if (!mediaType) {
          const error = new Error("附件类型不支持");
          Object.assign(error, { code: "unsupported-attachment-type" });
          throw error;
        }
        result = await this.parse(source.body, mediaType, { signal });
        if (result.mediaType !== mediaType) {
          const error = new Error("解析器返回的附件类型与字节不符");
          Object.assign(error, { code: "type-mismatch" });
          throw error;
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        const code =
          error &&
          typeof error === "object" &&
          "code" in error &&
          typeof error.code === "string" &&
          /^[a-z0-9-]{1,80}$/.test(error.code)
            ? error.code
            : "parse-failed";
        await persistAttachmentReparseRevision(this.pool, {
          attachmentId: id,
          versionId,
          baseline,
          result: {
            mediaType: source.mediaType,
            extractorVersion: attachmentExtractorVersion,
            status: "needs-review",
            segments: [],
            errorCode: code,
            persistContent: false,
          },
          body: source.body,
        });
        throw error;
      }
      return persistAttachmentReparseRevision(this.pool, {
        attachmentId: id,
        versionId,
        baseline,
        result: {
          ...result,
          persistContent: result.status === "extracted",
        },
        body: source.body,
      });
    });
  }
}
