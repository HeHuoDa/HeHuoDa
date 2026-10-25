import { eq, inArray } from "drizzle-orm";
import { authSessions, authTokens } from "../database/schema.js";
import type { DataModule } from "./ports.js";

export function authDataModule(): DataModule {
  return {
    id: "auth",
    kind: "production",
    capabilities: [],
    lifecycle: {
      // 无真实队伍/联系人，因此仅声明认证模块实际存在的数据。
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
        await tx.delete(authSessions).where(eq(authSessions.userId, userId));
        // 账号/微信绑定最终释放与审计留存归 #138；不提前删除。
      },
    },
  };
}
