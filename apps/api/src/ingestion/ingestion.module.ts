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
      await cleanupResponses(
        this.database.pool,
        this.config.get<number>("INGESTION_RAW_DAYS", 30),
      );
    } catch {
      this.logger.error("通知采集失败；查看运行记录，正式数据保持原状");
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
