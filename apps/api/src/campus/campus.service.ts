import { randomUUID } from "node:crypto";
import {
  HttpException,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { and, eq, inArray, lt, or } from "drizzle-orm";
import {
  SchoolAuthClient,
  SchoolAuthError,
  type AuthChallenge,
  type AuthErrorCode,
  type AuthIdentity,
} from "@hehuoda/sicau-connectors/auth";
import { AuthClock } from "../auth/auth-clock.js";
import type { AccessContext } from "../auth/auth.repository.js";
import type {
  DataModule,
  CampusQualification,
} from "../business-access/ports.js";
import { createApiError } from "../common/api-error.js";
import {
  lockAccessTransaction,
  type AccessTransaction,
} from "../database/access-transaction.js";
import { DatabaseService } from "../database/database.service.js";
import {
  authSessions,
  users,
  campusBindings,
  campusProfiles,
  campusQualifications,
  campusTransactions,
  campusAuditLogs,
  campusRateBudgets,
} from "../database/schema.js";
import {
  campusSettings,
  currentTerm,
  openProfile,
  sealProfile,
  subjectIndex,
} from "./campus.config.js";

const SOURCE = "sicau-eauth";
const ACTIVE = ["waiting", "processing"];
type Transaction = typeof campusTransactions.$inferSelect;
type LiveSession = {
  userId: string;
  sessionId: string;
  handle?: string;
  controller: AbortController;
};
export interface CampusSummary {
  status: "unverified" | "valid" | "expired" | "revoked";
  termId: string | null;
  verifiedAt: string | null;
  validUntil: string | null;
  source: string | null;
}
export interface CampusTransactionResult {
  id: string;
  status: string;
  expiresAt: string;
  reason: string | null;
  qualification?: CampusSummary;
  challenge?: { version: string; imageDataUrl: string; expiresAt: string };
}
const errorStatus: Record<AuthErrorCode, number> = {
  invalid_session: 409,
  session_expired: 409,
  stale_challenge: 409,
  session_busy: 409,
  invalid_input: 400,
  capacity_exceeded: 503,
  disposed: 503,
  captcha_failed: 400,
  credentials_failed: 400,
  unsupported_verification: 400,
  upstream_unavailable: 503,
  upstream_timeout: 503,
  unknown_response: 503,
  cancelled: 409,
};
const safeReason = (error: unknown) => {
  if (error instanceof SchoolAuthError) return error.code;
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (
      typeof response === "object" &&
      "code" in response &&
      response.code === "CAMPUS_IDENTITY_MISMATCH"
    )
      return "identity_mismatch";
  }
  return "internal_failure";
};

