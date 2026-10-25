import { Module, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { eq, inArray } from "drizzle-orm";
import { authSessions, authTokens } from "../database/schema.js";
import { CapabilityRegistry } from "./capabilities.js";
import { AccountLifecycle } from "./lifecycle.service.js";

@Module({
  providers: [
    {
      provide: CapabilityRegistry,
      useFactory: () => {
        const registry = new CapabilityRegistry();
        registry.register({
          id: "auth",
          kind: "production",
          capabilities: [],
          lifecycle: {
            // 认证模块没有队伍或联系人；仅声明本模块实际存在的数据。
            check: async () => {},
            revoke: async (tx, userId, now) => {
              await tx
                .update(authSessions)
                .set({ revokedAt: now, revokedReason: "account_lifecycle" })
                .where(eq(authSessions.userId, userId));
            },
            cleanup: async (tx, userId) => {
              const sessions = tx
                .select({ id: authSessions.id })
                .from(authSessions)
                .where(eq(authSessions.userId, userId));
              await tx
                .delete(authTokens)
                .where(inArray(authTokens.sessionId, sessions));
              await tx
                .delete(authSessions)
                .where(eq(authSessions.userId, userId));
              // 账号/微信绑定最终释放与审计留存归 #138；不提前删除。
            },
          },
        });
        return registry;
      },
    },
    AccountLifecycle,
  ],
  exports: [CapabilityRegistry, AccountLifecycle],
})
export class LifecycleModule implements OnModuleInit {
  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly config: ConfigService,
  ) {}
  onModuleInit(): void {
    this.registry.seal(
      this.config.get<boolean>("SENSITIVE_BUSINESS_ENABLED", false),
    );
  }
}
