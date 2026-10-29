import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { transaction } from "./store.js";
import { refreshExtraction } from "./extraction-store.js";

export type AttachmentSegment = {
  kind: "page" | "paragraph";
  index: number;
  text: string;
};
export interface EvidenceReference {
  format: "html" | "pdf" | "docx";
  url: string;
  noticeVersion: string;
  attachmentVersion: string | null;
  page?: number;
  paragraph?: number;
  field: string;
  excerpt: string;
}
export async function readAttachmentEvidenceReferences(
  pool: Queryable,
  noticeId: string,
): Promise<EvidenceReference[]> {
  const rows = await pool.query(
    "SELECT a.canonical_url,v.notice_version,v.id,v.media_type,v.segments FROM ingestion_attachments a JOIN ingestion_attachment_versions v ON v.id=a.latest_version WHERE a.notice_id=$1 ORDER BY a.id",
    [noticeId],
  );
  return rows.rows.flatMap((row) =>
    (row.segments as AttachmentSegment[]).slice(0, 100).map((segment) => ({
      format:
        row.media_type === "application/pdf"
          ? ("pdf" as const)
          : ("docx" as const),
      url: row.canonical_url as string,
      noticeVersion: row.notice_version as string,
      attachmentVersion: row.id as string,
      ...(segment.kind === "page"
        ? { page: segment.index }
        : { paragraph: segment.index }),
      field: "attachmentText",
      excerpt: segment.text.slice(0, 500),
    })),
  );
}
export type AttachmentStatus =
  "extracted" | "needs-review" | "blocked" | "failed" | "stale";
export interface PersistAttachmentInput {
  noticeId: string;
  noticeVersion: string;
  url: string;
  mediaType: string;
  extractorVersion: string;
  status: AttachmentStatus;
  segments: AttachmentSegment[];
  errorCode?: string;
  body: Uint8Array;
  /** Set false for applicant-list or other sensitive material; no bytes/text are stored. */
  persistContent?: boolean;
  fetchedAt?: Date;
}
export interface AttachmentPlanRow {
  attachmentId: string;
  noticeId: string;
  sourceId: string;
  noticeVersion: string;
  url: string;
  latestAttachmentVersionId: string | null;
  sha256: string | null;
  fetchedAt: Date | null;
  status: AttachmentStatus | "pending";
}
type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;
async function recordEvidenceChange(
  client: PoolClient,
  noticeId: string,
  reason: string,
) {
  await client.query(
    "INSERT INTO ingestion_attachment_events(id,notice_id,source_version,evidence_revision,reason) SELECT $1,id,latest_version,evidence_revision,$3 FROM ingestion_notices WHERE id=$2",
    [randomUUID(), noticeId, reason],
  );
  await refreshExtraction(client, noticeId, undefined, true);
}

const REDACTED_REVIEW_HASH = "privacy-redacted";

function redactAttachmentSnapshots(
  value: unknown,
  attachmentId: string,
  versionIds: ReadonlySet<string>,
): { value: unknown; redacted: boolean } {
  if (Array.isArray(value)) {
    let redacted = false;
    const items = value.map((item) => {
      const result = redactAttachmentSnapshots(item, attachmentId, versionIds);
      redacted ||= result.redacted;
      return result.value;
    });
    return { value: items, redacted };
  }
  if (!value || typeof value !== "object") return { value, redacted: false };

  const source = value as Record<string, unknown>;
  if (
    source.fields &&
    Array.isArray(source.evidence) &&
    source.evidence.some(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof entry.attachmentVersion === "string" &&
        versionIds.has(entry.attachmentVersion),
    )
  ) {
    return {
      value: {
        ...source,
        privacyRedacted: true,
        fields: {
          name: "",
          edition: null,
          kind: "news",
          organizer: null,
          hosts: [],
          scope: { kind: "unknown", colleges: [], note: "隐私擦除" },
          mode: null,
          tracks: [],
          members: null,
          rules: [],
          stageNames: [],
          startsAt: { precision: "unknown", value: null },
          deadline: { precision: "unknown", value: null },
          materialsAt: { precision: "unknown", value: null },
          eventAt: { precision: "unknown", value: null },
        },
        evidence: [],
        fieldConflicts: [],
        warnings: ["名单隐私擦除：自动字段与定位摘录已移除"],
      },
      redacted: true,
    };
  }
  const result: Record<string, unknown> = {};
  let redacted = false;
  for (const [key, item] of Object.entries(source)) {
    if (key === "evidenceReferences" && Array.isArray(item)) {
      result[key] = item.map((reference) => {
        if (
          reference &&
          typeof reference === "object" &&
          "attachmentVersion" in reference &&
          typeof reference.attachmentVersion === "string" &&
          versionIds.has(reference.attachmentVersion)
        ) {
          redacted = true;
          return { ...reference, excerpt: "" };
        }
        const nested = redactAttachmentSnapshots(
          reference,
          attachmentId,
          versionIds,
        );
        redacted ||= nested.redacted;
        return nested.value;
      });
      continue;
    }

    const nested = redactAttachmentSnapshots(item, attachmentId, versionIds);
    result[key] = nested.value;
    redacted ||= nested.redacted;
  }

  const relatedVersion =
    typeof source.versionId === "string" && versionIds.has(source.versionId);
  if (
    result.candidate &&
    typeof result.candidate === "object" &&
    "privacyRedacted" in result.candidate &&
    result.candidate.privacyRedacted === true
  ) {
    // Editable batches may contain copied automatic values; a redacted receipt cannot be replayed.
    result.batch = { competitions: [] };
    result.privacyRedacted = true;
    redacted = true;
  }
  const relatedReference =
    typeof source.attachmentVersion === "string" &&
    versionIds.has(source.attachmentVersion);
  if (
    ((source.attachmentId === attachmentId &&
      typeof source.versionId !== "string") ||
      relatedVersion ||
      relatedReference) &&
    Object.prototype.hasOwnProperty.call(source, "sha256")
  ) {
    result.sha256 = null;
    redacted = true;
  }
  return { value: result, redacted };
}

