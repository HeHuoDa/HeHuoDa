// 备份恢复后的业务完整性核对。
// pg_dump/pg_restore 成功只证明字节可读；阶段二还要求人工结果、映射、正式比赛与
// 保留期内附件字节没有丢失。这里生成一份稳定的业务摘要，用于恢复前后逐项比较。
// 摘要不包含连接串与密码：恢复容器使用独立凭据，摘要只覆盖业务数据。

/** 逐项计数的业务对象；新增对象必须同时体现在摘要与报告中。 */
export const BUSINESS_COUNT_QUERIES = {
  colleges: "SELECT count(*)::int AS count FROM colleges",
  competitions: "SELECT count(*)::int AS count FROM competitions",
  publishedCompetitions:
    "SELECT count(*)::int AS count FROM competitions WHERE publication='published'",
  stages: "SELECT count(*)::int AS count FROM stages",
  tracks: "SELECT count(*)::int AS count FROM tracks",
  notices: "SELECT count(*)::int AS count FROM notices",
  sources: "SELECT count(*)::int AS count FROM ingestion_sources",
  candidates: "SELECT count(*)::int AS count FROM ingestion_candidates",
  approvedCandidates:
    "SELECT count(*)::int AS count FROM ingestion_candidates WHERE status='approved'",
  importedCandidates:
    "SELECT count(*)::int AS count FROM ingestion_candidates WHERE status='imported'",
  reviewRevisions:
    "SELECT count(*)::int AS count FROM ingestion_review_revisions",
  operations: "SELECT count(*)::int AS count FROM ingestion_operations",
  mappings: "SELECT count(*)::int AS count FROM ingestion_mappings",
  attachments: "SELECT count(*)::int AS count FROM ingestion_attachments",
  attachmentVersions:
    "SELECT count(*)::int AS count FROM ingestion_attachment_versions",
  attachmentVersionsWithBody:
    "SELECT count(*)::int AS count FROM ingestion_attachment_versions WHERE body IS NOT NULL",
  attachmentBodyBytes:
    "SELECT COALESCE(sum(octet_length(body)),0)::bigint AS count FROM ingestion_attachment_versions WHERE body IS NOT NULL",
  attachmentEvents:
    "SELECT count(*)::int AS count FROM ingestion_attachment_events",
  rawResponses:
    "SELECT count(*)::int AS count FROM ingestion_versions WHERE raw_response IS NOT NULL",
  rawResponseBytes:
    "SELECT COALESCE(sum(octet_length(raw_response)),0)::bigint AS count FROM ingestion_versions WHERE raw_response IS NOT NULL",
};

/**
 * 稳定 ID 与关系抽样。排序键全部取主键或稳定列，不依赖写入顺序，
 * 因此同一数据在另一容器恢复后必须得到完全相同的行集合。
 */
export const BUSINESS_CONTENT_QUERIES = {
  competitionIds: "SELECT id FROM competitions ORDER BY id",
  publishedCompetitionIds:
    "SELECT id FROM competitions WHERE publication='published' ORDER BY id",
  candidateStates:
    "SELECT id,status,revision,source_version,COALESCE(reviewer,'') AS reviewer FROM ingestion_candidates ORDER BY id",
  mappingRelations:
    "SELECT candidate_id,competition_id,stage_ids::text AS stage_ids,notice_ids::text AS notice_ids,track_ids::text AS track_ids FROM ingestion_mappings ORDER BY candidate_id",
  reviewRevisionKeys:
    "SELECT candidate_id,candidate_revision,target_id FROM ingestion_review_revisions ORDER BY candidate_id,candidate_revision",
  operationKinds:
    "SELECT kind,count(*)::int AS total FROM ingestion_operations GROUP BY kind ORDER BY kind",
  attachmentKeys:
    "SELECT a.id,n.id AS notice_id,a.latest_version::text AS latest_version,COALESCE(v.sha256,'') AS sha256,COALESCE(v.status,'') AS status FROM ingestion_attachments a JOIN ingestion_notices n ON n.id=a.notice_id LEFT JOIN ingestion_attachment_versions v ON v.id=a.latest_version ORDER BY a.id",
  attachmentVersionKeys:
    "SELECT id::text AS id,attachment_id::text AS attachment_id,revision,COALESCE(sha256,'') AS sha256,status,COALESCE(error_code,'') AS error_code FROM ingestion_attachment_versions ORDER BY id",
  evidenceStates:
    "SELECT id,evidence_state,COALESCE(evidence_revision,0)::int AS evidence_revision FROM ingestion_notices ORDER BY id",
};

/**
 * 保留期内原始字节哈希。只对 cleanupAttachmentBodies/cleanupResponses
 * 尚未清理的行计算，与 30 天保留边界使用同一个「仍在库内」的判据。
 */
