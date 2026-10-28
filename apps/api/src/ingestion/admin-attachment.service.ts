import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  type BeforeApplicationShutdown,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "../database/database.service.js";
import type { AdminContext } from "../admin/admin.service.js";
import { AdminIngestionOperation } from "./admin-ingestion-operation.js";
import type {
  AttachmentCommandDto,
  IngestionPageQueryDto,
} from "./admin-ingestion.dto.js";

const SAFE_SEGMENT_CHARS = 40_000;
interface AttachmentRequestRow {
  id: string;
  attachment_id: string;
  version_id: string | null;
  operation: "recheck" | "reparse";
  expected_evidence_revision: number;
}

@Injectable()
export class AdminAttachmentService implements BeforeApplicationShutdown {
  private readonly stop = new AbortController();
  private active: Promise<void> | null = null;
  constructor(
    private readonly database: DatabaseService,
    private readonly commands: AdminIngestionOperation,
  ) {}

  async listForNotice(noticeId: string) {
    const result = await this.database.pool.query(
      `SELECT a.id AS "attachmentId",a.notice_id AS "noticeId",a.canonical_url AS url,
        a.state,a.last_checked_at AS "lastCheckedAt",a.latest_version AS "latestVersion",
        v.revision,v.sha256,v.media_type AS "mediaType",v.status AS "extractionStatus",COALESCE(a.error_code,v.error_code) AS "errorCode",
        n.evidence_revision AS "evidenceRevision",n.evidence_state AS "evidenceState"
       FROM ingestion_notices n LEFT JOIN ingestion_attachments a ON a.notice_id=n.id
       LEFT JOIN ingestion_attachment_versions v ON v.id=a.latest_version
       WHERE n.id=$1 ORDER BY a.canonical_url,a.id`,
      [noticeId],
    );
    if (!result.rowCount) throw new NotFoundException();
    return {
      noticeId,
      evidenceRevision: result.rows[0]!.evidenceRevision,
      evidenceState: result.rows[0]!.evidenceState,
      items: result.rows.filter((row) => row.attachmentId),
    };
  }

