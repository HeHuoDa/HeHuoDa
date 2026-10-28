import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { readCatalog, type RecordData } from "../competitions/catalog.js";
import {
  applyImportBatch,
  validateInput,
  type ImportBatch,
  type ImportCompetition,
} from "../competitions/import.js";
import { publishedDate, type Article } from "@hehuoda/sicau-connectors/notices";
import { commandHash, hash, transaction, type CandidateRow } from "./store.js";

import type { ParsedCandidate } from "./types.js";

export interface ReviewFile {
  format: 1;
  operationId: string;
  candidateId: string;
  sourceVersion: string;
  candidateRevision: number;
  targetId: string;
  baseline: string;
  /** Snapshot of the ingestion mapping used for this review export. Omitted only by legacy CLI files. */
  mappingBaseline?: string;
  source: {
    id: string;
    url: string;
    finalUrl: string;
    publisher: string;
    fetchedAt: string;
    adapterVersion: string;
    health: string;
  };
  article: Article;
  previousArticle: Article | null;
  candidate: ParsedCandidate;
  mergeSuggestions: { id: string; name: string; edition: string }[];
  formalBefore: RecordData | null;
  batch: ImportBatch;
  checkedAt: string | null;
  resolution: string;
}
async function withReviewTransaction<T>(
  connection: Pool | PoolClient,
  work: (client: PoolClient) => Promise<T>,
  preview = false,
): Promise<T> {
  if (!("release" in connection))
    return transaction(connection as Pool, work, preview);
  const client = connection as PoolClient;
  if (!preview) return work(client);
  await client.query("SAVEPOINT admin_review_preview");
  try {
    const result = await work(client);
    await client.query("ROLLBACK TO SAVEPOINT admin_review_preview");
    await client.query("RELEASE SAVEPOINT admin_review_preview");
    return result;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT admin_review_preview");
    await client.query("RELEASE SAVEPOINT admin_review_preview");
    throw error;
  }
}
async function lockCandidate(client: PoolClient, id: string) {
  // 与采集落库采用通知 -> 候选的固定锁序；正式目录锁先于目录读取。
  const notice = await client.query(
    "SELECT n.*,v.article,v.adapter_version,v.fetched_at AS version_fetched_at,v.previous_version FROM ingestion_notices n JOIN ingestion_candidates c ON c.notice_id=n.id JOIN ingestion_versions v ON v.id=n.latest_version WHERE c.id=$1 FOR UPDATE OF n",
    [id],
  );
  const candidate = await client.query<CandidateRow>(
    "SELECT * FROM ingestion_candidates WHERE id=$1 FOR UPDATE",
    [id],
  );
  if (!notice.rowCount || !candidate.rowCount) throw new Error("候选不存在");
  return { notice: notice.rows[0], candidate: candidate.rows[0] };
}
function formalBaseline(
  catalog: Awaited<ReturnType<typeof readCatalog>>,
  targetId: string,
) {
  return hash({
    record: catalog.competitions.find((c) => c.id === targetId) ?? null,
    colleges: catalog.colleges,
  });
}
export async function exportReview(
  pool: Pool | PoolClient,
  candidateId: string,
  targetId?: string,
  options: { reuseApproved?: boolean } = {},
): Promise<ReviewFile> {
  return withReviewTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(22002)");
    const { notice, candidate } = await lockCandidate(client, candidateId);
    const mapping = (
      await client.query(
        "SELECT * FROM ingestion_mappings WHERE candidate_id=$1",
        [candidateId],
      )
    ).rows[0];
    const mappingBaseline = commandHash(
      mapping
        ? {
            candidateId: mapping.candidate_id,
            competitionId: mapping.competition_id,
            stageIds: mapping.stage_ids,
            noticeIds: mapping.notice_ids,
            trackIds: mapping.track_ids,
          }
        : null,
    );
    const saved = (
      await client.query<{ target_id: string; review: ReviewFile }>(
        "SELECT target_id,review FROM ingestion_review_revisions WHERE candidate_id=$1 AND candidate_revision=$2 AND source_version=$3 ORDER BY created_at DESC LIMIT 1",
        [candidateId, candidate.revision, candidate.source_version],
      )
    ).rows[0];
    const savedForTarget =
      saved && (!targetId || saved.target_id === targetId) ? saved : undefined;
    const id =
      targetId ??
      mapping?.competition_id ??
      savedForTarget?.target_id ??
      "notice-" + candidateId;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 100)
      throw new Error("目标届次 ID 无效");
    const catalog = await readCatalog(client);
    const before = catalog.competitions.find((c) => c.id === id) ?? null;
    const article: Article = notice.article;
    const source = (
      await client.query("SELECT data FROM ingestion_sources WHERE id=$1", [
        notice.source_id,
      ])
    ).rows[0].data;
    const noticeId =
      mapping?.competition_id === id
        ? mapping.notice_ids[0]
        : "source-" + candidateId + "-" + hash(id).slice(0, 12);
    const fields = candidate.data.fields;
    const patch: ImportCompetition = {
      id,
      notices: [
        {
          id: noticeId,
          title: article.title,
          publisher: source.publisher,
          url: notice.url,
          publishedAt: article.publishedAt,
          checkedAt: null,
          kind: fields.kind,
        },
      ],
    };
    if (!before)
      Object.assign(patch, {
        name: fields.name,
        edition: fields.edition ?? "",
        category: "",
        organizer: fields.organizer ?? "",
        origin: "official",
        publication: "draft",
        stages: [],
        tracks: [],
      });
    const previous = notice.previous_version
      ? ((
          await client.query(
            "SELECT article FROM ingestion_versions WHERE id=$1",
            [notice.previous_version],
          )
        ).rows[0]?.article ?? null)
      : null;
    const review: ReviewFile = {
      format: 1,
      operationId: randomUUID(),
      candidateId,
      sourceVersion: candidate.source_version,
      candidateRevision: candidate.revision,
      targetId: id,
      baseline: formalBaseline(catalog, id),
      mappingBaseline,
      source: {
        id: notice.source_id,
        url: notice.url,
        finalUrl: notice.final_url,
        publisher: source.publisher,
        fetchedAt: new Date(notice.version_fetched_at).toISOString(),
        adapterVersion: notice.adapter_version,
        health: notice.health,
      },
      article,
      previousArticle: previous,
      candidate: candidate.data,
      mergeSuggestions: catalog.competitions
        .filter(
          (c) => c.name.includes(fields.name) || fields.name.includes(c.name),
        )
        .map(({ id, name, edition }) => ({ id, name, edition })),
      formalBefore: before,
      batch: { competitions: [patch] },
      checkedAt: null,
      resolution: "",
    };
    if (savedForTarget) {
      review.batch = savedForTarget.review.batch;
      review.checkedAt = savedForTarget.review.checkedAt;
      review.resolution = savedForTarget.review.resolution;
    }
    const approved = candidate.approved_file as ReviewFile | null;
    if (
      options.reuseApproved &&
      candidate.status === "approved" &&
      approved &&
      approved.candidateId === candidateId &&
      approved.candidateRevision === candidate.revision &&
      approved.sourceVersion === candidate.source_version &&
      approved.targetId === id &&
      approved.baseline === review.baseline &&
      approved.mappingBaseline === review.mappingBaseline &&
      (
        [
          "source",
          "article",
          "previousArticle",
          "candidate",
          "mergeSuggestions",
          "formalBefore",
        ] as const
      ).every(
        (field) => commandHash(approved[field]) === commandHash(review[field]),
      )
    )
      return approved;
    return review;
  });
}
function validateReview(value: unknown): ReviewFile {
  if (!isRecord(value)) throw new Error("审核文件无效");
  const keys = [
    "format",
    "operationId",
    "candidateId",
    "sourceVersion",
    "candidateRevision",
    "targetId",
    "baseline",
    "source",
    "article",
    "previousArticle",
    "candidate",
    "mergeSuggestions",
    "formalBefore",
    "batch",
    "checkedAt",
    "resolution",
  ];
  if (
    keys.some((key) => !(key in value)) ||
    Object.keys(value).some(
      (key) => !keys.includes(key) && key !== "mappingBaseline",
    )
  )
    throw new Error("审核文件包含未定义字段");
  if (
    value.mappingBaseline !== undefined &&
    (typeof value.mappingBaseline !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.mappingBaseline))
  )
    throw new Error("审核文件映射基线无效");
  if (
    !isRecord(value.source) ||
    !isArticle(value.article) ||
    (value.previousArticle !== null && !isArticle(value.previousArticle)) ||
    !isParsedCandidate(value.candidate) ||
    !Array.isArray(value.mergeSuggestions) ||
    (value.formalBefore !== null && !isRecord(value.formalBefore)) ||
    !isRecord(value.batch)
  )
    throw new Error("审核文件结构无效");
  let batch: ImportBatch;
  try {
    batch = validateInput(value.batch);
  } catch {
    throw new Error("审核材料字段无效");
  }
  const file = value as unknown as ReviewFile;
  if (
    file.format !== 1 ||
    typeof file.operationId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      file.operationId,
    ) ||
    typeof file.candidateId !== "string" ||
    !file.candidateId ||
    typeof file.sourceVersion !== "string" ||
    !file.sourceVersion ||
    !Number.isInteger(file.candidateRevision) ||
    file.candidateRevision < 1 ||
    typeof file.baseline !== "string" ||
    !/^[a-f0-9]{64}$/.test(file.baseline) ||
    typeof file.targetId !== "string" ||
    !file.targetId
  )
    throw new Error("审核文件缺少版本基线");
  if (
    batch.colleges ||
    batch.competitions?.length !== 1 ||
    batch.competitions[0].id !== file.targetId
  )
    throw new Error("审核只能修改所导出目标届次，不支持更改学院目录");
  if (
    typeof file.checkedAt !== "string" ||
    !file.checkedAt ||
    !/^\d{4}-\d{2}-\d{2}$/.test(file.checkedAt) ||
    publishedDate(file.checkedAt) !== file.checkedAt ||
    typeof file.resolution !== "string" ||
    !file.resolution.trim()
  )
    throw new Error(
      "须填写人工 checkedAt 与 resolution，说明缺失、冲突及附件处理",
    );
  const patch = batch.competitions[0];
  if (
    !patch.notices?.some(
      (n) => n.url === file.source.url && n.checkedAt === file.checkedAt,
    )
  )
    throw new Error("正式来源须保留采集 URL 并填写人工核对日期");
  return file;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isArticle(value: unknown): value is Article {
  if (!isRecord(value)) return false;
  return (
    typeof value.title === "string" &&
    (value.publishedAt === null || typeof value.publishedAt === "string") &&
    typeof value.text === "string" &&
    Array.isArray(value.paragraphs) &&
    value.paragraphs.every((item) => typeof item === "string") &&
    Array.isArray(value.attachments) &&
    value.attachments.every(
      (item) =>
        isRecord(item) &&
        typeof item.title === "string" &&
        typeof item.url === "string",
    )
  );
}
function isParsedCandidate(value: unknown): value is ParsedCandidate {
  return (
    isRecord(value) &&
    isRecord(value.fields) &&
    Array.isArray(value.evidence) &&
    Array.isArray(value.missing) &&
    Array.isArray(value.conflicts) &&
    Array.isArray(value.warnings)
  );
}
async function checkBaseline(client: PoolClient, file: ReviewFile) {
  const { notice, candidate } = await lockCandidate(client, file.candidateId);
  if (
    notice.latest_version !== file.sourceVersion ||
    candidate.source_version !== file.sourceVersion ||
    candidate.revision !== file.candidateRevision
  )
    throw new Error("审核文件过期：来源版本或候选修订已变化，请重新导出审核");
  if (notice.url !== file.source.url || notice.source_id !== file.source.id)
    throw new Error("审核来源与持久化证据不符");
  if (file.mappingBaseline !== undefined) {
    const mapping = (
      await client.query(
        "SELECT candidate_id,competition_id,stage_ids,notice_ids,track_ids FROM ingestion_mappings WHERE candidate_id=$1",
        [file.candidateId],
      )
    ).rows[0];
    const mappingBaseline = commandHash(
      mapping
        ? {
            candidateId: mapping.candidate_id,
            competitionId: mapping.competition_id,
            stageIds: mapping.stage_ids,
            noticeIds: mapping.notice_ids,
            trackIds: mapping.track_ids,
          }
        : null,
    );
    if (mappingBaseline !== file.mappingBaseline)
      throw new Error("审核正式映射关系已变化，请重新导出审核");
  }
  const source = (
    await client.query("SELECT data FROM ingestion_sources WHERE id=$1", [
      notice.source_id,
    ])
  ).rows[0].data;
  const previous = notice.previous_version
    ? ((
        await client.query(
          "SELECT article FROM ingestion_versions WHERE id=$1",
          [notice.previous_version],
        )
      ).rows[0]?.article ?? null)
    : null;
  const expectedSource = {
    id: notice.source_id,
    url: notice.url,
    finalUrl: notice.final_url,
    publisher: source.publisher,
    fetchedAt: new Date(notice.version_fetched_at).toISOString(),
    adapterVersion: notice.adapter_version,
    health: notice.health,
  };
  if (
    commandHash(file.source) !== commandHash(expectedSource) ||
    commandHash(file.previousArticle) !== commandHash(previous)
  )
    throw new Error("审核文件的来源元数据或正文差异证据被改动，请重新导出");
  const catalog = await readCatalog(client);
  if (formalBaseline(catalog, file.targetId) !== file.baseline)
    throw new Error("审核文件过期：正式记录或关系已变化，请重新导出审核");
  const patch = file.batch.competitions![0];
  for (const field of ["stages", "notices", "tracks"] as const) {
    for (const item of patch[field] ?? []) {
      if (
        catalog.competitions.some(
          (record) =>
            record.id !== file.targetId &&
            record[field].some((existing) => existing.id === item.id),
        )
      )
        throw new Error("正式关系 ID 已占用，请重新导出审核");
    }
  }
  const before = catalog.competitions.find((c) => c.id === file.targetId);
  if (
    commandHash(file.formalBefore) !== commandHash(before ?? null) ||
    commandHash(file.article) !== commandHash(notice.article) ||
    commandHash(file.candidate) !== commandHash(candidate.data)
  )
    throw new Error("审核文件的只读证据或正式差异基线被改动，请重新导出");
  const expectedSuggestions = catalog.competitions
    .filter(
      (c) =>
        c.name.includes(candidate.data.fields.name) ||
        candidate.data.fields.name.includes(c.name),
    )
    .map(({ id, name, edition }) => ({ id, name, edition }));
  if (commandHash(file.mergeSuggestions) !== commandHash(expectedSuggestions))
    throw new Error("审核文件的正式匹配建议被改动，请重新导出");
  const publication = file.batch.competitions![0].publication;
  if (publication && publication !== (before?.publication ?? "draft"))
    throw new Error("审核导入须保持原发布状态；发布使用独立命令");
  if (candidate.status === "rejected")
    throw new Error("候选已拒绝，须显式重开后重新审核");
  return candidate;
}
function reviewerId(reviewer: string) {
  if (!reviewer?.trim() || reviewer.length > 100 || /[\r\n<>]/.test(reviewer))
    throw new Error("须提供有效维护者标识 --reviewer");
}
export async function saveReviewRevision(
  connection: Pool | PoolClient,
  input: unknown,
  reviewer: string,
  reason: string,
) {
  const file = validateReview(input);
  reviewerId(reviewer);
  if (!reason?.trim() || reason.length > 2000)
    throw new Error("须填写操作原因");
  return withReviewTransaction(connection, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(22002)");
    const candidate = await checkBaseline(client, file);
    if (candidate.status === "imported")
      throw new Error("已导入候选不能再修改审核材料");
    const revision = candidate.revision + 1;
    const saved: ReviewFile = {
      ...file,
      operationId: randomUUID(),
      candidateRevision: revision,
    };
    await client.query(
      "UPDATE ingestion_candidates SET status='pending',revision=$2,reviewer=NULL,checked_at=NULL,reason=NULL,approved_file=NULL,updated_at=now() WHERE id=$1",
      [file.candidateId, revision],
    );
    await client.query(
      "INSERT INTO ingestion_review_revisions(candidate_id,candidate_revision,source_version,target_id,review,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        file.candidateId,
        revision,
        file.sourceVersion,
        file.targetId,
        saved,
        reviewer,
        reason.trim(),
      ],
    );
    return {
      status: "pending",
      candidateId: file.candidateId,
      candidateRevision: revision,
      review: saved,
    };
  });
}
async function completed(
  client: PoolClient,
  operationId: string,
  inputHash: string,
) {
  const row = (
    await client.query("SELECT * FROM ingestion_operations WHERE id=$1", [
      operationId,
    ])
  ).rows[0];
  if (row && row.input_hash !== inputHash)
    throw new Error("同一操作 ID 的内容已改变，须重新导出");
  return row?.result.summary;
}
async function logOperation(
  client: PoolClient,
  file: Pick<ReviewFile, "candidateId" | "sourceVersion" | "candidateRevision">,
  id: string,
  kind: string,
  reviewer: string,
  inputHash: string,
  result: unknown,
) {
  await client.query(
    "INSERT INTO ingestion_operations(id,candidate_id,source_version,candidate_revision,kind,reviewer,input_hash,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      id,
      file.candidateId,
      file.sourceVersion,
      file.candidateRevision,
      kind,
      reviewer,
      inputHash,
      { summary: result, review: file },
    ],
  );
}
export async function approveReview(
  pool: Pool | PoolClient,
  input: unknown,
  reviewer: string,
) {
  const file = validateReview(input);
  reviewerId(reviewer);
  return withReviewTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(22002)");
    const inputHash = hash({ file, reviewer }),
      operationId = file.operationId + ":approve";
    const done = await completed(client, operationId, inputHash);
    if (done) return done;
    await checkBaseline(client, file);
    // 使用同一导入校验及数据库约束，保存点回滚预览写入。
    await client.query("SAVEPOINT review_preview");
    const preview = await applyImportBatch(client, file.batch, {
      preview: true,
      production: process.env.NODE_ENV === "production",
    });
    await client.query("ROLLBACK TO SAVEPOINT review_preview");
    await client.query(
      "UPDATE ingestion_candidates SET status='approved',reviewer=$2,checked_at=$3,approved_file=$4,reason=$5,updated_at=now() WHERE id=$1",
      [file.candidateId, reviewer, file.checkedAt, file, file.resolution],
    );
    const result = {
      status: "approved",
      candidateId: file.candidateId,
      preview,
    };
    await logOperation(
      client,
      file,
      operationId,
      "approve",
      reviewer,
      inputHash,
      result,
    );
    return result;
  });
}
export async function applyReview(
  pool: Pool | PoolClient,
  input: unknown,
  reviewer: string,
  options: { preview?: boolean; confirmPublished?: boolean } = {},
) {
  const file = validateReview(input);
  reviewerId(reviewer);
  return withReviewTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(22002)");
    const inputHash = hash({ file, reviewer }),
      operationId = file.operationId + ":import";
    const done = await completed(client, operationId, inputHash);
    if (done) return done;
    const candidate = await checkBaseline(client, file);
    if (
      candidate.status !== "approved" ||
      commandHash(candidate.approved_file) !== commandHash(file)
    )
      throw new Error("须先审核通过，且不能更改已批准文件");
    if (
      file.formalBefore?.publication === "published" &&
      !options.preview &&
      !(await completed(client, file.operationId + ":preview", inputHash))
    )
      throw new Error("已发布更新须先显式 --preview，再 --confirm-published");
    if (options.preview) await client.query("SAVEPOINT application_preview");
    const result = await applyImportBatch(client, file.batch, {
      ...options,
      production: process.env.NODE_ENV === "production",
    });
    if (options.preview) {
      await client.query("ROLLBACK TO SAVEPOINT application_preview");
      if (!(await completed(client, file.operationId + ":preview", inputHash)))
        await logOperation(
          client,
          file,
          file.operationId + ":preview",
          "preview",
          reviewer,
          inputHash,
          result,
        );
    }
    if (!options.preview) {
      const patch = file.batch.competitions![0];
      await client.query(
        "INSERT INTO ingestion_mappings(candidate_id,competition_id,stage_ids,notice_ids,track_ids) VALUES($1,$2,$3,$4,$5) ON CONFLICT(candidate_id) DO UPDATE SET competition_id=EXCLUDED.competition_id,stage_ids=EXCLUDED.stage_ids,notice_ids=EXCLUDED.notice_ids,track_ids=EXCLUDED.track_ids",
        [
          file.candidateId,
          file.targetId,
          JSON.stringify(patch.stages?.map((s) => s.id) ?? []),
          JSON.stringify(patch.notices?.map((n) => n.id) ?? []),
          JSON.stringify(patch.tracks?.map((t) => t.id) ?? []),
        ],
      );
      await client.query(
        "UPDATE ingestion_candidates SET status='imported',updated_at=now() WHERE id=$1",
        [file.candidateId],
      );
      await logOperation(
        client,
        file,
        operationId,
        "import",
        reviewer,
        inputHash,
        result,
      );
    }
    return result;
  });
}
export async function setReviewState(
  pool: Pool | PoolClient,
  candidateId: string,
  state: "reject" | "reopen",
  reviewer: string,
  reason: string,
) {
  reviewerId(reviewer);
  if (!reason?.trim() || reason.length > 2000)
    throw new Error("须填写操作原因");
  return withReviewTransaction(pool, async (client) => {
    const { candidate } = await lockCandidate(client, candidateId);
    const repeated = (
      await client.query(
        "SELECT result FROM ingestion_operations WHERE candidate_id=$1 AND candidate_revision=$2 AND kind=$3 AND reviewer=$4 AND input_hash=$5",
        [
          candidateId,
          candidate.revision,
          state,
          reviewer,
          hash({ reason, revision: candidate.revision }),
        ],
      )
    ).rows[0];
    if (repeated) return repeated.result.summary;
    if (
      state === "reject" &&
      !["pending", "approved"].includes(candidate.status)
    )
      throw new Error("只有待审核或已批准候选可以拒绝；已导入候选保留正式映射");
    if (state === "reopen" && candidate.status !== "rejected")
      throw new Error("只有拒绝候选需要重开");
    const revision = candidate.revision + 1;
    await client.query(
      "UPDATE ingestion_candidates SET status=$2,revision=$3,reviewer=$4,reason=$5,approved_file=NULL,updated_at=now() WHERE id=$1",
      [
        candidateId,
        state === "reject" ? "rejected" : "pending",
        revision,
        reviewer,
        reason,
      ],
    );
    const result = {
      status: state === "reject" ? "rejected" : "pending",
      candidateRevision: revision,
      reason,
    };
    await logOperation(
      client,
      {
        candidateId,
        sourceVersion: candidate.source_version,
        candidateRevision: revision,
      },
      randomUUID(),
      state,
      reviewer,
      hash({ reason, revision }),
      result,
    );
    return result;
  });
}
export async function publishImported(
  pool: Pool | PoolClient,
  candidateId: string,
  reviewer: string,
  expectedBaseline: string,
  options: { preview?: boolean; confirmPublished?: boolean } = {},
) {
  reviewerId(reviewer);
  return withReviewTransaction(
    pool,
    async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(22002)");
      const { candidate } = await lockCandidate(client, candidateId);
      const operationId =
        "publish:" +
        candidateId +
        ":" +
        candidate.revision +
        ":" +
        expectedBaseline;
      const inputHash = hash({ reviewer, expectedBaseline });
      const done = await completed(client, operationId, inputHash);
      if (done) return done;
      if (candidate.status !== "imported")
        throw new Error("须先成功导入当前候选");
      const mapping = (
        await client.query(
          "SELECT * FROM ingestion_mappings WHERE candidate_id=$1",
          [candidateId],
        )
      ).rows[0];
      if (!mapping) throw new Error("缺少成功导入映射");
      const catalog = await readCatalog(client);
      if (formalBaseline(catalog, mapping.competition_id) !== expectedBaseline)
        throw new Error("发布基线过期，请重新导出审阅");
      const result = await applyImportBatch(
        client,
        {
          competitions: [
            { id: mapping.competition_id, publication: "published" },
          ],
        },
        { ...options, production: process.env.NODE_ENV === "production" },
      );
      if (!options.preview)
        await logOperation(
          client,
          {
            candidateId,
            sourceVersion: candidate.source_version,
            candidateRevision: candidate.revision,
          },
          operationId,
          "publish",
          reviewer,
          inputHash,
          result,
        );
      return result;
    },
    options.preview,
  );
}