@Injectable()
export class CampusService implements OnApplicationShutdown {
  private readonly logger = new Logger(CampusService.name);
  private readonly instanceId = randomUUID();
  private readonly live = new Map<string, LiveSession>();
  private inFlight = 0;
  private shuttingDown = false;
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
    private readonly clock: AuthClock,
    private readonly school: SchoolAuthClient,
  ) {}
  private settings() {
    return campusSettings(
      Object.fromEntries(
        [
          "CAMPUS_VERIFICATION_ENABLED",
          "CAMPUS_TERMS",
          "CAMPUS_POLICY_VERSION",
          "CAMPUS_SUBJECT_HMAC_KEY",
          "CAMPUS_PROFILE_KEYS",
          "CAMPUS_PROFILE_KEY_ID",
        ].map((key) => [key, this.config.get(key)]),
      ),
    );
  }
  policy() {
    return {
      version: this.settings().policyVersion,
      content:
        "密码、验证码仅用于本次认证，不会保存。学校返回的姓名、学号加密保存，仅本人可见。认证仅核对学校账号信息，不证明当前在读或操作者本人。",
    };
  }
  // 每个数据库权限事务都先取 #133 的统一锁，学校网络永远在锁外。
  private transaction<T>(
    run: (tx: AccessTransaction) => Promise<T>,
  ): Promise<T> {
    return this.database.db.transaction(async (tx) => {
      await lockAccessTransaction(tx);
      return run(tx);
    });
  }
  private async assertAccess(
    tx: AccessTransaction,
    access: AccessContext,
    now: Date,
  ) {
    const [row] = await tx
      .select({
        status: users.status,
        revokedAt: authSessions.revokedAt,
        expiresAt: authSessions.absoluteExpiresAt,
        userId: authSessions.userId,
      })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(eq(authSessions.id, access.sessionId));
    if (
      !row ||
      row.userId !== access.user.id ||
      row.revokedAt ||
      now >= row.expiresAt
    )
      throw createApiError(401, "INVALID_SESSION", "登录状态已失效");
    if (row.status !== "active")
      throw createApiError(403, "ACCOUNT_RESTRICTED", "账号当前受限");
  }
  async summary(
    tx: AccessTransaction,
    userId: string,
    now = this.clock.now(),
  ): Promise<CampusSummary> {
    const [q] = await tx
      .select()
      .from(campusQualifications)
      .where(eq(campusQualifications.userId, userId));
    return q
      ? {
          status: q.revokedAt
            ? "revoked"
            : now >= q.validUntil
              ? "expired"
              : "valid",
          termId: q.termId,
          verifiedAt: q.verifiedAt.toISOString(),
          validUntil: q.validUntil.toISOString(),
          source: q.source,
        }
      : {
          status: "unverified",
          termId: null,
          verifiedAt: null,
          validUntil: null,
          source: null,
        };
  }
  async status(access: AccessContext) {
    await this.maintain();
    return this.transaction(async (tx) => {
      const now = this.clock.now();
      await this.assertAccess(tx, access, now);
      const settings = this.settings(),
        term = currentTerm(settings, now);
      return {
        ...(await this.summary(tx, access.user.id, now)),
        available: settings.enabled && !!term && !this.shuttingDown,
        currentTerm: term,
        policyVersion: settings.policyVersion,
      };
    });
  }
  async profile(access: AccessContext) {
    return this.transaction(async (tx) => {
      await this.assertAccess(tx, access, this.clock.now());
      const [row] = await tx
        .select()
        .from(campusProfiles)
        .where(eq(campusProfiles.userId, access.user.id));
      if (!row) return { profile: null };
      try {
        return {
          profile: {
            ...openProfile(this.settings(), row.userId, row.source, row),
            source: row.source,
            updatedAt: row.updatedAt.toISOString(),
          },
        };
      } catch {
        throw createApiError(
          503,
          "CAMPUS_PROFILE_UNAVAILABLE",
          "学校资料暂不可读取",
        );
      }
    });
  }
  private requireEnabled(now: Date) {
    const settings = this.settings(),
      term = currentTerm(settings, now);
    if (!settings.enabled || !term || this.shuttingDown)
      throw createApiError(
        503,
        "CAMPUS_VERIFICATION_UNAVAILABLE",
        "统一身份认证暂未开放",
      );
    return { settings, term };
  }
  private async audit(
    tx: AccessTransaction,
    userId: string,
    requestId: string,
    kind: string,
    reason: string | null,
    now: Date,
  ) {
    await tx.insert(campusAuditLogs).values({
      id: randomUUID(),
      userId,
      requestId,
      kind,
      reason,
      createdAt: now,
    });
  }
  // 严格滑动窗口，持久且有界；拒绝的请求不发学校请求。所有预算在独立短事务提交。
  private async budget(
    access: AccessContext,
    ip: string,
    kind: "challenge" | "submit",
  ) {
    const allowed = await this.transaction(async (tx) => {
      await this.assertAccess(tx, access, this.clock.now());
      const now = this.clock.now(),
        ms = now.getTime(),
        windowMs = kind === "submit" ? 900_000 : 60_000;
      const source = subjectIndex(this.settings(), "rate-source", ip);
      let ok = true;
      for (const [scope, subject, fallback] of [
        ["GLOBAL", "all", 500],
        ["SOURCE", source, 100],
        ["USER", access.user.id, 5],
      ] as const) {
        const limit = this.config.get<number>(
          `CAMPUS_RATE_${kind.toUpperCase()}_${scope}`,
          fallback,
        );
        const id = JSON.stringify([kind, scope, subject]);
        const [row] = await tx
          .select()
          .from(campusRateBudgets)
          .where(eq(campusRateBudgets.id, id));
        const events = (row?.events ?? []).filter(
          (time) => time > ms - windowMs,
        );
        if (events.length >= limit) ok = false;
        // 饱和预算不追加，避免遭滥用时无限增长；学校失败的已准入请求仍计数。
        if (events.length < limit) events.push(ms);
        await tx
          .insert(campusRateBudgets)
          .values({ id, events, updatedAt: now })
          .onConflictDoUpdate({
            target: campusRateBudgets.id,
            set: { events, updatedAt: now },
          });
      }
      return ok;
    });
    if (!allowed)
      throw createApiError(
        429,
        "CAMPUS_RATE_LIMITED",
        "统一身份认证请求过于频繁，请稍后重试",
      );
  }
  private async upstream<T>(run: () => Promise<T>): Promise<T> {
    if (this.inFlight >= 5)
      throw createApiError(
        503,
        "CAMPUS_UPSTREAM_CAPACITY",
        "统一身份认证服务繁忙",
      );
    this.inFlight++;
    try {
      return await run();
    } finally {
      this.inFlight--;
    }
  }
  private drop(id: string) {
    const live = this.live.get(id);
    if (!live) return;
    live.controller.abort();
    if (live.handle) this.school.destroy(live.handle);
    this.live.delete(id);
  }
  private async owned(
    tx: AccessTransaction,
    access: AccessContext,
    id: string,
  ) {
    await this.assertAccess(tx, access, this.clock.now());
    const [row] = await tx
      .select()
      .from(campusTransactions)
      .where(
        and(
          eq(campusTransactions.id, id),
          eq(campusTransactions.userId, access.user.id),
          eq(campusTransactions.sessionId, access.sessionId),
        ),
      );
    if (!row)
      throw createApiError(
        404,
        "CAMPUS_TRANSACTION_NOT_FOUND",
        "认证事务不存在",
      );
    return row;
  }
  private async result(
    tx: AccessTransaction,
    row: Transaction,
    challenge?: AuthChallenge,
  ): Promise<CampusTransactionResult> {
    return {
      id: row.id,
      status: row.status,
      expiresAt: row.expiresAt.toISOString(),
      reason: row.reason,
      ...(row.status === "succeeded" && row.qualification
        ? { qualification: row.qualification }
        : {}),
      ...(challenge
        ? {
            challenge: {
              version: challenge.challengeVersion,
              imageDataUrl: challenge.imageDataUrl,
              expiresAt: new Date(
                Math.min(challenge.expiresAt, row.expiresAt.getTime()),
              ).toISOString(),
            },
          }
        : {}),
    };
  }
  private async terminate(
    tx: AccessTransaction,
    row: Transaction,
    status: string,
    reason: string,
    now: Date,
  ) {
    const [updated] = await tx
      .update(campusTransactions)
      .set({
        status,
        reason,
        operation: null,
        challengeVersion: null,
        finishedAt: now,
      })
      .where(eq(campusTransactions.id, row.id))
      .returning();
    return updated!;
  }
  private async fail(id: string, reason: string, requestId: string) {
    await this.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(campusTransactions)
        .where(eq(campusTransactions.id, id));
      if (row && ACTIVE.includes(row.status)) {
        await this.terminate(tx, row, "failed", reason, this.clock.now());
        await this.audit(
          tx,
          row.userId,
          requestId,
          "failed",
          reason,
          this.clock.now(),
        );
      }
    });
  }
  async create(access: AccessContext, ip: string, requestId: string) {
    await this.maintain();
    this.requireEnabled(this.clock.now());
    await this.budget(access, ip, "challenge");
    const row = await this.transaction(async (tx) => {
      const now = this.clock.now();
      await this.assertAccess(tx, access, now);
      const { term } = this.requireEnabled(now);
      const active = await tx
        .select()
        .from(campusTransactions)
        .where(inArray(campusTransactions.status, ACTIVE));
      if (active.some((t) => t.userId === access.user.id))
        throw createApiError(
          409,
          "CAMPUS_TRANSACTION_ACTIVE",
          "已有正在进行的统一身份认证",
        );
      if (active.length >= 128)
        throw createApiError(
          503,
          "CAMPUS_SESSION_CAPACITY",
          "统一身份认证服务繁忙",
        );
      const id = randomUUID();
      const [created] = await tx
        .insert(campusTransactions)
        .values({
          id,
          userId: access.user.id,
          sessionId: access.sessionId,
          instanceId: this.instanceId,
          termId: term.id,
          status: "processing",
          operation: "create",
          createdAt: now,
          expiresAt: new Date(now.getTime() + 300_000),
        })
        .returning();
      // 在提交前建立取消控制器；失败路径也销毁。
      this.live.set(id, {
        userId: access.user.id,
        sessionId: access.sessionId,
        controller: new AbortController(),
      });
      return created!;
    });
    try {
      const live = this.live.get(row.id)!;
      const challenge = await this.upstream(() =>
        this.school.createChallenge({
          ttlMs: Math.max(
            1,
            row.expiresAt.getTime() - this.clock.now().getTime(),
          ),
          signal: live.controller.signal,
        }),
      );
      live.handle = challenge.handle;
      return await this.acceptChallenge(access, row.id, challenge, requestId);
    } catch (error) {
      try {
        await this.fail(row.id, safeReason(error), requestId);
      } finally {
        this.drop(row.id);
      }
      throw this.safeError(error);
    }
  }
  private safeError(error: unknown) {
    // 本服务 createApiError 不含私人原值；外部错误一律只映射安全枚举。
    if (error instanceof SchoolAuthError)
      return createApiError(
        errorStatus[error.code],
        `CAMPUS_${error.code.toUpperCase()}`,
        "统一身份认证未完成，请根据状态重新发起",
      );
    if (error instanceof HttpException) return error;
    return createApiError(
      503,
      "CAMPUS_VERIFICATION_FAILED",
      "统一身份认证暂不可用",
    );
  }
  private async acceptChallenge(
    access: AccessContext,
    id: string,
    challenge: AuthChallenge,
    requestId: string,
  ) {
    return this.transaction(async (tx) => {
      const row = await this.owned(tx, access, id),
        now = this.clock.now();
      const { term } = this.requireEnabled(now);
      if (
        row.status !== "processing" ||
        !["create", "refresh"].includes(row.operation ?? "") ||
        now >= row.expiresAt ||
        term.id !== row.termId ||
        !this.live.has(id)
      )
        throw createApiError(
          409,
          "CAMPUS_TRANSACTION_ENDED",
          "认证事务已结束，请重新发起",
        );
      const [updated] = await tx
        .update(campusTransactions)
        .set({
          status: "waiting",
          operation: null,
          challengeVersion: challenge.challengeVersion,
        })
        .where(eq(campusTransactions.id, id))
        .returning();
      await this.audit(tx, access.user.id, requestId, "challenge", null, now);
      return this.result(tx, updated!, challenge);
    });
  }
  async refresh(
    access: AccessContext,
    id: string,
    ip: string,
    requestId: string,
  ) {
    await this.maintain();
    this.requireEnabled(this.clock.now());
    // 归属和 waiting 状态先检查；第二个锁内检查阻止并发刷新／提交。
    await this.transaction(async (tx) => {
      const row = await this.owned(tx, access, id);
      if (row.status !== "waiting")
        throw createApiError(
          409,
          "CAMPUS_TRANSACTION_BUSY",
          "认证事务当前不可刷新",
        );
    });
    await this.budget(access, ip, "challenge");
    await this.transaction(async (tx) => {
      const row = await this.owned(tx, access, id);
      if (row.status !== "waiting")
        throw createApiError(
          409,
          "CAMPUS_TRANSACTION_BUSY",
          "认证事务当前不可刷新",
        );
      await tx
        .update(campusTransactions)
        .set({
          status: "processing",
          operation: "refresh",
          challengeVersion: null,
        })
        .where(eq(campusTransactions.id, id));
    });
    try {
      const live = this.live.get(id);
      if (!live?.handle) throw new SchoolAuthError("invalid_session");
      const challenge = await this.upstream(() =>
        this.school.refreshChallenge(live.handle!, live.controller.signal),
      );
      return await this.acceptChallenge(access, id, challenge, requestId);
    } catch (error) {
      try {
        await this.fail(id, safeReason(error), requestId);
      } finally {
        this.drop(id);
      }
      throw this.safeError(error);
    }
  }
  async get(access: AccessContext, id: string) {
    await this.maintain();
    return this.transaction(async (tx) =>
      this.result(tx, await this.owned(tx, access, id)),
    );
  }
  async cancel(access: AccessContext, id: string, requestId: string) {
    const result = await this.transaction(async (tx) => {
      const row = await this.owned(tx, access, id);
      if (!ACTIVE.includes(row.status)) return this.result(tx, row);
      const now = this.clock.now();
      const updated = await this.terminate(
        tx,
        row,
        "cancelled",
        "cancelled",
        now,
      );
      await this.audit(
        tx,
        row.userId,
        requestId,
        "cancelled",
        "cancelled",
        now,
      );
      return this.result(tx, updated);
    });
    this.drop(id);
    return result;
  }
  async submit(
    access: AccessContext,
    id: string,
    input: {
      name: string;
      consentVersion: number;
      account: string;
      password: string;
      captcha: string;
      challengeVersion: string;
    },
    ip: string,
    requestId: string,
  ) {
    await this.maintain();
    // 幂等返回先于开关、预算及外联检查，旧终态不会重放密码。
    const existing = await this.transaction(async (tx) => {
      const row = await this.owned(tx, access, id);
      if (row.status !== "waiting") return this.result(tx, row);
      if (row.challengeVersion !== input.challengeVersion)
        throw createApiError(409, "CAMPUS_STALE_CHALLENGE", "验证码版本已变化");
      return null;
    });
    if (existing) return existing;
    this.requireEnabled(this.clock.now());
    this.assertConsent(input.consentVersion);
    await this.budget(access, ip, "submit");
    const admitted = await this.transaction(async (tx) => {
      const row = await this.owned(tx, access, id),
        now = this.clock.now();
      if (row.status !== "waiting")
        return { result: await this.result(tx, row) };
      const { term } = this.requireEnabled(now);
      this.assertConsent(input.consentVersion);
      if (now >= row.expiresAt || row.termId !== term.id) {
        return {
          result: await this.result(
            tx,
            await this.terminate(
              tx,
              row,
              "expired",
              "term_or_deadline_changed",
              now,
            ),
          ),
        };
      }
      if (row.challengeVersion !== input.challengeVersion)
        throw createApiError(409, "CAMPUS_STALE_CHALLENGE", "验证码版本已变化");
      await tx
        .update(campusTransactions)
        .set({ status: "processing", operation: "submit" })
        .where(eq(campusTransactions.id, id));
      return { result: null };
    });
    if (admitted.result) {
      if (admitted.result.status !== "processing") this.drop(id);
      return admitted.result;
    }
    try {
      const live = this.live.get(id);
      if (!live?.handle) throw new SchoolAuthError("invalid_session");
      const identity = await this.upstream(() =>
        this.school.submit({
          account: input.account.trim(),
          password: input.password,
          captcha: input.captcha,
          challengeVersion: input.challengeVersion,
          handle: live.handle!,
          signal: live.controller.signal,
        }),
      );
      if (
        input.name.trim() !== identity.name.trim() ||
        input.account.trim() !== identity.accountNumber.trim()
      )
        throw createApiError(
          400,
          "CAMPUS_IDENTITY_MISMATCH",
          "验证失败，姓名与学号不匹配",
        );
      return await this.commitIdentity(
        access,
        id,
        input.challengeVersion,
        identity,
        requestId,
      );
    } catch (error) {
      await this.fail(id, safeReason(error), requestId);
      throw this.safeError(error);
    } finally {
      this.drop(id);
    }
  }
  private assertConsent(version: number) {
    if (version !== this.settings().policyVersion)
      throw createApiError(
        400,
        "CAMPUS_CONSENT_MISMATCH",
        "请确认当前统一身份认证说明",
      );
  }
  private async commitIdentity(
    access: AccessContext,
    id: string,
    version: string,
    identity: AuthIdentity,
    requestId: string,
  ) {
    return this.transaction(async (tx) => {
      const row = await this.owned(tx, access, id),
        now = this.clock.now();
      const { settings, term } = this.requireEnabled(now);
      if (
        row.status !== "processing" ||
        row.operation !== "submit" ||
        row.challengeVersion !== version ||
        now >= row.expiresAt ||
        row.termId !== term.id ||
        !this.live.has(id)
      )
        throw createApiError(
          409,
          "CAMPUS_TRANSACTION_ENDED",
          "认证事务已结束，请重新发起",
        );
      const digest = subjectIndex(settings, identity.source, identity.subject);
      const bindings = await tx
        .select()
        .from(campusBindings)
        .where(
          and(
            eq(campusBindings.source, SOURCE),
            or(
              eq(campusBindings.userId, access.user.id),
              eq(campusBindings.subjectHmac, digest),
            ),
          ),
        );
      if (
        bindings.some(
          (b) => b.userId !== access.user.id || b.subjectHmac !== digest,
        )
      )
        throw createApiError(
          409,
          "CAMPUS_BINDING_CONFLICT",
          "学校账号绑定冲突",
        );
      await tx
        .insert(campusBindings)
        .values({
          userId: access.user.id,
          source: SOURCE,
          subjectHmac: digest,
          createdAt: now,
        })
        .onConflictDoNothing();
      const profile = {
        ...sealProfile(settings, access.user.id, SOURCE, {
          accountNumber: identity.accountNumber,
          name: identity.name,
        }),
        source: SOURCE,
        updatedAt: now,
      };
      await tx
        .insert(campusProfiles)
        .values({ userId: access.user.id, ...profile })
        .onConflictDoUpdate({ target: campusProfiles.userId, set: profile });
      const qualification = {
        source: SOURCE,
        termId: term.id,
        verifiedAt: now,
        validUntil: new Date(term.endAt),
        revokedAt: null,
      };
      await tx
        .insert(campusQualifications)
        .values({ userId: access.user.id, ...qualification })
        .onConflictDoUpdate({
          target: campusQualifications.userId,
          set: qualification,
        });
      const updated = await this.terminate(
        tx,
        row,
        "succeeded",
        "verified",
        now,
      );
      const snapshot = {
        status: "valid" as const,
        termId: term.id,
        verifiedAt: now.toISOString(),
        validUntil: term.endAt,
        source: SOURCE,
      };
      await tx
        .update(campusTransactions)
        .set({ qualification: snapshot })
        .where(eq(campusTransactions.id, id));
      updated.qualification = snapshot;
      await this.audit(tx, row.userId, requestId, "succeeded", null, now);
      return this.result(tx, updated);
    });
  }
  dataModule(): DataModule {
    return {
      id: "campus",
      kind: "production",
      capabilities: ["campus", "school-sessions"],
      campus: {
        read: async (tx, userId): Promise<CampusQualification> => {
          const q = await this.summary(tx, userId);
          return {
            status: q.status,
            validUntil: q.validUntil ? new Date(q.validUntil) : null,
          };
        },
      },
      lifecycle: {
        check: async () => {},
        revoke: async (tx, userId, now) => {
          await tx
            .update(campusQualifications)
            .set({ revokedAt: now })
            .where(eq(campusQualifications.userId, userId));
          await tx
            .update(campusTransactions)
            .set({
              status: "cancelled",
              reason: "account_revoked",
              operation: null,
              challengeVersion: null,
              finishedAt: now,
            })
            .where(
              and(
                eq(campusTransactions.userId, userId),
                inArray(campusTransactions.status, ACTIVE),
              ),
            );
        },
        cleanup: async (tx, userId) => {
          await tx
            .delete(campusProfiles)
            .where(eq(campusProfiles.userId, userId));
          await tx
            .delete(campusQualifications)
            .where(eq(campusQualifications.userId, userId));
          await tx
            .delete(campusTransactions)
            .where(eq(campusTransactions.userId, userId));
          await tx
            .delete(campusAuditLogs)
            .where(eq(campusAuditLogs.userId, userId));
        },
      },
      schoolSessions: {
        destroy: async (input) => {
          await this.transaction(async (tx) => {
            await tx
              .update(campusTransactions)
              .set({
                status: "cancelled",
                reason: "session_revoked",
                operation: null,
                challengeVersion: null,
                finishedAt: this.clock.now(),
              })
              .where(
                and(
                  eq(campusTransactions.userId, input.userId),
                  ...(input.sessionId
                    ? [eq(campusTransactions.sessionId, input.sessionId)]
                    : []),
                  inArray(campusTransactions.status, ACTIVE),
                ),
              );
          });
          for (const [id, live] of this.live)
            if (
              live.userId === input.userId &&
              (!input.sessionId || live.sessionId === input.sessionId)
            )
              this.drop(id);
        },
      },
    };
  }
  @Cron("*/10 * * * * *", { name: "campus-cleanup", waitForCompletion: true })
  async scheduledMaintenance() {
    if (
      this.config.get("NODE_ENV") === "test" ||
      !this.config.get("DATABASE_URL")
    )
      return;
    try {
      await this.maintain();
    } catch {
      this.logger.warn("校园核验清理未完成，将继续重试");
    }
  }
  async maintain() {
    const ended = await this.transaction(async (tx) => {
      const now = this.clock.now(),
        settings = this.settings();
      const rows = await tx
        .select({
          transaction: campusTransactions,
          status: users.status,
          revokedAt: authSessions.revokedAt,
          sessionExpiresAt: authSessions.absoluteExpiresAt,
        })
        .from(campusTransactions)
        .leftJoin(users, eq(users.id, campusTransactions.userId))
        .leftJoin(
          authSessions,
          and(
            eq(authSessions.id, campusTransactions.sessionId),
            eq(authSessions.userId, campusTransactions.userId),
          ),
        )
        .where(inArray(campusTransactions.status, ACTIVE));
      const ids: string[] = [];
      const activeIds = new Set(rows.map((row) => row.transaction.id));
      // 句柄和数据库的对照也必须在统一锁内，避免清理尚未提交的新事务。
      for (const id of this.live.keys()) if (!activeIds.has(id)) ids.push(id);
      for (const account of rows) {
        const row = account.transaction;
        const expired = now >= row.expiresAt;
        if (
          expired ||
          row.instanceId !== this.instanceId ||
          !settings.enabled ||
          !this.live.has(row.id) ||
          account.status !== "active" ||
          account.revokedAt ||
          !account.sessionExpiresAt ||
          now >= account.sessionExpiresAt
        ) {
          await this.terminate(
            tx,
            row,
            expired ? "expired" : "cancelled",
            expired ? "expired" : "session_unavailable",
            now,
          );
          ids.push(row.id);
        }
      }
      await tx
        .delete(campusTransactions)
        .where(
          lt(
            campusTransactions.finishedAt,
            new Date(now.getTime() - 86_400_000),
          ),
        );
      await tx
        .delete(campusAuditLogs)
        .where(
          lt(
            campusAuditLogs.createdAt,
            new Date(now.getTime() - 180 * 86_400_000),
          ),
        );
      await tx
        .delete(campusRateBudgets)
        .where(
          lt(campusRateBudgets.updatedAt, new Date(now.getTime() - 900_000)),
        );
      return ids;
    });
    for (const id of ended) this.drop(id);
  }
  onApplicationShutdown() {
    this.shuttingDown = true;
    for (const id of this.live.keys()) this.drop(id);
    this.school.dispose();
  }
}
