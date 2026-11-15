import {
  Injectable,
  Logger,
  Module,
  type BeforeApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, ScheduleModule } from "@nestjs/schedule";
import { DatabaseService } from "../database/database.service.js";
import { ChannelRoundRunner } from "./channel-scheduler.js";
import { cleanupResponses } from "./store.js";
import { cleanupAttachmentBodies } from "./attachment-store.js";
import {
  assessDiskSpace,
  describeDiskAssessment,
  DISK_CRITICAL_BYTES_DEFAULT,
  DISK_WARNING_BYTES_DEFAULT,
  readDiskSpace,
} from "../health/disk-space.js";

@Injectable()
export class IngestionScheduler implements BeforeApplicationShutdown {
  private readonly logger = new Logger(IngestionScheduler.name);
  private readonly stop = new AbortController();
  private pending: Promise<void> | null = null;
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
  ) {}
  @Cron("0 0 9,18 * * *", {
    timeZone: "Asia/Shanghai",
    name: "official-notices",
    waitForCompletion: true,
  })
  async scan() {
    if (
      this.config.get("NODE_ENV") === "test" ||
      !this.config.get<boolean>("INGESTION_ENABLED", true)
    )
      return;
    if (this.pending || this.stop.signal.aborted) return;
    this.pending = this.run();
    try {
      await this.pending;
    } finally {
      this.pending = null;
    }
  }
  private async run() {
    try {
      const result = await new ChannelRoundRunner(this.database.pool).run(
        {},
        this.stop.signal,
      );
      this.logger.log(JSON.stringify(result));
      await this.cleanupWithDiskReport();
    } catch {
      this.logger.error("通知采集失败；查看运行记录，正式数据保持原状");
    }
  }

  /**
   * 清理前先看一眼磁盘余量，再执行两个清理。
   *
   * 两个清理各自独立记录结果：之前包在同一个 try 里，
   * 附件清理抛错会让原始响应清理的结果被当成整体失败，
   * 而实际上只有后者失败了（或反之）。
   */
  private async cleanupWithDiskReport() {
    this.reportDisk("清理前");
    const days = this.config.get<number>("INGESTION_RAW_DAYS", 30);
    for (const [label, run] of [
      ["原始响应", () => cleanupResponses(this.database.pool, days)],
      ["附件字节", () => cleanupAttachmentBodies(this.database.pool, days)],
    ] as const) {
      try {
        const { removed } = await run();
        this.logger.log(`清理${label}：removed=${removed}`);
      } catch (error) {
        // 清理失败不静默：removed=0 与实际失败必须可区分，
        // 否则会读成「没有过期数据」。
        this.logger.error(
          `清理${label}失败：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    this.reportDisk("清理后");
  }

  private reportDisk(stage: string): void {
    try {
      const level = assessDiskSpace(readDiskSpace(process.cwd()), {
        criticalBytes:
          Number(process.env.DISK_CRITICAL_MIB ?? 0) * 1024 ** 2 ||
          DISK_CRITICAL_BYTES_DEFAULT,
        warningBytes:
          Number(process.env.DISK_WARNING_MIB ?? 0) * 1024 ** 2 ||
          DISK_WARNING_BYTES_DEFAULT,
      });
      const message = describeDiskAssessment(level, process.cwd());
      if (message) this.logger.warn(`${stage} ${message}`);
    } catch {
      // 读不到磁盘信息不阻断清理：清理本身就是为了腾空间。
    }
  }
  async beforeApplicationShutdown() {
    this.stop.abort();
    await this.pending;
  }
}
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [IngestionScheduler],
})
export class IngestionModule {}
