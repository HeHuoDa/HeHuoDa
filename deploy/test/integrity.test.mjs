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