/**
 * Remove sensitive bytes and their read-only review snapshots in the same transaction.
 * A title prefilter blocks the whole attachment identity; parser-based blocks target the
 * recognized version and byte-identical revisions. The latter keeps unrelated historical
 * rule documents for a reused URL intact.
 */
async function redactApplicantListContent(
  client: PoolClient,
  noticeId: string,
  attachmentId: string,
  scope: { allVersions?: boolean; versionIds?: string[]; sha256?: string } = {},
) {
  const versions = await client.query(
    `SELECT id FROM ingestion_attachment_versions
      WHERE attachment_id=$1
        AND ($2::boolean OR id=ANY($3::uuid[]) OR ($4::text IS NOT NULL AND sha256=$4))
      FOR UPDATE`,
    [
      attachmentId,
      scope.allVersions === true,
      scope.versionIds ?? [],
      scope.sha256 ?? null,
    ],
  );
  const versionIds = versions.rows.map((row) => row.id as string);
  const versionSet = new Set(versionIds);
  const current = (
    await client.query(
      "SELECT latest_version FROM ingestion_attachments WHERE id=$1",
      [attachmentId],
    )
  ).rows[0];
  const affectsCurrent =
    scope.allVersions === true || versionSet.has(current?.latest_version);
  if (versionIds.length) {
    await client.query(
      `UPDATE ingestion_attachment_versions
          SET sha256=NULL,body=NULL,segments='[]'::jsonb,status='blocked',error_code='applicant-list'
        WHERE id=ANY($1::uuid[])`,
      [versionIds],
    );
  }

  const candidates = await client.query(
    "SELECT id,approved_file FROM ingestion_candidates WHERE notice_id=$1 FOR UPDATE",
    [noticeId],
  );
  for (const candidate of candidates.rows) {
    if (
      (
        await client.query(
          "SELECT to_regclass('ingestion_extraction_revisions') IS NOT NULL AS ready",
        )
      ).rows[0].ready
    ) {
      const extractions = await client.query(
        "SELECT id,data FROM ingestion_extraction_revisions WHERE candidate_id=$1",
        [candidate.id],
      );
      for (const extraction of extractions.rows) {
        const scrubbed = redactAttachmentSnapshots(
          extraction.data,
          attachmentId,
          versionSet,
        );
        if (scrubbed.redacted)
          await client.query(
            "UPDATE ingestion_extraction_revisions SET data=$2 WHERE id=$1",
            [extraction.id, scrubbed.value],
          );
      }
    }
    const scrubbed = redactAttachmentSnapshots(
      candidate.approved_file,
      attachmentId,
      versionSet,
    );
    if (scrubbed.redacted)
      await client.query(
        "UPDATE ingestion_candidates SET approved_file=$2::jsonb WHERE id=$1",
        [candidate.id, JSON.stringify(scrubbed.value)],
      );

    const revisions = await client.query(
      "SELECT candidate_revision,review FROM ingestion_review_revisions WHERE candidate_id=$1",
      [candidate.id],
    );
    for (const row of revisions.rows) {
      const review = redactAttachmentSnapshots(
        row.review,
        attachmentId,
        versionSet,
      );
      if (review.redacted)
        await client.query(
          "UPDATE ingestion_review_revisions SET review=$3::jsonb WHERE candidate_id=$1 AND candidate_revision=$2",
          [candidate.id, row.candidate_revision, JSON.stringify(review.value)],
        );
    }

    const operations = await client.query(
      "SELECT id,result FROM ingestion_operations WHERE candidate_id=$1",
      [candidate.id],
    );
    for (const row of operations.rows) {
      const result = redactAttachmentSnapshots(
        row.result,
        attachmentId,
        versionSet,
      );
      if (result.redacted)
        await client.query(
          "UPDATE ingestion_operations SET input_hash=$2,result=$3::jsonb WHERE id=$1",
          [row.id, REDACTED_REVIEW_HASH, JSON.stringify(result.value)],
        );
    }

    const previews = await client.query(
      "SELECT id,result FROM ingestion_review_previews WHERE candidate_id=$1 AND purpose='import'",
      [candidate.id],
    );
    for (const row of previews.rows) {
      const result = redactAttachmentSnapshots(
        row.result,
        attachmentId,
        versionSet,
      );
      if (!result.redacted && !affectsCurrent) continue;
      await client.query(
        "UPDATE ingestion_review_previews SET review_hash=$2,result=$3::jsonb WHERE id=$1",
        [row.id, REDACTED_REVIEW_HASH, JSON.stringify(result.value)],
      );
    }

    const commands = await client.query(
      `SELECT DISTINCT c.actor_id,c.operation_id,c.result
         FROM admin_ingestion_commands c
         JOIN admin_operations o ON o.command_operation_id=c.operation_id
        WHERE o.object_type='candidate' AND o.object_id=$1
          AND c.action IN ('candidate.review','candidate.import')`,
      [candidate.id],
    );
    for (const row of commands.rows) {
      const result = redactAttachmentSnapshots(
        row.result,
        attachmentId,
        versionSet,
      );
      if (!result.redacted && !affectsCurrent) continue;
      await client.query(
        `UPDATE admin_ingestion_commands
            SET input_hash=$3,result=$4::jsonb
          WHERE actor_id=$1 AND operation_id=$2`,
        [
          row.actor_id,
          row.operation_id,
          REDACTED_REVIEW_HASH,
          JSON.stringify(result.value),
        ],
      );
    }
  }

  await recordEvidenceChange(client, noticeId, "privacy-redaction");
}

