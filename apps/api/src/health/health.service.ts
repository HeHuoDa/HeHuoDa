import { Injectable } from "@nestjs/common";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseService } from "../database/database.service.js";
import { HealthResponseDto } from "./health-response.dto.js";
import { ReadinessResponseDto } from "./readiness-response.dto.js";

@Injectable()
export class HealthService {
  constructor(private readonly database: DatabaseService) {}

  getHealth(requestId: string): HealthResponseDto {
    return { status: "ok", requestId };
  }

  async getReadiness(requestId: string): Promise<ReadinessResponseDto> {
    try {
      const expected = (await readdir(resolve("migrations"))).filter((name) =>
        name.endsWith(".sql"),
      );
      if (expected.length === 0) throw new Error("缺少迁移清单");
      const migrationQuery = {
        text: "SELECT name FROM schema_migrations",
        query_timeout: 3000,
      };
      const applied = await this.database.pool.query<{ name: string }>(
        migrationQuery,
      );
      const names = new Set(applied.rows.map((row) => row.name));
      if (expected.some((name) => !names.has(name))) {
        return { status: "unavailable", requestId };
      }
      // 不仅检查连通与版本记录：必要表或字段被误删时同样不能发布。
      const structureQuery = {
        query_timeout: 3000,
        text: `
        SELECT id, name, display_order FROM colleges LIMIT 0;
        SELECT id, data, publication FROM competitions LIMIT 0;
        SELECT id, competition_id, data, display_order, registration_start,
          registration_end, registration_start_date, registration_end_date FROM stages LIMIT 0;
        SELECT id, competition_id, data FROM tracks LIMIT 0;
        SELECT id, competition_id, data, published_at, checked_at FROM notices LIMIT 0;
        SELECT stage_id, college_id FROM stage_hosts LIMIT 0;
        SELECT stage_id, college_id FROM stage_eligibility LIMIT 0;
        SELECT stage_id, notice_id, competition_id FROM stage_sources LIMIT 0;
        SELECT id, settings FROM ingestion_sources LIMIT 0;
        SELECT id, cursor FROM ingestion_runs LIMIT 0;
        SELECT id, latest_version FROM ingestion_notices LIMIT 0;
        SELECT id, raw_response FROM ingestion_versions LIMIT 0;
        SELECT id, status FROM ingestion_candidates LIMIT 0;
        SELECT candidate_id, competition_id FROM ingestion_mappings LIMIT 0;
        SELECT id FROM ingestion_operations LIMIT 0;
      `,
      };
      await this.database.pool.query(structureQuery);
      return { status: "ready", requestId };
    } catch {
      return { status: "unavailable", requestId };
    }
  }
}