export const RETAINED_BYTE_QUERIES = {
  retainedAttachmentBodies:
    "SELECT id::text AS id,COALESCE(sha256,'') AS sha256,encode(sha256(body),'hex') AS recovered_sha256,octet_length(body)::int AS bytes FROM ingestion_attachment_versions WHERE body IS NOT NULL ORDER BY id",
  retainedRawResponses:
    "SELECT id,encode(sha256(raw_response),'hex') AS recovered_sha256,octet_length(raw_response)::int AS bytes FROM ingestion_versions WHERE raw_response IS NOT NULL ORDER BY id",
};

/** 一次核对需要的全部查询；按固定顺序执行，任何一项失败都中止。 */
export const INTEGRITY_QUERIES = [
  ...Object.entries(BUSINESS_COUNT_QUERIES).map(([name, sql]) => ({
    name,
    kind: "count",
    sql,
  })),
  ...Object.entries(BUSINESS_CONTENT_QUERIES).map(([name, sql]) => ({
    name,
    kind: "rows",
    sql,
  })),
  ...Object.entries(RETAINED_BYTE_QUERIES).map(([name, sql]) => ({
    name,
    kind: "rows",
    sql,
  })),
];

export function integrityScript() {
  // ON_ERROR_STOP 用 \set 设置：psql 的非交互模式下命令行变量的合法写法是
  // --set=NAME=VALUE；脚本内设置可避免不同客户端版本的参数解析差异。
  return ["\\set ON_ERROR_STOP on"]
    .concat(
      INTEGRITY_QUERIES.map(
        ({ name, sql }) =>
          `SELECT '${name}=' || coalesce(json_agg(row_to_json(t)),'[]'::json) FROM (${sql}) t;`,
      ),
    )
    .join("\n")
    .concat("\n");
}

function ordered(row) {
  const result = {};
  for (const key of Object.keys(row).sort()) result[key] = row[key];
  return result;
}

/**
 * 在给定容器里执行核对 SQL 并返回可序列化的摘要。
 * 调用方负责创建隔离容器；这里只读取，不写入业务表。
 * 恢复容器使用独立的 restore 角色，采集源侧（如生产库）需显式传入自己的角色，
 * 否则会因角色不存在而失败，而不是静默返回空结果。
 */
export function readBusinessIntegrity(container, operations = {}) {
  const run = operations.docker;
  if (!run) throw new Error("readBusinessIntegrity requires a docker runner");
  const user = operations.user ?? "restore";
  const database = operations.database ?? "restore";
  if (typeof user !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(user))
    throw new Error("invalid integrity role name");
  if (
    typeof database !== "string" ||
    !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(database)
  )
    throw new Error("invalid integrity database name");
  const output = run(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      user,
      "-d",
      database,
      "-At",
      "--set=ON_ERROR_STOP=on",
    ],
    { input: integrityScript(), stdio: ["pipe", "pipe", "pipe"] },
  );
  const summary = parseIntegrityOutput(output);
  const missing = INTEGRITY_QUERIES.map(({ name }) => name).filter(
    (name) => !(name in summary.counts) && !(name in summary.relations),
  );
  if (missing.length)
    throw new Error("业务完整性查询缺少结果：" + missing.join(","));
  return summary;
}

/** 解析 psql -At 输出；未加引号的名字＝JSON 数组，一行一个对象。 */
export function parseIntegrityOutput(output) {
  const summary = { counts: {}, relations: {} };
  for (const line of String(output).split("\n")) {
    const text = line.trim();
    if (!text) continue;
    const separator = text.indexOf("=");
    if (separator < 1) continue;
    const name = text.slice(0, separator);
    const value = JSON.parse(text.slice(separator + 1));
    const query = INTEGRITY_QUERIES.find((item) => item.name === name);
    if (!query || !Array.isArray(value)) continue;
    if (query.kind === "count") summary.counts[name] = value[0]?.count ?? 0;
    else summary.relations[name] = value.map(ordered);
  }
  return summary;
}

/**
 * 比较恢复前后两份摘要，返回差异清单。空数组表示业务计数、稳定 ID 与关系、
 * 以及保留期内可恢复字节都一致。
 */
export function compareIntegrity(before, after) {
  const differences = [];
  const countKeys = new Set([
    ...Object.keys(before?.counts ?? {}),
    ...Object.keys(after?.counts ?? {}),
  ]);
  for (const key of [...countKeys].sort()) {
    const left = before?.counts?.[key];
    const right = after?.counts?.[key];
    if (left !== right)
      differences.push({
        object: key,
        kind: "count",
        before: left,
        after: right,
      });
  }
  const relationKeys = new Set([
    ...Object.keys(before?.relations ?? {}),
    ...Object.keys(after?.relations ?? {}),
  ]);
  for (const key of [...relationKeys].sort()) {
    const left = JSON.stringify(before?.relations?.[key] ?? null);
    const right = JSON.stringify(after?.relations?.[key] ?? null);
    if (left !== right)
      differences.push({
        object: key,
        kind: "content",
        beforeRows: before?.relations?.[key]?.length ?? null,
        afterRows: after?.relations?.[key]?.length ?? null,
      });
  }
  return differences;
}