export function canonicalAttachmentUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("附件 URL 须为无凭据的 HTTPS 地址");
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (/^utm_(source|medium|campaign|term|content)$/i.test(key))
      url.searchParams.delete(key);
  return url.toString();
}

export async function readAttachmentPlan(
  pool: Pool,
  options: { noticeId?: string; dueBefore?: Date; limit?: number } = {},
): Promise<AttachmentPlanRow[]> {
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new Error("附件复查批次须为 1–1000");
  const result = await pool.query(
    `SELECT a.id AS attachment_id,a.notice_id,n.source_id,n.latest_version AS notice_version,
            a.canonical_url,a.latest_version AS attachment_version,v.sha256,v.fetched_at,a.state AS attachment_state
       FROM ingestion_attachments a
       JOIN ingestion_notices n ON n.id=a.notice_id
       LEFT JOIN ingestion_attachment_versions v ON v.id=a.latest_version
      WHERE a.state <> 'blocked'
        AND ($1::text IS NULL OR a.notice_id=$1)
        AND ($2::timestamptz IS NULL OR a.last_checked_at IS NULL OR a.last_checked_at <= $2)
      ORDER BY a.last_checked_at NULLS FIRST,a.id
      LIMIT $3`,
    [options.noticeId ?? null, options.dueBefore ?? null, limit],
  );
  return result.rows.map((row) => ({
    attachmentId: row.attachment_id,
    noticeId: row.notice_id,
    sourceId: row.source_id,
    noticeVersion: row.notice_version,
    url: row.canonical_url,
    latestAttachmentVersionId: row.attachment_version,
    sha256: row.sha256,
    fetchedAt: row.fetched_at,
    status: row.attachment_state ?? "pending",
  }));
}

/** Record linked attachments before attempting network I/O so approval freezes immediately. */
export async function registerAttachments(
  pool: Pool | PoolClient,
  noticeId: string,
  noticeVersion: string,
  urls: string[],
) {
  const canonicalUrls = [...new Set(urls.map(canonicalAttachmentUrl))];
  const work = async (client: PoolClient) => {
    const notice = await client.query(
      "SELECT latest_version,evidence_revision FROM ingestion_notices WHERE id=$1 FOR UPDATE",
      [noticeId],
    );
    if (!notice.rowCount) throw new Error("附件来源通知不存在");
    if (notice.rows[0].latest_version !== noticeVersion)
      throw new Error("来源通知版本已变化，附件链接已过期");
    const candidate = await client.query(
      "SELECT id FROM ingestion_candidates WHERE notice_id=$1 FOR UPDATE",
      [noticeId],
    );
    let added = 0;
    for (const url of canonicalUrls) {
      const inserted = await client.query(
        `INSERT INTO ingestion_attachments(id,notice_id,canonical_url,discovered_version,state)
         VALUES($1,$2,$3,$4,'pending') ON CONFLICT(notice_id,canonical_url) DO NOTHING RETURNING id`,
        [randomUUID(), noticeId, url, noticeVersion],
      );
      added += inserted.rowCount ?? 0;
    }
    if (!added)
      return {
        added: 0,
        evidenceRevision: Number(notice.rows[0].evidence_revision),
      };
    const revision = Number(notice.rows[0].evidence_revision) + 1;
    await client.query(
      "UPDATE ingestion_notices SET evidence_revision=$2,evidence_state='review-required' WHERE id=$1",
      [noticeId, revision],
    );
    await client.query(
      `INSERT INTO ingestion_evidence_sets(notice_id,revision,source_version,attachment_versions,state)
       SELECT $1,$2,$3,COALESCE(jsonb_agg(jsonb_build_object('attachmentId',a.id,'versionId',a.latest_version) ORDER BY a.id),'[]'::jsonb),'review-required'
         FROM ingestion_attachments a WHERE a.notice_id=$1`,
      [noticeId, revision, noticeVersion],
    );
    if (candidate.rowCount)
      await client.query(
        "UPDATE ingestion_candidates SET revision=revision+1,status='pending',reviewer=NULL,checked_at=NULL,reason='attachment-pending',approved_file=NULL,updated_at=now() WHERE notice_id=$1",
        [noticeId],
      );
    await recordEvidenceChange(client, noticeId, "attachment-discovered");
    return { added, evidenceRevision: revision };
  };
  return "release" in pool ? work(pool) : transaction(pool, work);
}

