import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service.js";
import { readCatalog } from "../competitions/catalog.js";
import type { EditionRecord } from "../competitions/competition.model.js";
import { baselineOf } from "./competition-admin.model.js";

export interface AdminCompetitionRow {
  id: string;
  name: string;
  edition: string;
  category: string;
  organizer: string;
  origin: string;
  publication: "draft" | "published" | "hidden";
  stageCount: number;
  trackCount: number;
  noticeCount: number;
  updatedOrder: number;
  baseline: string;
}

export interface AdminCompetitionListQuery {
  page: number;
  pageSize: number;
  status?: "draft" | "published" | "hidden";
  q?: string;
}

const SELECT_EDITION = `SELECT c.id,c.data,c.publication,
  (SELECT count(*)::int FROM stages s WHERE s.competition_id=c.id) AS "stageCount",
  (SELECT count(*)::int FROM tracks t WHERE t.competition_id=c.id) AS "trackCount",
  (SELECT count(*)::int FROM notices n WHERE n.competition_id=c.id) AS "noticeCount"
  FROM competitions c`;

@Injectable()
export class AdminCompetitionRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * 管理端读取全部发布状态（draft/published/hidden），与公开端只读 published 不同。
   * 排序固定为更新时间倒序 + id，保证翻页稳定。
   */
  async list(query: AdminCompetitionListQuery) {
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const values: unknown[] = [];
      const clauses: string[] = [];
      if (query.status) {
        values.push(query.status);
        clauses.push(`c.publication=$${values.length}`);
      }
      if (query.q) {
        values.push(query.q.toLowerCase());
        clauses.push(
          `(strpos(lower(c.data->>'name'),$${values.length})>0 OR strpos(lower(c.data->>'edition'),$${values.length})>0 OR strpos(lower(c.data->>'organizer'),$${values.length})>0)`,
        );
      }
      const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";
      const count = await client.query<{ total: string }>(
        "SELECT count(*) AS total FROM competitions c" + where,
        values,
      );
      const rows = await client.query(
        `${SELECT_EDITION}${where}
         ORDER BY c.id COLLATE "C"
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, query.pageSize, (query.page - 1) * query.pageSize],
      );
      const changes = await this.baselines(
        client,
        rows.rows.map((row) => row.id),
      );
      await client.query("COMMIT");
      return {
        items: rows.rows.map((row) => ({
          ...this.summary(row),
          baseline: changes.get(row.id)!,
        })),
        total: Number(count.rows[0]!.total),
        page: query.page,
        pageSize: query.pageSize,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** 单条管理端详情：不限发布状态，带与服务端校验一致的基线。 */
  async detail(id: string) {
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const catalog = await readCatalog(client, { competitionIds: [id] });
      const record = catalog.competitions[0];
      if (!record) {
        await client.query("ROLLBACK");
        return undefined;
      }
      await client.query("COMMIT");
      return {
        ...record,
        baseline: baselineOf(record, catalog.colleges),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** 计算指定届次的正式基线；不存在的届次得到空记录基线。 */
  async baselines(client: PoolClient, ids: string[]) {
    const catalog = await readCatalog(client, { competitionIds: ids });
    return new Map(
      ids.map((id) => [
        id,
        baselineOf(
          catalog.competitions.find((record) => record.id === id) ?? null,
          catalog.colleges,
        ),
      ]),
    );
  }

  private summary(row: {
    id: string;
    data: Omit<EditionRecord, "stages" | "tracks" | "notices">;
    publication: "draft" | "published" | "hidden";
    stageCount: number;
    trackCount: number;
    noticeCount: number;
  }) {
    return {
      id: row.id,
      name: row.data.name,
      edition: row.data.edition,
      category: row.data.category,
      organizer: row.data.organizer,
      origin: row.data.origin,
      publication: row.publication,
      stageCount: row.stageCount,
      trackCount: row.trackCount,
      noticeCount: row.noticeCount,
    };
  }
}
