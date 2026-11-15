import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUSINESS_COUNT_QUERIES,
  BUSINESS_CONTENT_QUERIES,
  INTEGRITY_QUERIES,
  RETAINED_BYTE_QUERIES,
  compareIntegrity,
  integrityScript,
  parseIntegrityOutput,
  readBusinessIntegrity,
} from "../integrity.mjs";

function scriptOutput(rows = {}) {
  return INTEGRITY_QUERIES.map(({ name, kind }) => {
    const value = rows[name];
    if (kind === "count")
      return `${name}=[{"count":${value === undefined ? 0 : value}}]`;
    return `${name}=${JSON.stringify(value === undefined ? [] : value)}`;
  }).join("\n");
}

test("business integrity summary covers human results, mappings and retained bytes", () => {
  for (const object of [
    "publishedCompetitions",
    "approvedCandidates",
    "importedCandidates",
    "reviewRevisions",
    "mappings",
    "attachmentVersionsWithBody",
    "attachmentBodyBytes",
    "rawResponseBytes",
  ])
    assert.ok(
      object in BUSINESS_COUNT_QUERIES,
      `${object} must be counted so a restore cannot silently drop it`,
    );
  for (const relation of [
    "candidateStates",
    "mappingRelations",
    "reviewRevisionKeys",
    "attachmentKeys",
    "evidenceStates",
  ])
    assert.ok(
      relation in BUSINESS_CONTENT_QUERIES,
      `${relation} must be compared by stable key`,
    );
  // 人工修正、批准文件、正式比赛内容与长期正文必须有内容摘要，
  // 否则「只改内容不改 ID/数量」的恢复缺陷会被误判为一致。
  for (const digest of [
    "candidateStates",
    "reviewRevisionKeys",
    "competitionDigests",
    "stageDigests",
    "trackDigests",
    "noticeDigests",
    "versionTextDigests",
    "attachmentSegmentDigests",
  ])
    assert.ok(
      digest in BUSINESS_CONTENT_QUERIES,
      `${digest} must carry a content digest`,
    );
  assert.match(BUSINESS_CONTENT_QUERIES.candidateStates, /data_digest/);
  assert.match(BUSINESS_CONTENT_QUERIES.candidateStates, /file_digest/);
  assert.match(BUSINESS_CONTENT_QUERIES.reviewRevisionKeys, /file_digest/);
  assert.match(BUSINESS_CONTENT_QUERIES.versionTextDigests, /article_digest/);
  assert.match(BUSINESS_CONTENT_QUERIES.versionTextDigests, /extracted_digest/);
  assert.deepEqual(Object.keys(RETAINED_BYTE_QUERIES).sort(), [
    "retainedAttachmentBodies",
    "retainedRawResponses",
  ]);
  // 每条查询都必须是只读 SELECT；恢复核对不得修改业务表。
  for (const { sql, name } of INTEGRITY_QUERIES) {
    assert.match(sql, /^\s*SELECT\b/i, name);
    assert.doesNotMatch(sql, /;\s*\S/, `${name} must be a single statement`);
  }
  // 稳定排序是「另一个容器恢复后逐行相等」的前提。
  for (const { sql, kind, name } of INTEGRITY_QUERIES)
    if (kind === "rows") assert.match(sql, /\bORDER BY\b/, name);
});