/** Freeze evidence older than the current scheduled review window exactly once. */
export async function invalidateNoticeAttachments(
  client: PoolClient,
  noticeId: string,
) {
  const stale = await client.query(
    "UPDATE ingestion_attachments SET state='stale',error_code='notice-version-changed' WHERE notice_id=$1 AND latest_version IS NOT NULL AND state NOT IN ('blocked','stale') RETURNING id",
    [noticeId],
  );
  if (!stale.rowCount) return;
  await client.query(
    "UPDATE ingestion_notices SET evidence_revision=evidence_revision+1,evidence_state='review-required' WHERE id=$1",
    [noticeId],
  );
  await client.query(
    "INSERT INTO ingestion_evidence_sets(notice_id,revision,source_version,attachment_versions,state) SELECT n.id,n.evidence_revision,n.latest_version,COALESCE((SELECT jsonb_agg(jsonb_build_object('attachmentId',a.id,'versionId',a.latest_version) ORDER BY a.id) FROM ingestion_attachments a WHERE a.notice_id=n.id),'[]'::jsonb),'review-required' FROM ingestion_notices n WHERE n.id=$1",
    [noticeId],
  );
  await recordEvidenceChange(client, noticeId, "notice-version-changed");
}

export async function queueDueAttachments(pool: Pool, dueAt: Date) {
  if (!Number.isFinite(dueAt.getTime())) throw new Error("附件复查时间无效");
  const notices = await pool.query(
    `SELECT DISTINCT notice_id FROM ingestion_attachments
      WHERE state NOT IN ('blocked','stale')
        AND (last_checked_at IS NULL OR last_checked_at < $1)
      ORDER BY notice_id`,
    [dueAt],
  );
  let queued = 0;
  for (const { notice_id: noticeId } of notices.rows) {
    const changed = await transaction(pool, async (client) => {
      const notice = await client.query(
        "SELECT id,latest_version,evidence_revision FROM ingestion_notices WHERE id=$1 FOR UPDATE",
        [noticeId],
      );
      if (!notice.rowCount) return false;
      const candidate = await client.query(
        "SELECT id FROM ingestion_candidates WHERE notice_id=$1 FOR UPDATE",
        [noticeId],
      );
      const stale = await client.query(
        `UPDATE ingestion_attachments SET state='stale'
          WHERE notice_id=$1 AND state NOT IN ('blocked','stale')
            AND (last_checked_at IS NULL OR last_checked_at < $2) RETURNING id`,
        [noticeId, dueAt],
      );
      if (!stale.rowCount) return false;
      const revision = Number(notice.rows[0].evidence_revision) + 1;
      await client.query(
        "UPDATE ingestion_notices SET evidence_revision=$2,evidence_state='review-required' WHERE id=$1",
        [noticeId, revision],
      );
      await client.query(
        `INSERT INTO ingestion_evidence_sets(notice_id,revision,source_version,attachment_versions,state)
         SELECT $1,$2,$3,COALESCE(jsonb_agg(jsonb_build_object('attachmentId',a.id,'versionId',a.latest_version) ORDER BY a.id),'[]'::jsonb),'review-required'
           FROM ingestion_attachments a WHERE a.notice_id=$1`,
        [noticeId, revision, notice.rows[0].latest_version],
      );
      if (candidate.rowCount)
        await client.query(
          "UPDATE ingestion_candidates SET revision=revision+1,status='pending',reviewer=NULL,checked_at=NULL,reason='attachment-stale',approved_file=NULL,updated_at=now() WHERE notice_id=$1",
          [noticeId],
        );
      await recordEvidenceChange(client, noticeId, "attachment-stale");
      return true;
    });
    if (changed) queued++;
  }
  return { noticesQueued: queued };
}

