import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Article } from "@hehuoda/sicau-connectors/notices";
import { readCatalog } from "../competitions/catalog.js";
import { ImportValidationError } from "../competitions/import.js";
import {
  applyReview,
  approveReview,
  exportReview,
  publishImported,
  saveReviewRevision,
  setReviewState,
  type ReviewFile,
} from "../ingestion/review.js";
import { commandHash, hash, transaction } from "../ingestion/store.js";
import { AdminIngestionOperation } from "../ingestion/admin-ingestion-operation.js";
import { DatabaseService } from "../database/database.service.js";
import type { AdminContext } from "./admin.service.js";
import type {
  AdminCandidateListQueryDto,
  AdminCandidateOperationsQueryDto,
  AdminNoticeListQueryDto,
  AdminReviewPageQueryDto,
  AdminReviewCommandDto,
  AdminReviewImportCommandDto,
  AdminReviewMaterialCommandDto,
  AdminReviewPublishCommandDto,
  AdminReviewQueryDto,
  AdminReviewStateCommandDto,
} from "./admin-review.dto.js";

type CandidateStatus = "pending" | "approved" | "rejected" | "imported";
type PreviewPurpose = "import" | "publish";

function reviewException(error: unknown): never {
  if (
    error instanceof BadRequestException ||
    error instanceof ConflictException ||
    error instanceof NotFoundException ||
    error instanceof UnprocessableEntityException
  )
    throw error;
  if (error instanceof ImportValidationError)
    throw new UnprocessableEntityException();
  const message = error instanceof Error ? error.message : "";
  if (message.includes("候选不存在") || message.includes("通知不存在"))
    throw new NotFoundException();
  if (
    /过期|已拒绝|已导入|已批准|须先|只有|不存在映射|冲突|变化|占用/.test(
      message,
    )
  )
    throw new ConflictException();
  if (
    error instanceof Error &&
    (error.name === "ValidationError" ||
      /无效|须填写|必须|须提供|正式来源|只读证据|来源元数据|持久化证据|未定义字段|审核文件|审核材料字段|正式差异基线|正式匹配建议|正文差异证据|不符|被改动|审核只能修改|人工核对日期|缺少必要字段|引用未知学院|引用不存在或跨届来源|指定学院范围不能为空|全校范围不能附指定学院|时间冲突须保留说明|开始晚于截止|发布必须有赛段/.test(
        message,
      ))
  )
    throw new UnprocessableEntityException();
  throw new InternalServerErrorException();
}

function safeArticle(value: Article): Article {
  return {
    title: value.title,
    publishedAt: value.publishedAt,
    text: value.text,
    paragraphs: value.paragraphs,
    attachments: value.attachments.map(({ title, url }) => ({ title, url })),
  };
}

function pageResult<T>(
  items: T[],
  total: string | number,
  page: number,
  pageSize: number,
) {
  return { items, total: Number(total), page, pageSize };
}

@Injectable()
export class AdminReviewService {
  constructor(
    private readonly commands: AdminIngestionOperation,
    private readonly database: DatabaseService,
  ) {}

