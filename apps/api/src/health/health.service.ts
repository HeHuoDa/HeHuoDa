import { Injectable, Logger } from "@nestjs/common";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseService } from "../database/database.service.js";
import {
  assessDirectoryDisk,
  type DiskAssessment,
  describeDiskAssessment,
} from "./disk-space.js";
import { HealthResponseDto } from "./health-response.dto.js";
import { LevelThrottle } from "./level-throttle.js";
import { ReadinessResponseDto } from "./readiness-response.dto.js";

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  /** 按等级分别计时；单个时间戳会让 warning→critical 的升级被吞掉。 */
  private readonly diskWarnThrottle = new LevelThrottle(10 * 60_000);

  constructor(private readonly database: DatabaseService) {}

  getHealth(requestId: string): HealthResponseDto {
    return { status: "ok", requestId };
  }

  /**
   * 同一个等级只每 10 分钟提醒一次。健康检查每 10 秒一次，
   * 不节流会让告警日志本身成为写盘最多的东西。
   */
  private warnDiskOnce(disk: DiskAssessment): void {
    // ok 时没有文案；不过滤会打印 `WARN ... undefined`，
    // 正常磁盘反而每 10 分钟刷一条垃圾日志。
    const message = describeDiskAssessment(disk, `工作目录 ${process.cwd()}`);
    if (!message) return;
    if (!this.diskWarnThrottle.allow(disk.level, Date.now())) return;
    this.logger.warn(message);
  }

  async getReadiness(requestId: string): Promise<ReadinessResponseDto> {
    // 磁盘余量只写日志告警，不参与就绪判定。
    const disk = assessDirectoryDisk(process.cwd());
    if (disk) this.warnDiskOnce(disk);
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
      // 等级不进入响应体：/health 与 /health/ready 都是公开端点，
      // 暴露剩余磁盘属信息泄露。
      return { status: "ready", requestId };
    } catch {
      return { status: "unavailable", requestId };
    }
  }
}
