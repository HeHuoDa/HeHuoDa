import type { PoolClient } from "pg";
import type {
  CollegeRecord,
  EditionRecord,
  StageRecord,
} from "./competition.model.js";
export type RecordData = EditionRecord;

/**
 * 读取正式目录。
 *
 * 缺省读取全部届次（采集导入与审核的既有语义）；传入 competitionIds 时只读取
 * 指定届次及其关系，供管理端按单条记录与基线校验使用，避免把整个目录
 * 反复搬进内存。
 */
export async function readCatalog(
  client: PoolClient,
  options: { competitionIds?: string[] } = {},
): Promise<{ colleges: CollegeRecord[]; competitions: RecordData[] }> {
  const directory = await client.query(
    'SELECT id,name,display_order AS "order" FROM colleges ORDER BY display_order',
  );
  const scope = options.competitionIds;
  if (scope?.length === 0)
    return { colleges: directory.rows, competitions: [] };
  const scoped = !!scope;
  const values = scoped ? [scope] : [];

  const editions = await client.query(
    "SELECT id,data,publication FROM competitions" +
      (scoped ? " WHERE id=ANY($1::text[])" : "") +
      " ORDER BY id",
    values,
  );
  const stages = await client.query(
    "SELECT s.competition_id AS parent,s.data FROM stages s" +
      (scoped ? " WHERE s.competition_id=ANY($1::text[])" : "") +
      " ORDER BY s.display_order,s.id",
    values,
  );
  const tracks = await client.query(
    "SELECT competition_id AS parent,data FROM tracks" +
      (scoped ? " WHERE competition_id=ANY($1::text[])" : "") +
      " ORDER BY id",
    values,
  );
  const notices = await client.query(
    "SELECT competition_id AS parent,data FROM notices" +
      (scoped ? " WHERE competition_id=ANY($1::text[])" : "") +
      " ORDER BY published_at DESC NULLS LAST,id",
    values,
  );
  const relationFilter = scoped
    ? " WHERE s.competition_id=ANY($1::text[])"
    : "";
  const hosts = await client.query(
    "SELECT r.stage_id AS parent,r.college_id AS id FROM stage_hosts r JOIN stages s ON s.id=r.stage_id" +
      relationFilter +
      " ORDER BY r.college_id",
    values,
  );
  const eligible = await client.query(
    "SELECT r.stage_id AS parent,r.college_id AS id FROM stage_eligibility r JOIN stages s ON s.id=r.stage_id" +
      relationFilter +
      " ORDER BY r.college_id",
    values,
  );
  const sources = await client.query(
    "SELECT r.stage_id AS parent,r.notice_id AS id FROM stage_sources r JOIN stages s ON s.id=r.stage_id" +
      relationFilter +
      " ORDER BY r.notice_id",
    values,
  );

  return {
    colleges: directory.rows,
    competitions: editions.rows.map((edition) => ({
      ...edition.data,
      publication: edition.publication,
      stages: stages.rows
        .filter((r) => r.parent === edition.id)
        .map(
          (r) =>
            ({
              ...r.data,
              hosts: hosts.rows
                .filter((h) => h.parent === r.data.id)
                .map((h) => h.id),
              scope: {
                ...r.data.scope,
                colleges: eligible.rows
                  .filter((h) => h.parent === r.data.id)
                  .map((h) => h.id),
              },
              sourceIds: sources.rows
                .filter((h) => h.parent === r.data.id)
                .map((h) => h.id),
            }) as StageRecord,
        ),
      tracks: tracks.rows
        .filter((r) => r.parent === edition.id)
        .map((r) => r.data),
      notices: notices.rows
        .filter((r) => r.parent === edition.id)
        .map((r) => r.data),
    })),
  };
}