  async listCandidates(query: AdminCandidateListQueryDto) {
    if (query.from && query.to && new Date(query.from) > new Date(query.to))
      throw new BadRequestException();
    return transaction(this.pool(), async (client) => {
      await client.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const values: unknown[] = [];
      const clauses: string[] = [];
      if (query.sourceId) {
        values.push(query.sourceId);
        clauses.push(`n.source_id=$${values.length}`);
      }
      if (query.status) {
        values.push(query.status);
        clauses.push(`c.status=$${values.length}`);
      }
      if (query.from) {
        values.push(query.from);
        clauses.push(`v.fetched_at >= $${values.length}::timestamptz`);
      }
      if (query.to) {
        values.push(query.to);
        clauses.push(`v.fetched_at <= $${values.length}::timestamptz`);
      }
      const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
      const count = await client.query<{ total: string }>(
        `SELECT count(*) AS total FROM ingestion_candidates c JOIN ingestion_notices n ON n.id=c.notice_id JOIN ingestion_versions v ON v.id=c.source_version${where}`,
        values,
      );
      const rows = await client.query(
        `SELECT c.id AS "candidateId",c.notice_id AS "noticeId",n.source_id AS "sourceId",n.url,n.final_url AS "finalUrl",c.source_version AS "sourceVersion",c.revision AS "candidateRevision",c.status,c.data,v.article,v.fetched_at AS "fetchedAt",m.competition_id AS "competitionId" FROM ingestion_candidates c JOIN ingestion_notices n ON n.id=c.notice_id JOIN ingestion_versions v ON v.id=c.source_version LEFT JOIN ingestion_mappings m ON m.candidate_id=c.id${where} ORDER BY v.fetched_at DESC,c.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, query.pageSize, (query.page - 1) * query.pageSize],
      );
      return pageResult(
        rows.rows.map((row) => ({ ...row, article: safeArticle(row.article) })),
        count.rows[0]!.total,
        query.page,
        query.pageSize,
      );
    });
  }

  async candidateDetail(candidateId: string) {
    return transaction(this.pool(), async (client) => {
      const review = await exportReview(client, candidateId);
      const row = await this.candidateRow(client, candidateId);
      const targetId = review.targetId;
      const catalog = await readCatalog(client);
      return {
        candidateId: row.candidateId,
        noticeId: row.noticeId,
        sourceId: row.sourceId,
        sourceVersion: row.sourceVersion,
        candidateRevision: row.candidateRevision,
        status: row.status,
        source: {
          id: row.sourceId,
          url: row.url,
          finalUrl: row.finalUrl,
          publisher: row.source.publisher,
          fetchedAt: row.fetchedAt.toISOString(),
          adapterVersion: row.adapterVersion,
          health: row.health,
        },
        article: safeArticle(row.article),
        candidate: row.data,
        mapping: row.competitionId
          ? { competitionId: row.competitionId }
          : null,
        formalBefore:
          catalog.competitions.find((item) => item.id === targetId) ?? null,
        baseline: this.stateBaseline(row),
        formalBaseline: review.baseline,
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  async listNotices(query: AdminNoticeListQueryDto) {
    if (query.from && query.to && new Date(query.from) > new Date(query.to))
      throw new BadRequestException();
    return transaction(this.pool(), async (client) => {
      await client.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const values: unknown[] = [];
      const clauses: string[] = [];
      if (query.sourceId) {
        values.push(query.sourceId);
        clauses.push(`n.source_id=$${values.length}`);
      }
      if (query.from) {
        values.push(query.from);
        clauses.push(`n.fetched_at >= $${values.length}::timestamptz`);
      }
      if (query.to) {
        values.push(query.to);
        clauses.push(`n.fetched_at <= $${values.length}::timestamptz`);
      }
      const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
      const count = await client.query<{ total: string }>(
        `SELECT count(*) AS total FROM ingestion_notices n${where}`,
        values,
      );
      const rows = await client.query(
        `SELECT n.id AS "noticeId",n.source_id AS "sourceId",n.url,n.final_url AS "finalUrl",n.latest_version AS "latestVersion",n.health,n.fetched_at AS "fetchedAt",v.revision,v.article,c.id AS "candidateId",c.status AS "candidateStatus" FROM ingestion_notices n LEFT JOIN ingestion_versions v ON v.id=n.latest_version LEFT JOIN ingestion_candidates c ON c.notice_id=n.id${where} ORDER BY n.fetched_at DESC,n.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, query.pageSize, (query.page - 1) * query.pageSize],
      );
      return pageResult(
        rows.rows.map((row) => ({
          ...row,
          article: row.article ? safeArticle(row.article) : null,
        })),
        count.rows[0]!.total,
        query.page,
        query.pageSize,
      );
    });
  }

  async noticeDetail(noticeId: string) {
    return transaction(this.pool(), async (client) => {
      const result = await client.query(
        `SELECT n.id AS "noticeId",n.source_id AS "sourceId",n.url,n.final_url AS "finalUrl",n.latest_version AS "latestVersion",n.health,n.fetched_at AS "fetchedAt",s.data AS source,v.revision,v.article,c.id AS "candidateId",c.status AS "candidateStatus",m.competition_id AS "competitionId" FROM ingestion_notices n JOIN ingestion_sources s ON s.id=n.source_id LEFT JOIN ingestion_versions v ON v.id=n.latest_version LEFT JOIN ingestion_candidates c ON c.notice_id=n.id LEFT JOIN ingestion_mappings m ON m.candidate_id=c.id WHERE n.id=$1`,
        [noticeId],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException();
      return {
        noticeId: row.noticeId,
        sourceId: row.sourceId,
        url: row.url,
        finalUrl: row.finalUrl,
        health: row.health,
        fetchedAt: row.fetchedAt.toISOString(),
        source: row.source,
        latestVersion: row.latestVersion
          ? { id: row.latestVersion, revision: row.revision }
          : null,
        article: row.article ? safeArticle(row.article) : null,
        candidate: row.candidateId
          ? {
              id: row.candidateId,
              status: row.candidateStatus,
              competitionId: row.competitionId,
            }
          : null,
      };
    });
  }

  async noticeVersions(noticeId: string, query: AdminReviewPageQueryDto) {
    return transaction(this.pool(), async (client) => {
      await client.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const exists = await client.query(
        "SELECT id FROM ingestion_notices WHERE id=$1",
        [noticeId],
      );
      if (!exists.rowCount) throw new NotFoundException();
      const count = await client.query<{ total: string }>(
        "SELECT count(*) AS total FROM ingestion_versions WHERE notice_id=$1",
        [noticeId],
      );
      const rows = await client.query(
        'SELECT id AS "versionId",revision,previous_version AS "previousVersion",body_hash AS "bodyHash",adapter_version AS "adapterVersion",fetched_at AS "fetchedAt",article FROM ingestion_versions WHERE notice_id=$1 ORDER BY revision DESC LIMIT $2 OFFSET $3',
        [noticeId, query.pageSize, (query.page - 1) * query.pageSize],
      );
      return pageResult(
        rows.rows.map((row) => ({
          ...row,
          fetchedAt: row.fetchedAt.toISOString(),
          article: safeArticle(row.article),
        })),
        count.rows[0]!.total,
        query.page,
        query.pageSize,
      );
    });
  }

  async noticeVersion(noticeId: string, versionId: string) {
    return transaction(this.pool(), async (client) => {
      const row = (
        await client.query(
          'SELECT id AS "versionId",revision,previous_version AS "previousVersion",body_hash AS "bodyHash",adapter_version AS "adapterVersion",fetched_at AS "fetchedAt",article FROM ingestion_versions WHERE id=$1 AND notice_id=$2',
          [versionId, noticeId],
        )
      ).rows[0];
      if (!row) throw new NotFoundException();
      const previous = row.previousVersion
        ? ((
            await client.query<{ article: Article }>(
              "SELECT article FROM ingestion_versions WHERE id=$1",
              [row.previousVersion],
            )
          ).rows[0]?.article ?? null)
        : null;
      const currentArticle = safeArticle(row.article);
      const previousArticle = previous ? safeArticle(previous) : null;
      return {
        ...row,
        fetchedAt: row.fetchedAt.toISOString(),
        article: currentArticle,
        previousArticle,
        differences: this.articleDifferences(previousArticle, currentArticle),
      };
    });
  }

  async review(candidateId: string, query: AdminReviewQueryDto) {
    try {
      return await exportReview(this.pool(), candidateId, query.targetId, {
        reuseApproved: true,
      });
    } catch (error) {
      return reviewException(error);
    }
  }

  async saveReview(
    context: AdminContext,
    candidateId: string,
    command: AdminReviewMaterialCommandDto,
  ) {
    return this.execute(
      context,
      candidateId,
      command,
      "candidate.review",
      { kind: "save-review", review: command.review },
      async (client) => {
        try {
          this.assertReviewTarget(candidateId, command.review);
          return await saveReviewRevision(
            client,
            command.review,
            context.id,
            command.reason,
          );
        } catch (error) {
          return reviewException(error);
        }
      },
    );
  }

  async approve(
    context: AdminContext,
    candidateId: string,
    command: AdminReviewMaterialCommandDto,
  ) {
    return this.execute(
      context,
      candidateId,
      command,
      "candidate.review",
      { kind: "approve", review: command.review },
      async (client) => {
        try {
          this.assertReviewTarget(candidateId, command.review);
          if (
            (await this.candidateRow(client, candidateId)).status === "imported"
          )
            throw new ConflictException();
          return await approveReview(client, command.review, context.id);
        } catch (error) {
          return reviewException(error);
        }
      },
    );
  }

  async reviewState(
    context: AdminContext,
    candidateId: string,
    state: "reject" | "reopen",
    command: AdminReviewStateCommandDto,
  ) {
    return this.execute(
      context,
      candidateId,
      command,
      "candidate.review",
      {
        state,
        sourceVersion: command.sourceVersion,
        candidateRevision: command.candidateRevision,
        baseline: command.baseline,
      },
      async (client) => {
        try {
          await this.assertSnapshot(client, candidateId, command);
          return await setReviewState(
            client,
            candidateId,
            state,
            context.id,
            command.reason,
          );
        } catch (error) {
          return reviewException(error);
        }
      },
    );
  }

  async importPreview(
    context: AdminContext,
    candidateId: string,
    command: AdminReviewMaterialCommandDto,
  ) {
    return this.execute(
      context,
      candidateId,
      command,
      "candidate.import",
      { kind: "import-preview", review: command.review },
      async (client) => {
        try {
          this.assertReviewTarget(candidateId, command.review);
          const result = await applyReview(client, command.review, context.id, {
            preview: true,
          });
          const file = command.review as unknown as ReviewFile;
          await this.storePreview(
            client,
            command.operationId,
            context.id,
            "import",
            file,
            result,
          );
          return { ...result, previewId: command.operationId };
        } catch (error) {
          return reviewException(error);
        }
      },
    );
  }

  async importReview(
    context: AdminContext,
    candidateId: string,
    command: AdminReviewImportCommandDto,
  ) {
    return this.execute(
      context,
      candidateId,
      command,
      "candidate.import",
      { kind: "import", command },
      async (client) => {
        try {
          this.assertReviewTarget(candidateId, command.review);
          const file = command.review as unknown as ReviewFile;
          await this.consumePreview(
            client,
            context,
            command.previewId,
            "import",
            candidateId,
            file,
          );
          if (
            file.formalBefore?.publication === "published" &&
            !command.confirmPublished
          )
            throw new ConflictException();
          const result = await applyReview(client, command.review, context.id, {
            confirmPublished: command.confirmPublished === true,
          });
          await this.markPreviewConsumed(client, command.previewId, context.id);
          return result;
        } catch (error) {
          return reviewException(error);
        }
      },
    );
  }

  async publishPreview(
    context: AdminContext,
    candidateId: string,
    command: AdminReviewStateCommandDto,
  ) {
    return this.execute(
      context,
      candidateId,
      command,
      "competition.publish",
      { kind: "publish-preview", command },
      async (client) => {
        try {
          const row = await this.assertPublishCandidate(
            client,
            candidateId,
            command,
          );
          const result = await publishImported(
            client,
            candidateId,
            context.id,
            command.baseline,
            { preview: true },
          );
          const mapping = await this.mapping(client, candidateId);
          const file = {
            candidateId,
            sourceVersion: row.sourceVersion,
            candidateRevision: row.candidateRevision,
            targetId: mapping.competitionId,
            baseline: command.baseline,
          };
          await client.query(
            "INSERT INTO ingestion_review_previews(id,actor_id,purpose,candidate_id,source_version,candidate_revision,target_id,baseline,review_hash,result) VALUES($1,$2,'publish',$3,$4,$5,$6,$7,$8,$9)",
            [
              command.operationId,
              context.id,
              candidateId,
              row.sourceVersion,
              row.candidateRevision,
              mapping.competitionId,
              command.baseline,
              commandHash(file),
              result,
            ],
          );
          return {
            ...result,
            previewId: command.operationId,
            targetId: mapping.competitionId,
          };
        } catch (error) {
          return reviewException(error);
        }
      },
    );
  }

  async publish(
    context: AdminContext,
    candidateId: string,
    command: AdminReviewPublishCommandDto,
  ) {
    if (!command.confirm) throw new BadRequestException();
    return this.execute(
      context,
      candidateId,
      command,
      "competition.publish",
      { kind: "publish", command },
      async (client) => {
        try {
          const row = await this.assertPublishCandidate(
            client,
            candidateId,
            command,
          );
          const mapping = await this.mapping(client, candidateId);
          const receipt = {
            candidateId,
            sourceVersion: row.sourceVersion,
            candidateRevision: row.candidateRevision,
            targetId: mapping.competitionId,
            baseline: command.baseline,
          };
          await this.consumeReceipt(
            client,
            command.previewId,
            context.id,
            "publish",
            receipt,
          );
          const result = await publishImported(
            client,
            candidateId,
            context.id,
            command.baseline,
            { confirmPublished: true },
          );
          await this.markPreviewConsumed(client, command.previewId, context.id);
          return result;
        } catch (error) {
          return reviewException(error);
        }
      },
    );
  }

  async candidateOperations(
    candidateId: string,
    query: AdminCandidateOperationsQueryDto,
  ) {
    return transaction(this.pool(), async (client) => {
      await client.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      await this.candidateRow(client, candidateId);
      const historySql = `SELECT id,source_version,candidate_revision,kind,reviewer,created_at,result->'summary' AS result
        FROM ingestion_operations WHERE candidate_id=$1
        UNION ALL
        SELECT 'revision:' || candidate_id || ':' || candidate_revision::text,source_version,candidate_revision,
          'revise',actor_id::text,created_at,
          jsonb_build_object('candidateId',candidate_id,'candidateRevision',candidate_revision,'targetId',target_id,
            'reason',reason,'batch',review->'batch','checkedAt',review->'checkedAt','resolution',review->'resolution')
        FROM ingestion_review_revisions WHERE candidate_id=$1`;
      const count = await client.query<{ total: string }>(
        `SELECT count(*) AS total FROM (${historySql}) history`,
        [candidateId],
      );
      const rows = await client.query(
        `SELECT id AS "operationId",source_version AS "sourceVersion",candidate_revision AS "candidateRevision",kind,reviewer,created_at AS "createdAt",result FROM (${historySql}) history ORDER BY created_at,id LIMIT $2 OFFSET $3`,
        [candidateId, query.pageSize, (query.page - 1) * query.pageSize],
      );
      return {
        ...pageResult(
          rows.rows.map((row) => ({
            ...row,
            createdAt: row.createdAt.toISOString(),
          })),
          count.rows[0]!.total,
          query.page,
          query.pageSize,
        ),
        candidateId,
      };
    });
  }

  private async execute<T>(
    context: AdminContext,
    candidateId: string,
    command: AdminReviewCommandDto,
    action: "candidate.review" | "candidate.import" | "competition.publish",
    payload: unknown,
    work: (client: PoolClient) => Promise<T>,
  ) {
    return this.commands.execute(
      context,
      command,
      {
        action,
        objectType:
          action === "competition.publish" ? "competition" : "candidate",
        objectId: candidateId,
        reason: command.reason,
      },
      payload,
      async (client) => {
        // Match CLI lock order before checking any snapshot or locking a preview receipt.
        await client.query("SELECT pg_advisory_xact_lock(22002)");
        const notice = await client.query(
          "SELECT n.id FROM ingestion_notices n JOIN ingestion_candidates c ON c.notice_id=n.id WHERE c.id=$1 FOR UPDATE OF n",
          [candidateId],
        );
        if (!notice.rowCount) throw new NotFoundException();
        await client.query(
          "SELECT id FROM ingestion_candidates WHERE id=$1 FOR UPDATE",
          [candidateId],
        );
        return work(client);
      },
    );
  }

  private pool() {
    return this.database.pool;
  }

  private assertReviewTarget(candidateId: string, value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new BadRequestException();
    if ((value as { candidateId?: unknown }).candidateId !== candidateId)
      throw new ConflictException();
    if (!("mappingBaseline" in value)) throw new UnprocessableEntityException();
  }

  private async candidateRow(client: PoolClient, candidateId: string) {
    const result = await client.query(
      `SELECT c.id AS "candidateId",c.notice_id AS "noticeId",n.source_id AS "sourceId",n.url,n.final_url AS "finalUrl",n.latest_version AS "latestVersion",n.health,n.fetched_at AS "noticeFetchedAt",c.source_version AS "sourceVersion",c.revision AS "candidateRevision",c.status,c.data,c.updated_at AS "updatedAt",v.article,v.adapter_version AS "adapterVersion",v.fetched_at AS "fetchedAt",s.data AS source,m.competition_id AS "competitionId" FROM ingestion_candidates c JOIN ingestion_notices n ON n.id=c.notice_id JOIN ingestion_versions v ON v.id=c.source_version JOIN ingestion_sources s ON s.id=n.source_id LEFT JOIN ingestion_mappings m ON m.candidate_id=c.id WHERE c.id=$1`,
      [candidateId],
    );
    if (!result.rows[0]) throw new NotFoundException();
    return result.rows[0];
  }

  private stateBaseline(row: {
    candidateId: string;
    sourceVersion: string;
    candidateRevision: number;
    status: CandidateStatus;
    competitionId: string | null;
  }) {
    return hash({
      candidateId: row.candidateId,
      sourceVersion: row.sourceVersion,
      candidateRevision: row.candidateRevision,
      status: row.status,
      competitionId: row.competitionId,
    });
  }

  private async assertSnapshot(
    client: PoolClient,
    candidateId: string,
    command: Pick<
      AdminReviewStateCommandDto,
      "sourceVersion" | "candidateRevision" | "baseline"
    >,
  ) {
    const row = await this.candidateRow(client, candidateId);
    if (
      row.sourceVersion !== command.sourceVersion ||
      row.latestVersion !== command.sourceVersion ||
      row.candidateRevision !== command.candidateRevision ||
      this.stateBaseline(row) !== command.baseline
    )
      throw new ConflictException();
    return row;
  }

  private async assertPublishCandidate(
    client: PoolClient,
    candidateId: string,
    command: Pick<
      AdminReviewStateCommandDto,
      "sourceVersion" | "candidateRevision"
    >,
  ) {
    const row = await this.candidateRow(client, candidateId);
    if (
      row.sourceVersion !== command.sourceVersion ||
      row.latestVersion !== command.sourceVersion ||
      row.candidateRevision !== command.candidateRevision ||
      row.status !== "imported"
    )
      throw new ConflictException();
    return row;
  }

  private async mapping(client: PoolClient, candidateId: string) {
    const row = (
      await client.query(
        'SELECT competition_id AS "competitionId" FROM ingestion_mappings WHERE candidate_id=$1',
        [candidateId],
      )
    ).rows[0];
    if (!row) throw new ConflictException();
    return row as { competitionId: string };
  }

  private async storePreview(
    client: PoolClient,
    id: string,
    actorId: string,
    purpose: PreviewPurpose,
    file: ReviewFile,
    result: unknown,
  ) {
    await client.query(
      "INSERT INTO ingestion_review_previews(id,actor_id,purpose,candidate_id,source_version,candidate_revision,target_id,baseline,review_hash,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        id,
        actorId,
        purpose,
        file.candidateId,
        file.sourceVersion,
        file.candidateRevision,
        file.targetId,
        file.baseline,
        commandHash(file),
        result,
      ],
    );
  }

  private async consumePreview(
    client: PoolClient,
    context: AdminContext,
    previewId: string,
    purpose: PreviewPurpose,
    candidateId: string,
    file: ReviewFile,
  ) {
    const row = (
      await client.query(
        'SELECT actor_id AS "actorId",purpose,candidate_id AS "candidateId",source_version AS "sourceVersion",candidate_revision AS "candidateRevision",target_id AS "targetId",baseline,review_hash AS "reviewHash",consumed_at AS "consumedAt" FROM ingestion_review_previews WHERE id=$1 FOR UPDATE',
        [previewId],
      )
    ).rows[0];
    if (
      !row ||
      row.actorId !== context.id ||
      row.purpose !== purpose ||
      row.candidateId !== candidateId ||
      row.sourceVersion !== file.sourceVersion ||
      row.candidateRevision !== file.candidateRevision ||
      row.targetId !== file.targetId ||
      row.baseline !== file.baseline ||
      row.reviewHash !== commandHash(file) ||
      row.consumedAt
    )
      throw new ConflictException();
  }

  private async consumeReceipt(
    client: PoolClient,
    previewId: string,
    actorId: string,
    purpose: PreviewPurpose,
    expected: {
      candidateId: string;
      sourceVersion: string;
      candidateRevision: number;
      targetId: string;
      baseline: string;
    },
  ) {
    const row = (
      await client.query(
        'SELECT actor_id AS "actorId",purpose,candidate_id AS "candidateId",source_version AS "sourceVersion",candidate_revision AS "candidateRevision",target_id AS "targetId",baseline,review_hash AS "reviewHash",consumed_at AS "consumedAt" FROM ingestion_review_previews WHERE id=$1 FOR UPDATE',
        [previewId],
      )
    ).rows[0];
    if (
      !row ||
      row.actorId !== actorId ||
      row.purpose !== purpose ||
      row.candidateId !== expected.candidateId ||
      row.sourceVersion !== expected.sourceVersion ||
      row.candidateRevision !== expected.candidateRevision ||
      row.targetId !== expected.targetId ||
      row.baseline !== expected.baseline ||
      row.reviewHash !== commandHash(expected) ||
      row.consumedAt
    )
      throw new ConflictException();
  }

  private async markPreviewConsumed(
    client: PoolClient,
    id: string,
    actorId: string,
  ) {
    await client.query(
      "UPDATE ingestion_review_previews SET consumed_at=now() WHERE id=$1 AND actor_id=$2 AND consumed_at IS NULL",
      [id, actorId],
    );
  }

  private articleDifferences(previous: Article | null, current: Article) {
    if (!previous) return [];
    const fields = [
      "title",
      "publishedAt",
      "text",
      "paragraphs",
      "attachments",
    ] as const;
    return fields.flatMap((field) =>
      commandHash(previous[field]) === commandHash(current[field])
        ? []
        : [{ field, previous: previous[field], current: current[field] }],
    );
  }
}
