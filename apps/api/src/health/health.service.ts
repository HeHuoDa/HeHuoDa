import { Injectable, Logger } from "@nestjs/common";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseService } from "../database/database.service.js";
import {
  assessDiskSpace,
  type DiskAssessment,
  describeDiskAssessment,
  DISK_CRITICAL_BYTES_DEFAULT,
  DISK_WARNING_BYTES_DEFAULT,
  readDiskSpace,
} from "./disk-space.js";
import { HealthResponseDto } from "./health-response.dto.js";
import { ReadinessResponseDto } from "./readiness-response.dto.js";

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  /** 上次写入磁盘告警日志的时间；避免健康检查每 10 秒重复写一行。 */
  private lastDiskWarnAt = 0;

  constructor(private readonly database: DatabaseService) {}

  getHealth(requestId: string): HealthResponseDto {
    return { status: "ok", requestId };
  }

  /**
   * 同一个等级只每 10 分钟提醒一次。健康检查每 10 秒一次，
   * 不节流会让告警日志本身成为写盘最多的东西。
   */
  private warnDiskOnce(disk: DiskAssessment): void {
    const now = Date.now();
    if (now - this.lastDiskWarnAt < 10 * 60_000) return;
    this.lastDiskWarnAt = now;
    this.logger.warn(describeDiskAssessment(disk, `工作目录 ${process.cwd()}`));
  }

  /**
   * 数据库所在文件系统的余量评估。
   *
   * 读不到空间信息时返回 undefined 而不是判失败：容器内若挂载异常，
   * 已有一堆检查会先把问题暴露出来，不应把「测不出磁盘」当成磁盘耗尽。
   */
  private diskAssessment(): DiskAssessment | undefined {
    try {
      return assessDiskSpace(readDiskSpace(process.cwd()), {
        criticalBytes:
          Number(process.env.DISK_CRITICAL_MIB ?? 0) * 1024 ** 2 ||
          DISK_CRITICAL_BYTES_DEFAULT,
        warningBytes:
          Number(process.env.DISK_WARNING_MIB ?? 0) * 1024 ** 2 ||
          DISK_WARNING_BYTES_DEFAULT,
      });
    } catch {
      return undefined;
    }
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
      // 磁盘余量只告警、不阻断就绪：磁盘已满时把容器判为不健康会触发重启，
      // 而重启不会凭空变出空间，只会让已经在写的请求失败得更彻底。
      // 故这里记录日志并在 /health 上报等级，但不影响 ready 判定。
      const disk = this.diskAssessment();
      if (disk && disk.level !== "ok") this.warnDiskOnce(disk);
      return { status: "ready", requestId };
    } catch {
      return { status: "unavailable", requestId };
    }
  }
}
