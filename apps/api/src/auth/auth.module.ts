import { Injectable, Logger, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { DatabaseService } from "../database/database.service.js";
import { AuthController } from "./auth.controller.js";
import { AuthRepository } from "./auth.repository.js";
import { AuthService } from "./auth.service.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthClock } from "./auth-clock.js";
import { AuthRateLimiter } from "./auth-rate-limiter.js";
import { WECHAT_PROVIDER } from "./auth.constants.js";
import { cleanupAuthArtifacts } from "./auth-cleanup.js";
import type { WechatProvider } from "./wechat/wechat-provider.js";
import { RealWechatProvider } from "./wechat/real-wechat-provider.js";
import { StubWechatProvider } from "./wechat/stub-wechat-provider.js";

@Injectable()
export class AuthCleanupScheduler {
  private readonly logger = new Logger(AuthCleanupScheduler.name);
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
  ) {}
  @Cron("0 30 3 * * *", {
    timeZone: "Asia/Shanghai",
    name: "auth-cleanup",
    waitForCompletion: true,
  })
  async cleanup() {
    if (
      this.config.get("NODE_ENV") === "test" ||
      !this.config.get<boolean>("WECHAT_LOGIN_ENABLED", false)
    )
      return;
    try {
      await cleanupAuthArtifacts(
        this.database.pool,
        this.config.get<number>("AUTH_AUDIT_RETENTION_DAYS", 180),
      );
    } catch {
      this.logger.error("认证数据清理失败；凭据摘要与审计记录保持原状");
    }
  }
}

@Module({
  controllers: [AuthController],
  providers: [
    AuthClock,
    AuthGuard,
    AuthRepository,
    AuthRateLimiter,
    AuthService,
    AuthCleanupScheduler,
    {
      provide: WECHAT_PROVIDER,
      useFactory: (config: ConfigService): WechatProvider =>
        config.get<string>("WECHAT_LOGIN_ADAPTER") === "stub"
          ? new StubWechatProvider()
          : new RealWechatProvider(config),
      inject: [ConfigService],
    },
  ],
})
export class AuthModule {}