// 负向对照：只改人工内容与正式内容、ID 与行数完全不变，必须被检出。
test("comparison detects human and formal content edited without id churn", () => {
  const digest = (seed) => seed.repeat(64).slice(0, 64);
  const base = (overrides = {}) =>
    parseIntegrityOutput(
      scriptOutput({
        competitions: 1,
        publishedCompetitions: 1,
        reviewRevisions: 1,
        mappings: 1,
        competitionIds: [{ id: "alpha" }],
        publishedCompetitionIds: [{ id: "alpha" }],
        competitionDigests: [
          { id: "alpha", publication: "published", digest: digest("a") },
        ],
        stageDigests: [
          { stage_id: "s1", competition_id: "alpha", digest: digest("b") },
        ],
        trackDigests: [{ track_id: "t1", stage_id: "s1", digest: digest("c") }],
        noticeDigests: [{ id: "n1", digest: digest("d") }],
        candidateStates: [
          {
            id: "c1",
            status: "approved",
            revision: 1,
            source_version: "v1",
            reviewer: "reviewer-1",
            data_digest: digest("e"),
            file_digest: digest("f"),
          },
        ],
        reviewRevisionKeys: [
          {
            candidate_id: "c1",
            candidate_revision: 1,
            target_id: "alpha",
            file_digest: digest("1"),
          },
        ],
        versionTextDigests: [
          {
            id: "v1",
            article_digest: digest("2"),
            extracted_digest: digest("3"),
          },
        ],
        attachmentSegmentDigests: [{ id: "a1", segments_digest: digest("4") }],
        mappingRelations: [
          {
            candidate_id: "c1",
            competition_id: "alpha",
            stage_ids: '["s1"]',
            notice_ids: '["n1"]',
            track_ids: '["t1"]',
          },
        ],
        ...overrides,
      }),
    );

  assert.deepEqual(compareIntegrity(base(), base()), []);

  // 人工修正内容被改（ID、状态、审核人、行数全不变）。
  const editedCandidate = base({
    candidateStates: [
      {
        id: "c1",
        status: "approved",
        revision: 1,
        source_version: "v1",
        reviewer: "reviewer-1",
        data_digest: digest("9"),
        file_digest: digest("f"),
      },
    ],
  });
  assert.deepEqual(compareIntegrity(base(), editedCandidate), [
    { object: "candidateStates", kind: "content", beforeRows: 1, afterRows: 1 },
  ]);

  // 批准文件内容被改。
  const editedFile = base({
    candidateStates: [
      {
        id: "c1",
        status: "approved",
        revision: 1,
        source_version: "v1",
        reviewer: "reviewer-1",
        data_digest: digest("e"),
        file_digest: digest("8"),
      },
    ],
  });
  assert.deepEqual(
    compareIntegrity(base(), editedFile).map((item) => item.object),
    ["candidateStates"],
  );

  // 正式比赛内容被改（ID 与 publication 不变）。
  const editedCompetition = base({
    competitionDigests: [
      { id: "alpha", publication: "published", digest: digest("7") },
    ],
  });
  assert.deepEqual(
    compareIntegrity(base(), editedCompetition).map((item) => item.object),
    ["competitionDigests"],
  );

  // 长期正文被改（清理不得影响它）。
  const editedText = base({
    versionTextDigests: [
      {
        id: "v1",
        article_digest: digest("6"),
        extracted_digest: digest("3"),
      },
    ],
  });
  assert.deepEqual(
    compareIntegrity(base(), editedText).map((item) => item.object),
    ["versionTextDigests"],
  );
});

test("script keeps every query and stops on error", () => {
  const script = integrityScript();
  assert.match(script, /^\\set ON_ERROR_STOP on/);
  for (const { name } of INTEGRITY_QUERIES)
    assert.ok(script.includes(`'${name}='`), name);
  assert.equal(
    script.split("\n").filter(Boolean).length,
    INTEGRITY_QUERIES.length + 1,
  );
});

test("parse tolerates order but not missing results", () => {
  const summary = parseIntegrityOutput(scriptOutput({ mappings: 2 }));
  assert.equal(summary.counts.mappings, 2);
  assert.equal(summary.counts.colleges, 0);
  assert.deepEqual(summary.relations.mappingRelations, []);
  const run = () => scriptOutput({ competitions: 1 });
  const actual = readBusinessIntegrity("container", { docker: run });
  assert.equal(actual.counts.competitions, 1);
  assert.throws(
    () =>
      readBusinessIntegrity("container", {
        docker: () => 'colleges=[{"count":1}]\n',
      }),
    /缺少结果/,
  );
});

test("comparison reports counts and relation content separately", () => {
  const before = parseIntegrityOutput(
    scriptOutput({
      competitions: 1,
      mappings: 1,
      competitionIds: [{ id: "alpha" }],
      retainedAttachmentBodies: [
        {
          id: "a",
          sha256: "b".repeat(64),
          recovered_sha256: "b".repeat(64),
          bytes: 8,
        },
      ],
    }),
  );
  const same = parseIntegrityOutput(
    scriptOutput({
      competitions: 1,
      mappings: 1,
      competitionIds: [{ id: "alpha" }],
      retainedAttachmentBodies: [
        {
          id: "a",
          sha256: "b".repeat(64),
          recovered_sha256: "b".repeat(64),
          bytes: 8,
        },
      ],
    }),
  );
  assert.deepEqual(compareIntegrity(before, same), []);

  const dropped = parseIntegrityOutput(
    scriptOutput({ competitions: 1, mappings: 0 }),
  );
  assert.deepEqual(compareIntegrity(before, dropped), [
    { object: "mappings", kind: "count", before: 1, after: 0 },
    { object: "competitionIds", kind: "content", beforeRows: 1, afterRows: 0 },
    {
      object: "retainedAttachmentBodies",
      kind: "content",
      beforeRows: 1,
      afterRows: 0,
    },
  ]);

  const rehashed = parseIntegrityOutput(
    scriptOutput({
      competitions: 1,
      mappings: 1,
      competitionIds: [{ id: "alpha" }],
      retainedAttachmentBodies: [
        {
          id: "a",
          sha256: "b".repeat(64),
          recovered_sha256: "c".repeat(64),
          bytes: 8,
        },
      ],
    }),
  );
  assert.deepEqual(compareIntegrity(before, rehashed), [
    {
      object: "retainedAttachmentBodies",
      kind: "content",
      beforeRows: 1,
      afterRows: 1,
    },
  ]);
});
