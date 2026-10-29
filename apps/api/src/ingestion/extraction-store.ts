import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  noticeRuleVersion,
  classificationPriority,
  type Classification,
  parseEvidenceCandidate,
  type Article,
  type RuleEvidenceInput,
} from "@hehuoda/sicau-connectors/notices";
import { hash } from "./store.js";

/** Caller owns transaction; always lock notice before candidate, including offline rule reruns. */
export async function refreshExtraction(
  client: PoolClient,
  noticeId: string,
  ruleVersion = noticeRuleVersion,
  revisionAlreadyChanged = false,
) {
  if (
    !(
      await client.query(
        "SELECT to_regclass('ingestion_extraction_revisions') IS NOT NULL AS ready",
      )
    ).rows[0].ready
  )
    return;
  const notice = (
    await client.query(
      "SELECT n.*,v.article FROM ingestion_notices n JOIN ingestion_versions v ON v.id=n.latest_version WHERE n.id=$1 FOR UPDATE OF n",
      [noticeId],
    )
  ).rows[0];
  if (!notice) return;
  const candidate = (
    await client.query(
      "SELECT * FROM ingestion_candidates WHERE notice_id=$1 FOR UPDATE",
      [noticeId],
    )
  ).rows[0];
  if (!candidate) return;
  const extractionKey = hash({
    sourceVersion: notice.latest_version,
    evidenceRevision: notice.evidence_revision,
    ruleVersion,
  });
  if (candidate.extraction_key === extractionKey) return;
  const attachments = (
    await client.query(
      `SELECT a.canonical_url,v.id,v.notice_version,v.media_type,v.segments
    FROM ingestion_attachments a JOIN ingestion_attachment_versions v ON v.id=a.latest_version
    WHERE a.notice_id=$1 AND a.state='extracted' AND v.status='extracted' ORDER BY a.canonical_url,a.id`,
      [noticeId],
    )
  ).rows;
  const directory = (
    await client.query("SELECT id,name FROM colleges ORDER BY id")
  ).rows;
  const data = parseEvidenceCandidate(
    notice.article as Article,
    notice.url,
    directory,
    notice.latest_version,
    attachments.map((row) => ({
      format: row.media_type === "application/pdf" ? "pdf" : "docx",
      url: row.canonical_url,
      noticeVersion: row.notice_version,
      attachmentVersion: row.id,
      segments: row.segments,
    })) as RuleEvidenceInput[],
  );
  data.classification!.ruleVersion = ruleVersion;
  const prior = (
    await client.query(
      "SELECT source_version,evidence_revision,rule_version FROM ingestion_extraction_revisions WHERE candidate_id=$1 AND extraction_key=$2",
      [candidate.id, candidate.extraction_key],
    )
  ).rows[0];
  const sameEvidence =
    prior?.rule_version === ruleVersion &&
    prior?.source_version === notice.latest_version &&
    Number(prior?.evidence_revision) === Number(notice.evidence_revision);
  const override = sameEvidence ? candidate.classification_override : null;
  const classification = override ?? data.classification!.classification;
  const priority = classificationPriority(
    classification as Classification,
    data.fields.kind,
  );
  await client.query(
    `INSERT INTO ingestion_extraction_revisions(id,candidate_id,source_version,evidence_revision,rule_version,extraction_key,data)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(candidate_id,extraction_key) DO NOTHING`,
    [
      randomUUID(),
      candidate.id,
      notice.latest_version,
      notice.evidence_revision,
      ruleVersion,
      extractionKey,
      data,
    ],
  );
  // Historic manual review rows are retained; only their current approval becomes invalid.
  await client.query(
    `UPDATE ingestion_candidates SET data=$2,classification=$3,rule_version=$4,extraction_key=$5,
    classification_override=$6,needs_review=$7,priority=$8,revision=revision+$9,status='pending',
    reviewer=NULL,checked_at=NULL,approved_file=NULL,updated_at=now() WHERE id=$1`,
    [
      candidate.id,
      data,
      classification,
      ruleVersion,
      extractionKey,
      override,
      classification !== "non_competition",
      priority,
      revisionAlreadyChanged ? 0 : 1,
    ],
  );
  return data;
}
