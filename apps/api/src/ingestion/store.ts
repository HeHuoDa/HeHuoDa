import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  type Article,
  type FetchResult,
  sources,
  type Source,
  BoundedFetcher,
  defaultLimits,
} from "@hehuoda/sicau-connectors/notices";
import type { ParsedCandidate } from "./types.js";
import { digestInput } from "./types.js";

export const hash = (value: unknown) =>
  createHash("sha256").update(digestInput(value)).digest("hex");

// HTTP commands preserve array order; historical ingestion digests keep their existing semantics.
export function commandHash(value: unknown): string {
  const canonical = (entry: unknown): unknown =>
    Array.isArray(entry)
      ? entry.map(canonical)
      : entry && typeof entry === "object"
        ? Object.fromEntries(
            Object.entries(entry)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, canonical(item)]),
          )
        : entry;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export async function transaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
  preview = false,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query(preview ? "ROLLBACK" : "COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function initializeSources(pool: Pool) {
  for (const source of sources)
    await pool.query(
      "INSERT INTO ingestion_sources(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data",
      [source.id, source],
    );
}
export interface CandidateRow {
  id: string;
  notice_id: string;
  source_version: string;
  revision: number;
  status: string;
  data: ParsedCandidate;
  reviewer: string | null;
  checked_at: string | null;
  approved_file: unknown;
}
export async function configureSource(
  pool: Pick<PoolClient, "query">,
  source: Source,
  enabled: boolean,
  settings: Record<string, number>,
) {
  const current =
    (
      await pool.query("SELECT settings FROM ingestion_sources WHERE id=$1", [
        source.id,
      ])
    ).rows[0]?.settings ?? {};
  const next = {
    ...defaultLimits,
    maxPages: 10,
    frequencyMinutes: 60,
    ...current,
    ...settings,
  };
  if (
    !Number.isInteger(next.maxPages) ||
    next.maxPages < 1 ||
    next.maxPages > 10 ||
    !Number.isInteger(next.frequencyMinutes) ||
    next.frequencyMinutes < 1 ||
    next.frequencyMinutes > 1440
  )
    throw new Error("来源页数或频率超出边界");
  new BoundedFetcher(source, next);
  await pool.query(
    "UPDATE ingestion_sources SET enabled=$2,settings=$3 WHERE id=$1",
    [source.id, enabled, next],
  );
  return { sourceId: source.id, enabled, settings: next };
}
export async function recoverInterruptedRuns(pool: Pool) {
  const client = await pool.connect();
  let count = 0;
  try {
    for (const source of sources) {
      const locked = (
        await client.query(
          "SELECT pg_try_advisory_lock(23001,hashtext($1)) AS locked",
          [source.id],
        )
      ).rows[0].locked;
      if (!locked) continue;
      try {
        count +=
          (
            await client.query(
              "UPDATE ingestion_runs SET status='interrupted',finished_at=now() WHERE source_id=$1 AND status='running'",
              [source.id],
            )
          ).rowCount ?? 0;
      } finally {
        await client.query("SELECT pg_advisory_unlock(23001,hashtext($1))", [
          source.id,
        ]);
      }
    }
  } finally {
    client.release();
  }
  return { interrupted: count };
}
export async function persistArticle(
  pool: Pool,
  source: Source,
  url: string,
  response: FetchResult,
  article: Article,
  parsed: ParsedCandidate,
) {
  return transaction(pool, async (client) => {
    const bodyHash = hash(article);
    const found = await client.query(
      "SELECT n.*,v.body_hash,v.adapter_version,v.revision FROM ingestion_notices n LEFT JOIN ingestion_versions v ON v.id=n.latest_version WHERE n.source_id=$1 AND n.url=$2 FOR UPDATE OF n",
      [source.id, url],
    );
    const previous = found.rows[0];
    const noticeId: string = previous?.id ?? randomUUID();
    await client.query(
      "INSERT INTO ingestion_notices(id,source_id,url,final_url,fetched_at,etag,last_modified,health) VALUES($1,$2,$3,$4,now(),$5,$6,'available') ON CONFLICT(source_id,url) DO UPDATE SET final_url=EXCLUDED.final_url,fetched_at=EXCLUDED.fetched_at,etag=EXCLUDED.etag,last_modified=EXCLUDED.last_modified,health='available'",
      [
        noticeId,
        source.id,
        url,
        response.url,
        response.headers.etag ?? null,
        response.headers["last-modified"] ?? null,
      ],
    );
    if (
      previous?.body_hash === bodyHash &&
      previous?.adapter_version === source.version
    )
      return { action: "unchanged", noticeId, candidateId: null };
    const versionId = randomUUID();
    for (const entry of parsed.evidence) entry.sourceVersion = versionId;
    parsed.evidence.push(
      {
        field: "publisher",
        excerpt: source.publisher,
        paragraph: -1,
        url,
        sourceVersion: versionId,
      },
      {
        field: "publishedAt",
        excerpt: article.publishedAt ?? "通知未明确发布日期",
        paragraph: -1,
        url,
        sourceVersion: versionId,
      },
    );
    await client.query(
      "INSERT INTO ingestion_versions(id,notice_id,previous_version,revision,body_hash,adapter_version,fetched_at,article,extracted,raw_response,response_headers) VALUES($1,$2,$3,$4,$5,$6,now(),$7,$8,$9,$10)",
      [
        versionId,
        noticeId,
        previous?.latest_version ?? null,
        (previous?.revision ?? 0) + 1,
        bodyHash,
        source.version,
        article,
        parsed,
        Buffer.from(response.body),
        response.headers,
      ],
    );
    await client.query(
      "UPDATE ingestion_notices SET latest_version=$2 WHERE id=$1",
      [noticeId, versionId],
    );
    const candidate = await client.query(
      "INSERT INTO ingestion_candidates(id,notice_id,source_version,status,data) VALUES($1,$2,$3,'pending',$4) ON CONFLICT(notice_id) DO UPDATE SET source_version=EXCLUDED.source_version,revision=ingestion_candidates.revision+1,status='pending',data=EXCLUDED.data,reviewer=NULL,checked_at=NULL,reason=NULL,approved_file=NULL,updated_at=now() RETURNING id",
      [randomUUID(), noticeId, versionId, parsed],
    );
    return {
      action: previous ? "changed" : "new",
      noticeId,
      candidateId: candidate.rows[0].id as string,
    };
  });
}
export async function cleanupResponses(pool: Pool, days = 30) {
  if (!Number.isInteger(days) || days < 1 || days > 365)
    throw new Error("原始响应保留天数须为 1–365");
  const result = await pool.query(
    "UPDATE ingestion_versions SET raw_response=NULL WHERE raw_response IS NOT NULL AND fetched_at < now()-($1 * interval '1 day')",
    [days],
  );
  return { removed: result.rowCount };
}