/** Persist one immutable fetched/parsed attachment revision and advance its notice evidence set. */
export async function persistAttachment(
  pool: Pool,
  input: PersistAttachmentInput,
) {
  const url = canonicalAttachmentUrl(input.url);
  if (input.body.byteLength > 5 * 1024 * 1024)
    throw new Error("附件字节超过 5 MiB");
  if (input.segments.length > 20_000) throw new Error("附件文本片段超过上限");
  for (const segment of input.segments)
    if (
      !Number.isInteger(segment.index) ||
      segment.index < 1 ||
      !["page", "paragraph"].includes(segment.kind) ||
      typeof segment.text !== "string" ||
      segment.text.length > 100_000
    )
      throw new Error("附件文本片段无效");
  if (input.persistContent === false && input.segments.length)
    throw new Error("敏感附件不得持久化提取文本");
  const storeContent = input.persistContent !== false;
  const observedSha256 = createHash("sha256").update(input.body).digest("hex");
  const sha256 = storeContent ? observedSha256 : null;
  return transaction(pool, async (client) => {
    const notice = await client.query(
      "SELECT id,latest_version,evidence_revision FROM ingestion_notices WHERE id=$1 FOR UPDATE",
      [input.noticeId],
    );
    if (!notice.rowCount) throw new Error("附件来源通知不存在");
    if (notice.rows[0].latest_version !== input.noticeVersion)
      throw new Error("来源通知版本已变化，附件结果已过期");
    const identity = await client.query(
      `INSERT INTO ingestion_attachments(id,notice_id,canonical_url,discovered_version,state)
       VALUES($1,$2,$3,$4,'pending') ON CONFLICT(notice_id,canonical_url)
       DO UPDATE SET canonical_url=ingestion_attachments.canonical_url
       RETURNING id,latest_version,state`,
      [randomUUID(), input.noticeId, url, input.noticeVersion],
    );
    const attachment = identity.rows[0];
    const previous = attachment.latest_version
      ? (
          await client.query(
            "SELECT id,revision,sha256,extractor_version,status FROM ingestion_attachment_versions WHERE id=$1 FOR UPDATE",
            [attachment.latest_version],
          )
        ).rows[0]
      : null;
    if (
      previous?.sha256 === sha256 &&
      previous?.extractor_version === input.extractorVersion &&
      previous?.status === input.status
    ) {
      await client.query(
        "UPDATE ingestion_attachments SET state=$2,last_checked_at=$3,error_code=$4 WHERE id=$1",
        [
          attachment.id,
          input.status,
          input.fetchedAt ?? new Date(),
          input.errorCode ?? null,
        ],
      );
      if (attachment.state !== input.status) {
        const revision = Number(notice.rows[0].evidence_revision) + 1;
        const aggregate = await client.query(
          "SELECT bool_and(state='extracted') AS all_extracted,bool_or(state='blocked') AS any_blocked FROM ingestion_attachments WHERE notice_id=$1",
          [input.noticeId],
        );
        const evidenceState = aggregate.rows[0].any_blocked
          ? "blocked"
          : aggregate.rows[0].all_extracted && input.persistContent !== false
            ? "current"
            : "review-required";
        await client.query(
          "UPDATE ingestion_notices SET evidence_revision=$2,evidence_state=$3 WHERE id=$1",
          [input.noticeId, revision, evidenceState],
        );
        await client.query(
          `INSERT INTO ingestion_evidence_sets(notice_id,revision,source_version,attachment_versions,state)
           SELECT $1,$2,$3,COALESCE(jsonb_agg(jsonb_build_object('attachmentId',a.id,'versionId',a.latest_version) ORDER BY a.id),'[]'::jsonb),$4
             FROM ingestion_attachments a WHERE a.notice_id=$1`,
          [input.noticeId, revision, input.noticeVersion, evidenceState],
        );
        await client.query(
          "UPDATE ingestion_candidates SET revision=revision+1,status='pending',reviewer=NULL,checked_at=NULL,reason=NULL,approved_file=NULL,updated_at=now() WHERE notice_id=$1",
          [input.noticeId],
        );
        await recordEvidenceChange(
          client,
          input.noticeId,
          "attachment-revalidated",
        );
        if (input.status === "blocked" && input.errorCode === "applicant-list")
          await redactApplicantListContent(
            client,
            input.noticeId,
            attachment.id as string,
            { sha256: observedSha256 },
          );
        return {
          attachmentId: attachment.id as string,
          versionId: previous.id as string,
          changed: false,
          restored: true,
          evidenceRevision: revision,
        };
      }
      if (input.status === "blocked" && input.errorCode === "applicant-list")
        await redactApplicantListContent(
          client,
          input.noticeId,
          attachment.id as string,
          { sha256: observedSha256 },
        );
      return {
        attachmentId: attachment.id as string,
        versionId: previous.id as string,
        changed: false,
        evidenceRevision: notice.rows[0].evidence_revision as number,
      };
    }
    const versionId = randomUUID();
    const nextRevision = Number(
      (
        await client.query(
          "SELECT COALESCE(MAX(revision),0)+1 AS revision FROM ingestion_attachment_versions WHERE attachment_id=$1",
          [attachment.id],
        )
      ).rows[0].revision,
    );
    await client.query(
      `INSERT INTO ingestion_attachment_versions
       (id,attachment_id,previous_version,revision,sha256,notice_version,fetched_at,media_type,extractor_version,status,segments,error_code,body)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        versionId,
        attachment.id,
        previous?.id ?? null,
        nextRevision,
        sha256,
        input.noticeVersion,
        input.fetchedAt ?? new Date(),
        input.mediaType,
        input.extractorVersion,
        input.status,
        JSON.stringify(storeContent ? input.segments : []),
        input.errorCode ?? (storeContent ? null : "sensitive-content-excluded"),
        storeContent ? Buffer.from(input.body) : null,
      ],
    );
    const evidenceRevision = Number(notice.rows[0].evidence_revision) + 1;
    await client.query(
      "UPDATE ingestion_attachments SET latest_version=$2,state=$3,last_checked_at=$4,error_code=$5 WHERE id=$1",
      [
        attachment.id,
        versionId,
        input.status,
        input.fetchedAt ?? new Date(),
        input.errorCode ?? null,
      ],
    );
    const evidence = await client.query(
      `SELECT id,latest_version FROM ingestion_attachments WHERE notice_id=$1 ORDER BY id`,
      [input.noticeId],
    );
    const aggregate = await client.query(
      "SELECT bool_and(state='extracted') AS all_extracted,bool_or(state='blocked') AS any_blocked FROM ingestion_attachments WHERE notice_id=$1",
      [input.noticeId],
    );
    const evidenceState = aggregate.rows[0].any_blocked
      ? "blocked"
      : aggregate.rows[0].all_extracted && storeContent
        ? "current"
        : "review-required";
    const members = evidence.rows.map((row) => ({
      attachmentId: row.id,
      versionId: row.id === attachment.id ? versionId : row.latest_version,
    }));
    await client.query(
      "UPDATE ingestion_notices SET evidence_revision=$2,evidence_state=$3 WHERE id=$1",
      [input.noticeId, evidenceRevision, evidenceState],
    );
    await client.query(
      "INSERT INTO ingestion_evidence_sets(notice_id,revision,source_version,attachment_versions,state) VALUES($1,$2,$3,$4,$5)",
      [
        input.noticeId,
        evidenceRevision,
        input.noticeVersion,
        JSON.stringify(members),
        evidenceState,
      ],
    );
    const candidate = await client.query(
      `UPDATE ingestion_candidates SET revision=revision+1,status='pending',reviewer=NULL,checked_at=NULL,reason=NULL,approved_file=NULL,updated_at=now()
        WHERE notice_id=$1 RETURNING id,revision`,
      [input.noticeId],
    );
    await recordEvidenceChange(client, input.noticeId, "attachment-version");
    if (input.status === "blocked" && input.errorCode === "applicant-list")
      await redactApplicantListContent(
        client,
        input.noticeId,
        attachment.id as string,
        { versionIds: [versionId], sha256: observedSha256 },
      );
    return {
      attachmentId: attachment.id as string,
      versionId,
      changed: true,
      evidenceRevision,
      candidateId: candidate.rows[0]?.id as string | undefined,
    };
  });
}

export async function markAttachmentNeedsReview(
  pool: Pool,
  attachmentId: string,
  code: string,
  state: "needs-review" | "blocked" | "failed" = "needs-review",
) {
  if (!/^[a-z0-9-]{1,80}$/.test(code)) throw new Error("附件安全状态码无效");
  const effectiveState = code === "applicant-list" ? "blocked" : state;
  return transaction(pool, async (client) => {
    const attachment = await client.query(
      "SELECT notice_id FROM ingestion_attachments WHERE id=$1",
      [attachmentId],
    );
    if (!attachment.rowCount) throw new Error("附件不存在");
    const noticeId = attachment.rows[0].notice_id as string;
    await client.query(
      "SELECT id FROM ingestion_notices WHERE id=$1 FOR UPDATE",
      [noticeId],
    );
    await client.query(
      "SELECT id FROM ingestion_candidates WHERE notice_id=$1 FOR UPDATE",
      [noticeId],
    );
    const updated = await client.query(
      "UPDATE ingestion_attachments SET state=$2,last_checked_at=now(),error_code=$3 WHERE id=$1",
      [attachmentId, effectiveState, code],
    );
    if (updated.rowCount === 0) throw new Error("附件状态更新失败");
    const result = await client.query(
      "UPDATE ingestion_notices SET evidence_revision=evidence_revision+1,evidence_state=$2 WHERE id=$1 RETURNING evidence_revision,latest_version",
      [noticeId, effectiveState === "blocked" ? "blocked" : "review-required"],
    );
    await client.query(
      "INSERT INTO ingestion_evidence_sets(notice_id,revision,source_version,attachment_versions,state) SELECT $1,$2,$3,COALESCE(jsonb_agg(jsonb_build_object('attachmentId',a.id,'versionId',a.latest_version) ORDER BY a.id),'[]'::jsonb),$4 FROM ingestion_attachments a WHERE a.notice_id=$1",
      [
        noticeId,
        result.rows[0].evidence_revision,
        result.rows[0].latest_version,
        effectiveState === "blocked" ? "blocked" : "review-required",
      ],
    );
    const candidate = await client.query(
      "UPDATE ingestion_candidates SET revision=revision+1,status='pending',reviewer=NULL,checked_at=NULL,reason=$2,approved_file=NULL,updated_at=now() WHERE notice_id=$1 RETURNING id,revision",
      [noticeId, code],
    );
    await recordEvidenceChange(client, noticeId, code);
    if (code === "applicant-list")
      await redactApplicantListContent(client, noticeId, attachmentId, {
        allVersions: true,
      });
    return {
      noticeId,
      evidenceRevision: result.rows[0].evidence_revision as number,
      candidateId: candidate.rows[0]?.id as string | undefined,
      candidateRevision: candidate.rows[0]?.revision as number | undefined,
    };
  });
}

export async function listAttachments(pool: Pool, noticeId: string) {
  const result = await pool.query(
    `SELECT a.id,a.canonical_url,a.state,a.discovered_version,a.latest_version,
            v.sha256,v.fetched_at,v.media_type,v.extractor_version,v.status,
            n.evidence_revision,n.evidence_state
       FROM ingestion_attachments a LEFT JOIN ingestion_attachment_versions v ON v.id=a.latest_version
       JOIN ingestion_notices n ON n.id=a.notice_id WHERE a.notice_id=$1 ORDER BY a.id`,
    [noticeId],
  );
  return result.rows;
}

export async function listAttachmentVersions(pool: Pool, attachmentId: string) {
  const result = await pool.query(
    `SELECT id,attachment_id,previous_version,revision,sha256,notice_version,fetched_at,media_type,
            extractor_version,status,segments,error_code
       FROM ingestion_attachment_versions WHERE attachment_id=$1 ORDER BY revision DESC LIMIT 100`,
    [attachmentId],
  );
  return result.rows;
}

export async function getAttachmentVersion(
  pool: Pool,
  attachmentId: string,
  versionId: string,
) {
  const result = await pool.query(
    `SELECT id,attachment_id,previous_version,revision,sha256,notice_version,fetched_at,media_type,
            extractor_version,status,segments,error_code
       FROM ingestion_attachment_versions WHERE attachment_id=$1 AND id=$2`,
    [attachmentId, versionId],
  );
  return result.rows[0] ?? null;
}

export async function readAttachmentBytesForReparse(
  pool: Pool,
  attachmentId: string,
  versionId: string,
) {
  const result = await pool.query(
    "SELECT body,sha256 FROM ingestion_attachment_versions WHERE attachment_id=$1 AND id=$2",
    [attachmentId, versionId],
  );
  if (!result.rowCount) return null;
  if (!result.rows[0].body)
    throw new Error("附件字节已清理，需重新受控获取后才能解析");
  if (
    createHash("sha256").update(result.rows[0].body).digest("hex") !==
    result.rows[0].sha256
  )
    throw new Error("附件字节摘要不匹配，需重新受控获取");
  return new Uint8Array(result.rows[0].body);
}

export async function readAttachmentVersionForReparse(
  pool: Pool,
  attachmentId: string,
  versionId: string,
) {
  const result = await pool.query(
    `SELECT body,sha256,media_type,notice_version
       FROM ingestion_attachment_versions
      WHERE attachment_id=$1 AND id=$2`,
    [attachmentId, versionId],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  if (!row.body) throw new Error("附件字节已清理，需重新受控获取后才能解析");
  if (
    typeof row.sha256 !== "string" ||
    createHash("sha256").update(row.body).digest("hex") !== row.sha256
  )
    throw new Error("附件字节摘要不匹配，需重新受控获取");
  return {
    body: new Uint8Array(row.body),
    sha256: row.sha256 as string,
    mediaType: row.media_type as string,
    noticeVersion: row.notice_version as string,
  };
}

export interface AttachmentReparseBaseline {
  noticeVersion: string;
  evidenceRevision: number;
  latestAttachmentVersion: string;
}

/** Save an extraction revision without allowing an old byte version to become current. */
export async function persistAttachmentReparseRevision(
  pool: Pool,
  input: {
    attachmentId: string;
    versionId: string;
    baseline: AttachmentReparseBaseline;
    result: Pick<
      PersistAttachmentInput,
      "mediaType" | "extractorVersion" | "status" | "segments" | "errorCode"
    > & { persistContent?: boolean };
    body: Uint8Array;
  },
) {
  if (input.result.segments.length > 20_000)
    throw new Error("附件文本片段超过上限");
  for (const segment of input.result.segments)
    if (
      !Number.isInteger(segment.index) ||
      segment.index < 1 ||
      !["page", "paragraph"].includes(segment.kind) ||
      typeof segment.text !== "string" ||
      segment.text.length > 100_000
    )
      throw new Error("附件文本片段无效");
  const storeContent = input.result.persistContent !== false;
  if (!storeContent && input.result.segments.length)
    throw new Error("敏感附件不得持久化提取文本");

  return transaction(pool, async (client) => {
    const identity = await client.query(
      "SELECT notice_id FROM ingestion_attachments WHERE id=$1",
      [input.attachmentId],
    );
    if (!identity.rowCount) throw new Error("附件不存在");
    const noticeId = identity.rows[0].notice_id as string;
    const notice = await client.query(
      "SELECT latest_version,evidence_revision FROM ingestion_notices WHERE id=$1 FOR UPDATE",
      [noticeId],
    );
    const candidate = await client.query(
      "SELECT id FROM ingestion_candidates WHERE notice_id=$1 FOR UPDATE",
      [noticeId],
    );
    const attachment = await client.query(
      "SELECT latest_version,state FROM ingestion_attachments WHERE id=$1 FOR UPDATE",
      [input.attachmentId],
    );
    if (!notice.rowCount || !attachment.rowCount)
      throw new Error("附件来源通知不存在");
    if (
      notice.rows[0].latest_version !== input.baseline.noticeVersion ||
      Number(notice.rows[0].evidence_revision) !==
        input.baseline.evidenceRevision ||
      attachment.rows[0].latest_version !==
        input.baseline.latestAttachmentVersion
    )
      throw new Error("附件重解析基线已变化");

    const source = await client.query(
      `SELECT sha256,body,media_type,notice_version
         FROM ingestion_attachment_versions
        WHERE id=$1 AND attachment_id=$2 FOR UPDATE`,
      [input.versionId, input.attachmentId],
    );
    if (!source.rowCount) throw new Error("附件内容版本不存在");
    const sourceVersion = source.rows[0];
    if (!sourceVersion.body)
      throw new Error("附件字节已清理，需重新受控获取后才能解析");
    const sourceHash = createHash("sha256")
      .update(sourceVersion.body)
      .digest("hex");
    if (sourceVersion.sha256 !== sourceHash)
      throw new Error("附件字节摘要不匹配，需重新受控获取");
    if (input.body.byteLength > 5 * 1024 * 1024)
      throw new Error("附件字节超过 5 MiB");
    if (createHash("sha256").update(input.body).digest("hex") !== sourceHash)
      throw new Error("待解析字节与所选附件版本不符");

    const historical = input.versionId !== attachment.rows[0].latest_version;
    const revision = Number(
      (
        await client.query(
          "SELECT COALESCE(MAX(revision),0)+1 AS revision FROM ingestion_attachment_versions WHERE attachment_id=$1",
          [input.attachmentId],
        )
      ).rows[0].revision,
    );
    const versionId = randomUUID();
    const sha256 = storeContent ? sourceHash : null;
    await client.query(
      `INSERT INTO ingestion_attachment_versions
       (id,attachment_id,previous_version,revision,sha256,notice_version,fetched_at,media_type,extractor_version,status,segments,error_code,body)
       VALUES($1,$2,$3,$4,$5,$6,now(),$7,$8,$9,$10,$11,$12)`,
      [
        versionId,
        input.attachmentId,
        input.versionId,
        revision,
        sha256,
        sourceVersion.notice_version,
        input.result.mediaType,
        input.result.extractorVersion,
        input.result.status,
        JSON.stringify(storeContent ? input.result.segments : []),
        input.result.errorCode ??
          (storeContent ? null : "sensitive-content-excluded"),
        storeContent ? Buffer.from(sourceVersion.body) : null,
      ],
    );
    if (
      input.result.status === "blocked" &&
      input.result.errorCode === "applicant-list"
    )
      await redactApplicantListContent(client, noticeId, input.attachmentId, {
        versionIds: [input.versionId, versionId],
        sha256: sourceHash,
      });
    if (historical)
      return {
        attachmentId: input.attachmentId,
        versionId,
        historical: true,
        evidenceRevision: input.baseline.evidenceRevision,
      };

    const priorState = attachment.rows[0].state as AttachmentStatus;
    const nextState =
      priorState === "stale" && input.result.status === "extracted"
        ? "stale"
        : input.result.status;
    await client.query(
      "UPDATE ingestion_attachments SET latest_version=$2,state=$3,last_checked_at=now(),error_code=$4 WHERE id=$1",
      [
        input.attachmentId,
        versionId,
        nextState,
        input.result.errorCode ?? null,
      ],
    );
    const aggregate = await client.query(
      "SELECT bool_and(state='extracted') AS all_extracted,bool_or(state='blocked') AS any_blocked FROM ingestion_attachments WHERE notice_id=$1",
      [noticeId],
    );
    const evidenceState = aggregate.rows[0].any_blocked
      ? "blocked"
      : aggregate.rows[0].all_extracted
        ? "current"
        : "review-required";
    const update = await client.query(
      "UPDATE ingestion_notices SET evidence_revision=evidence_revision+1,evidence_state=$2 WHERE id=$1 RETURNING evidence_revision",
      [noticeId, evidenceState],
    );
    await client.query(
      `INSERT INTO ingestion_evidence_sets(notice_id,revision,source_version,attachment_versions,state)
       SELECT $1,$2,$3,COALESCE(jsonb_agg(jsonb_build_object('attachmentId',a.id,'versionId',a.latest_version) ORDER BY a.id),'[]'::jsonb),$4
         FROM ingestion_attachments a WHERE a.notice_id=$1`,
      [
        noticeId,
        update.rows[0].evidence_revision,
        input.baseline.noticeVersion,
        evidenceState,
      ],
    );
    if (candidate.rowCount)
      await client.query(
        "UPDATE ingestion_candidates SET revision=revision+1,status='pending',reviewer=NULL,checked_at=NULL,reason=$2,approved_file=NULL,updated_at=now() WHERE notice_id=$1",
        [noticeId, input.result.errorCode ?? null],
      );
    await recordEvidenceChange(
      client,
      noticeId,
      input.result.errorCode ?? "attachment-reparse",
    );
    return {
      attachmentId: input.attachmentId,
      versionId,
      historical: false,
      evidenceRevision: Number(update.rows[0].evidence_revision),
    };
  });
}

export async function reparseExistingAttachment(
  pool: Pool,
  attachmentId: string,
  versionId: string,
  result: Pick<
    PersistAttachmentInput,
    "mediaType" | "extractorVersion" | "status" | "segments" | "errorCode"
  >,
) {
  const current = await pool.query(
    `SELECT v.body,a.latest_version,n.latest_version AS notice_version,n.evidence_revision
       FROM ingestion_attachment_versions v
       JOIN ingestion_attachments a ON a.id=v.attachment_id
       JOIN ingestion_notices n ON n.id=a.notice_id
      WHERE v.id=$1 AND v.attachment_id=$2`,
    [versionId, attachmentId],
  );
  if (!current.rowCount) throw new Error("附件内容版本不存在");
  const row = current.rows[0];
  if (!row.body) throw new Error("附件字节已清理，需重新受控获取后才能解析");
  return persistAttachmentReparseRevision(pool, {
    attachmentId,
    versionId,
    baseline: {
      noticeVersion: row.notice_version,
      evidenceRevision: Number(row.evidence_revision),
      latestAttachmentVersion: row.latest_version,
    },
    result: {
      ...result,
      persistContent: result.status === "extracted",
    },
    body: new Uint8Array(row.body),
  });
}

export async function assertEvidenceBaseline(
  connection: Queryable,
  noticeId: string,
  expectedRevision: number,
) {
  const result = await connection.query(
    "SELECT evidence_revision,evidence_state FROM ingestion_notices WHERE id=$1",
    [noticeId],
  );
  const row = result.rows[0];
  if (
    !row ||
    Number(row.evidence_revision) !== expectedRevision ||
    row.evidence_state !== "current"
  )
    throw new Error("附件证据已变化或需要核对");
  return { evidenceRevision: Number(row.evidence_revision) };
}

export async function readCurrentEvidence(pool: Queryable, noticeId: string) {
  const result = await pool.query(
    `SELECT n.evidence_revision,n.evidence_state,
            COALESCE(jsonb_agg(jsonb_build_object('attachmentId',a.id,'versionId',v.id,
              'sha256',v.sha256,'status',v.status) ORDER BY a.id)
              FILTER (WHERE a.id IS NOT NULL),'[]'::jsonb) AS attachments
       FROM ingestion_notices n LEFT JOIN ingestion_attachments a ON a.notice_id=n.id
       LEFT JOIN ingestion_attachment_versions v ON v.id=a.latest_version
      WHERE n.id=$1 GROUP BY n.id`,
    [noticeId],
  );
  return result.rows[0] ?? null;
}

export async function cleanupAttachmentBodies(pool: Pool, days = 30) {
  if (!Number.isInteger(days) || days < 1 || days > 365)
    throw new Error("附件字节保留天数须为 1–365");
  const result = await pool.query(
    "UPDATE ingestion_attachment_versions SET body=NULL WHERE body IS NOT NULL AND fetched_at < now()-($1 * interval '1 day')",
    [days],
  );
  return { removed: result.rowCount };
}