  async versions(attachmentId: string, query: IngestionPageQueryDto) {
    const exists = await this.database.pool.query(
      "SELECT id FROM ingestion_attachments WHERE id=$1",
      [attachmentId],
    );
    if (!exists.rowCount) throw new NotFoundException();
    const [count, versions] = await Promise.all([
      this.database.pool.query<{ total: string }>(
        "SELECT count(*) AS total FROM ingestion_attachment_versions WHERE attachment_id=$1",
        [attachmentId],
      ),
      this.database.pool.query(
        `SELECT id AS "versionId",previous_version AS "previousVersion",revision,sha256,fetched_at AS "fetchedAt",
          media_type AS "mediaType",extractor_version AS "extractorVersion",status,error_code AS "errorCode"
         FROM ingestion_attachment_versions WHERE attachment_id=$1 ORDER BY revision DESC,id
         LIMIT $2 OFFSET $3`,
        [attachmentId, query.pageSize, (query.page - 1) * query.pageSize],
      ),
    ]);
    return {
      items: versions.rows.map((row) => ({
        ...row,
        fetchedAt: row.fetchedAt.toISOString(),
      })),
      total: Number(count.rows[0]!.total),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async versionText(
    attachmentId: string,
    versionId: string,
    query: IngestionPageQueryDto,
  ) {
    const offset = (query.page - 1) * query.pageSize;
    const result = await this.database.pool.query(
      `SELECT v.id AS "versionId",v.previous_version AS "previousVersion",v.revision,v.sha256,v.fetched_at AS "fetchedAt",
        v.media_type AS "mediaType",v.extractor_version AS "extractorVersion",v.status,v.error_code AS "errorCode",
        jsonb_array_length(v.segments) AS "totalSegments",
        COALESCE((SELECT jsonb_agg(x.segment ORDER BY x.position) FROM (
          SELECT segment,position FROM jsonb_array_elements(v.segments) WITH ORDINALITY AS e(segment,position)
          WHERE position > $3 AND position <= $3 + $4 ORDER BY position
        ) x),'[]'::jsonb) AS segments
       FROM ingestion_attachment_versions v WHERE v.id=$1 AND v.attachment_id=$2`,
      [versionId, attachmentId, offset, query.pageSize],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException();
    const segments = (
      row.segments as { kind: string; index: number; text: string }[]
    ).map((segment) => ({
      ...segment,
      text: segment.text.slice(0, SAFE_SEGMENT_CHARS),
      truncated: segment.text.length > SAFE_SEGMENT_CHARS,
    }));
    return {
      versionId: row.versionId,
      previousVersion: row.previousVersion,
      revision: row.revision,
      sha256: row.sha256,
      fetchedAt: row.fetchedAt.toISOString(),
      mediaType: row.mediaType,
      extractorVersion: row.extractorVersion,
      status: row.status,
      errorCode: row.errorCode,
      segments,
      totalSegments: row.totalSegments,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  recheck(
    context: AdminContext,
    attachmentId: string,
    command: AttachmentCommandDto,
  ) {
    return this.enqueue(context, attachmentId, null, command, "recheck");
  }

  reparse(
    context: AdminContext,
    attachmentId: string,
    versionId: string,
    command: AttachmentCommandDto,
  ) {
    return this.enqueue(context, attachmentId, versionId, command, "reparse");
  }

  private enqueue(
    context: AdminContext,
    attachmentId: string,
    versionId: string | null,
    command: AttachmentCommandDto,
    operation: "recheck" | "reparse",
  ) {
    if (!Number.isSafeInteger(command.baseline) || command.baseline < 0)
      throw new BadRequestException();
    return this.commands
      .execute(
        context,
        command,
        {
          action: `ingestion.attachment.${operation}`,
          objectType: "attachment",
          objectId: attachmentId,
          reason: command.reason,
        },
        { operation, attachmentId, versionId, baseline: command.baseline },
        async (client) => {
          const row = (
            await client.query(
              `SELECT a.id,a.notice_id,a.latest_version,n.evidence_revision,n.evidence_state
           FROM ingestion_attachments a JOIN ingestion_notices n ON n.id=a.notice_id
           WHERE a.id=$1 FOR UPDATE OF n,a`,
              [attachmentId],
            )
          ).rows[0];
          if (!row) throw new NotFoundException();
          if (row.evidence_revision !== command.baseline)
            throw new ConflictException("附件证据基线已变化");
          if (operation === "reparse") {
            if (row.latest_version !== versionId)
              throw new ConflictException(
                "仅可重解析当前附件版本，需重新获取或查看历史证据",
              );
            const existing = await client.query(
              "SELECT id,body FROM ingestion_attachment_versions WHERE id=$1 AND attachment_id=$2 FOR UPDATE",
              [versionId, attachmentId],
            );
            if (!existing.rowCount) throw new NotFoundException();
            if (!existing.rows[0]!.body)
              throw new ConflictException("原始附件已清理，须重新获取");
          }
          const id = randomUUID();
          await client.query(
            `INSERT INTO ingestion_attachment_requests(id,actor_id,attachment_id,version_id,operation_id,operation,
            expected_evidence_revision,reason,status)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,'accepted')`,
            [
              id,
              context.id,
              attachmentId,
              versionId,
              command.operationId,
              operation,
              command.baseline,
              command.reason,
            ],
          );
          return { requestId: id, status: "accepted" as const };
        },
      )
      .catch((error: unknown) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "23505"
        )
          throw new ConflictException("已有附件任务正在执行");
        throw error;
      });
  }

  async requestDetail(context: AdminContext, requestId: string) {
    const row = (
      await this.database.pool.query(
        `SELECT id AS "requestId",attachment_id AS "attachmentId",version_id AS "versionId",operation,status,result,
        error_code AS "errorCode",created_at AS "createdAt",finished_at AS "finishedAt"
       FROM ingestion_attachment_requests WHERE id=$1 AND actor_id=$2`,
        [requestId, context.id],
      )
    ).rows[0];
    if (!row) throw new NotFoundException();
    return {
      ...row,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
    };
  }

  @Cron("*/2 * * * * *")
  async processAccepted() {
    if (
      process.env.NODE_ENV === "test" ||
      this.active ||
      this.stop.signal.aborted
    )
      return;
    this.active = this.drainOne().then(() => undefined);
    try {
      await this.active;
    } finally {
      this.active = null;
    }
  }

  async drainOne() {
    const lock = await this.database.pool.connect();
    let locked = false;
    let request: AttachmentRequestRow | undefined;
    try {
      locked = Boolean(
        (await lock.query("SELECT pg_try_advisory_lock(23007) AS locked"))
          .rows[0]?.locked,
      );
      if (!locked) {
        lock.release();
        return false;
      }
      // Recover a task left running by a process that exited while the session lock was released.
      await lock.query(
        "UPDATE ingestion_attachment_requests SET status='accepted',started_at=NULL WHERE status='running'",
      );
      await lock.query("BEGIN");
      request = (
        await lock.query<AttachmentRequestRow>(
          `SELECT * FROM ingestion_attachment_requests WHERE status='accepted' ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        )
      ).rows[0];
      if (!request) {
        await lock.query("COMMIT");
        await lock.query("SELECT pg_advisory_unlock(23007)");
        lock.release();
        return false;
      }
      const claimed = await lock.query(
        "UPDATE ingestion_attachment_requests SET status='running',started_at=now() WHERE id=$1 AND status='accepted'",
        [request.id],
      );
      if (!claimed.rowCount) {
        await lock.query("ROLLBACK");
        await lock.query("SELECT pg_advisory_unlock(23007)");
        lock.release();
        return false;
      }
      await lock.query("COMMIT");
    } catch (error) {
      await lock.query("ROLLBACK").catch(() => undefined);
      if (locked)
        await lock
          .query("SELECT pg_advisory_unlock(23007)")
          .catch(() => undefined);
      lock.release();
      throw error;
    }
    try {
      if (!request) return false;
      const { AttachmentRunner } = await import("./attachment-runner.js");
      try {
        const runner = new AttachmentRunner(this.database.pool);
        const result =
          request.operation === "recheck"
            ? await runner.recheck(
                request.attachment_id,
                request.expected_evidence_revision,
                this.stop.signal,
              )
            : await runner.reparse(
                request.attachment_id,
                request.version_id!,
                request.expected_evidence_revision,
                this.stop.signal,
              );
        await this.database.pool.query(
          "UPDATE ingestion_attachment_requests SET status='completed',result=$2,finished_at=now() WHERE id=$1",
          [request.id, JSON.stringify(result)],
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const errorCode = /基线|变化/.test(message)
          ? "STALE_BASELINE"
          : /清理|字节/.test(message)
            ? "REPARSE_BYTES_UNAVAILABLE"
            : "ATTACHMENT_OPERATION_FAILED";
        await this.database.pool.query(
          "UPDATE ingestion_attachment_requests SET status='failed',error_code=$2,finished_at=now() WHERE id=$1",
          [request.id, errorCode],
        );
      }
      return true;
    } finally {
      if (locked)
        await lock
          .query("SELECT pg_advisory_unlock(23007)")
          .catch(() => undefined);
      lock.release();
    }
  }

  async beforeApplicationShutdown() {
    this.stop.abort();
    await this.active;
  }
}
