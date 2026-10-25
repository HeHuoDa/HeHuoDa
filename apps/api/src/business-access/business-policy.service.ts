import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { eq } from "drizzle-orm";
import { AuthClock } from "../auth/auth-clock.js";
import { AuthRepository, type AccessContext } from "../auth/auth.repository.js";
import { createApiError } from "../common/api-error.js";
import {
  lockAccessTransaction,
  type AccessTransaction,
} from "../database/access-transaction.js";
import { users } from "../database/schema.js";
import { CapabilityRegistry } from "./capabilities.js";
import {
  captainActions,
  sensitiveActions,
  recoveryActions,
  type BusinessAction,
  type CampusQualification,
} from "./ports.js";

@Injectable()
export class BusinessPolicy {
  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly repository: AuthRepository,
    private readonly config: ConfigService,
    private readonly clock: AuthClock,
  ) {}

  async qualification(
    tx: AccessTransaction,
    userId: string,
  ): Promise<CampusQualification> {
    return (
      this.registry.provider("campus")?.campus?.read(tx, userId) ?? {
        status: "unavailable",
        validUntil: null,
      }
    );
  }

  // 返回服务端 actor；调用方须在此 tx 内完成读取/写入，不得事务结束后继续执行。
  async authorize(
    tx: AccessTransaction,
    token: string | undefined,
    action: BusinessAction,
    resourceId: string,
  ): Promise<AccessContext> {
    await lockAccessTransaction(tx);
    const now = this.clock.now();
    const actor = token
      ? await this.repository.findActiveAccess(token, now, tx)
      : undefined;
    if (!actor) throw createApiError(401, "INVALID_SESSION", "请先登录");
    if (actor.user.status !== "active")
      throw createApiError(403, "ACCOUNT_RESTRICTED", "账号当前受限");
    if (
      ![...sensitiveActions, ...captainActions, ...recoveryActions].includes(
        action,
      )
    )
      throw createApiError(403, "ACTION_FORBIDDEN", "操作未获授权");
    const sensitive = (sensitiveActions as readonly string[]).includes(action);
    if (sensitive) {
      if (!this.config.get<boolean>("SENSITIVE_BUSINESS_ENABLED", false))
        throw createApiError(
          503,
          "SENSITIVE_BUSINESS_UNAVAILABLE",
          "敏感业务暂未开放",
        );
      try {
        this.registry.assertReady(true);
      } catch {
        throw createApiError(
          503,
          "BUSINESS_CAPABILITY_UNAVAILABLE",
          "业务能力暂不可用",
        );
      }
      await this.assertQualification(tx, actor.user.id, now);
    }
    const resources = this.registry.provider("resources")?.resources;
    if (!resources)
      throw createApiError(
        503,
        "RESOURCE_PROVIDER_UNAVAILABLE",
        "业务能力暂不可用",
      );
    const relationship = await resources.read(
      tx,
      actor.user.id,
      action,
      resourceId,
    );
    if (!relationship)
      throw createApiError(404, "RESOURCE_NOT_FOUND", "资源不可用");
    if (
      !relationship.allowed ||
      ((captainActions as readonly string[]).includes(action) &&
        !relationship.isCaptain)
    )
      throw action === "readMemberContact"
        ? createApiError(404, "RESOURCE_NOT_FOUND", "资源不可用")
        : createApiError(403, "RESOURCE_FORBIDDEN", "没有操作权限");
    if (action === "readMemberContact") {
      const contact = relationship.contact;
      if (
        !contact ||
        !contact.sameTeam ||
        !contact.viewerIsMember ||
        !contact.ownerIsMember ||
        !contact.granted
      )
        throw createApiError(404, "RESOURCE_NOT_FOUND", "资源不可用");
      const [owner] = await tx
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, contact.ownerId));
      if (owner?.status !== "active")
        throw createApiError(404, "RESOURCE_NOT_FOUND", "资源不可用");
      // 不向查看者暴露所有者资格的具体状态。
      const qualification = await this.qualification(tx, contact.ownerId);
      if (
        qualification.status !== "valid" ||
        !qualification.validUntil ||
        !Number.isFinite(qualification.validUntil.getTime()) ||
        qualification.validUntil <= now
      )
        throw createApiError(404, "RESOURCE_NOT_FOUND", "资源不可用");
    }
    return actor;
  }

  private async assertQualification(
    tx: AccessTransaction,
    userId: string,
    now: Date,
  ): Promise<void> {
    const qualification = await this.qualification(tx, userId);
    const status =
      qualification.status === "valid" &&
      (!qualification.validUntil ||
        !Number.isFinite(qualification.validUntil.getTime()) ||
        qualification.validUntil <= now)
        ? "expired"
        : qualification.status;
    if (status !== "valid")
      throw createApiError(
        403,
        `CAMPUS_${status.toUpperCase()}`,
        "校园资格不满足操作要求",
      );
  }
}
