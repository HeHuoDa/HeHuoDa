import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { createApiError } from "../common/api-error.js";
import {
  lockAccessTransaction,
  type AccessTransaction,
} from "../database/access-transaction.js";
import { users } from "../database/schema.js";
import { CapabilityRegistry } from "./capabilities.js";

@Injectable()
export class AccountLifecycle {
  constructor(private readonly registry: CapabilityRegistry) {}

  async checkDeletion(tx: AccessTransaction, userId: string): Promise<void> {
    await lockAccessTransaction(tx);
    const resources = this.registry.provider("resources")?.resources;
    if (resources && (await resources.hasActiveCaptainTeam(tx, userId)))
      throw createApiError(409, "ACTIVE_CAPTAIN_TEAM", "请先移交或解散队伍");
    for (const module of this.registry.all())
      await module.lifecycle.check(tx, userId);
  }

  async revoke(
    tx: AccessTransaction,
    userId: string,
    now: Date,
  ): Promise<void> {
    await lockAccessTransaction(tx);
    for (const module of this.registry.all())
      await module.lifecycle.revoke(tx, userId, now);
  }

  async restrict(
    tx: AccessTransaction,
    userId: string,
    now: Date,
  ): Promise<void> {
    await lockAccessTransaction(tx);
    // closing/deleted 不得被限制操作复活；#138 负责独立 restriction 模型。
    const [user] = await tx.select().from(users).where(eq(users.id, userId));
    if (!user || !["active", "restricted"].includes(user.status))
      throw createApiError(409, "ACCOUNT_STATE_CONFLICT", "账号状态已变化");
    await tx
      .update(users)
      .set({ status: "restricted", updatedAt: now })
      .where(eq(users.id, userId));
    await this.revoke(tx, userId, now);
  }

  async cleanup(
    tx: AccessTransaction,
    userId: string,
    now: Date,
  ): Promise<void> {
    await lockAccessTransaction(tx);
    for (const module of this.registry.all())
      await module.lifecycle.cleanup(tx, userId, now);
  }

  // 只在数据库提交后调用；失败不得声称数据库已回滚。调用者持有重试责任。
  async destroySchoolSessions(input: {
    userId: string;
    sessionId?: string;
  }): Promise<void> {
    try {
      await this.registry
        .provider("school-sessions")
        ?.schoolSessions?.destroy(input);
    } catch {
      throw createApiError(
        503,
        "SCHOOL_SESSION_CLEANUP_PENDING",
        "平台变更已提交，学校临时会话清理待重试",
      );
    }
  }
}
