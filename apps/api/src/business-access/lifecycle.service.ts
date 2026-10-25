import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
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
  private readonly logger = new Logger(AccountLifecycle.name);
  private readonly pendingSchoolCleanup = new Map<
    string,
    {
      input: { userId: string; sessionId?: string };
      expiresAt: number;
    }
  >();
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

  // 只在数据库提交后调用；学校会话限于本进程且最长五分钟，进程退出即销毁。
  async destroySchoolSessions(input: {
    userId: string;
    sessionId?: string;
  }): Promise<void> {
    const key = JSON.stringify([input.userId, input.sessionId ?? null]);
    try {
      await this.registry
        .provider("school-sessions")
        ?.schoolSessions?.destroy(input);
      this.pendingSchoolCleanup.delete(key);
    } catch {
      if (!this.pendingSchoolCleanup.has(key))
        this.pendingSchoolCleanup.set(key, {
          input: { ...input },
          expiresAt: Date.now() + 5 * 60_000,
        });
      throw createApiError(
        503,
        "SCHOOL_SESSION_CLEANUP_PENDING",
        "平台变更已提交，学校临时会话清理待重试",
      );
    }
  }

  @Cron("*/10 * * * * *", {
    name: "school-session-cleanup-retry",
    waitForCompletion: true,
  })
  async retrySchoolSessionCleanup(): Promise<void> {
    for (const [key, task] of this.pendingSchoolCleanup) {
      if (Date.now() >= task.expiresAt) {
        // #134 的学校会话已到最长寿命，不持久保存用户引用。
        this.pendingSchoolCleanup.delete(key);
        continue;
      }
      try {
        await this.registry
          .provider("school-sessions")
          ?.schoolSessions?.destroy(task.input);
        if (this.pendingSchoolCleanup.get(key) === task)
          this.pendingSchoolCleanup.delete(key);
      } catch {
        // 不记录用户引用、学校报文或秘密；下一轮重试，无需已撤销的平台凭据。
        this.logger.warn("学校临时会话清理尚未完成，将继续重试");
      }
    }
  }
}
