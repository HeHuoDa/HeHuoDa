import { randomUUID } from "node:crypto";
import { Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { and, eq, inArray, lt } from "drizzle-orm";
import {
  SchoolAuthClient,
  SchoolAuthError,
  type AuthChallenge,
  type AuthIdentity,
} from "@hehuoda/sicau-connectors/auth";
import { AuthClock } from "../auth/auth-clock.js";
import {
  DEFAULT_NICKNAME,
  SCHOOL_LOGIN_LIMITS,
  type UserStatus,
} from "../auth/auth.constants.js";
import {
  accessExpiry,
  AuthRepository,
  type UserRecord,
} from "../auth/auth.repository.js";
import {
  generateToken,
  generateTokenPair,
  hashToken,
} from "../auth/auth-token.js";
import { createApiError } from "../common/api-error.js";
import {
  lockAccessTransaction,
  type AccessTransaction,
} from "../database/access-transaction.js";
import { DatabaseService } from "../database/database.service.js";
import {
  campusAuditLogs,
  campusProfiles,
  campusQualifications,
  schoolLoginTransactions,
} from "../database/schema.js";
import { consumeBudget } from "./budget.js";
import {
  CAMPUS_SETTING_KEYS,
  campusSettings,
  currentTerm,
  sealProfile,
  subjectIndex,
} from "./campus.config.js";
import { safeSchoolReason, schoolApiError } from "./school-errors.js";

const SOURCE = "sicau-eauth";
const ACTIVE = ["waiting", "processing"];
const TRANSACTION_TTL_MS = 300_000;
const MAX_ACTIVE = 128;
const MAX_UPSTREAM_IN_FLIGHT = 5;

type Transaction = typeof schoolLoginTransactions.$inferSelect;
interface LiveTransaction {
  holderHash: string;
  handle?: string;
  controller: AbortController;
}

export interface SchoolLoginTransactionView {
  id: string;
  status: string;
  expiresAt: string;
  reason: string | null;
}
export interface SchoolLoginChallengeView extends SchoolLoginTransactionView {
  holderToken: string;
  challenge: { version: string; imageDataUrl: string; expiresAt: string };
}
export interface SchoolLoginCredentialView {
  id: string;
  status: string;
  expiresAt: string;
  reason: string | null;
  credential?: {
    kind: "active";
    user: { id: string; nickname: string; status: UserStatus };
    accessToken: string;
    refreshToken: string;
    accessExpiresAt: string;
    sessionExpiresAt: string;
  };
}
export interface SchoolLoginSubmitInput {
  name: string;
  account: string;
  password: string;
  captcha: string;
  challengeVersion: string;
  consentVersion: number;
}

/**
 * 川农统一身份认证匿名登录：持凭证事务 → 验证码 → 提交 → 原子建号并签发会话。
 *
 * 安全边界：
 * - 平台账号在学校确认身份前不存在，事务不引用 users，持有凭证只存 SHA-256 摘要；
 * - 学校 HTTP 永远在数据库事务外，事务内只做短写入，绝不占用连接等校方响应；
 * - 密码、验证码、明文学号与校方原报文不落库、不写审计、不写日志；
 * - 同一 (source,subject_hmac) 由唯一约束与咨询锁保证并发首登只有一个账号。
 */
@Injectable()
export class SchoolLoginService implements OnApplicationShutdown {
  private readonly logger = new Logger(SchoolLoginService.name);
  private readonly instanceId = randomUUID();
  private readonly live = new Map<string, LiveTransaction>();
  private inFlight = 0;
  private shuttingDown = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
    private readonly clock: AuthClock,
    private readonly school: SchoolAuthClient,
    private readonly repository: AuthRepository,
  ) {}

  private settings() {
    return campusSettings(
      Object.fromEntries(
        CAMPUS_SETTING_KEYS.map((key) => [key, this.config.get(key)]),
      ),
    );
  }

  // 与已登录核验共用 #133 的统一锁；学校网络永远在锁外。
  private transaction<T>(
    run: (tx: AccessTransaction) => Promise<T>,
  ): Promise<T> {
    return this.database.db.transaction(async (tx) => {
      await lockAccessTransaction(tx);
      return run(tx);
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

  private assertConsent(version: number) {
    const expected = this.settings().policyVersion;
    if (version !== expected)
      throw createApiError(
        400,
        "CAMPUS_CONSENT_MISMATCH",
        "请确认当前统一身份认证说明",
        { currentVersion: expected },
      );
  }

  // 拒绝的请求不转发校方；来源按可信客户端 IP 的 HMAC 索引，提交额外按学号盲索引。
  private async budget(
    kind: "challenge" | "submit",
    ip: string,
    account?: string,
  ) {
    const settings = this.settings();
    const windowMs = kind === "submit" ? 900_000 : 60_000;
    const limit = (name: string, fallback: number) =>
      this.config.get<number>(name, fallback);
    const scopes: Array<[string, string, number]> = [
      [
        "GLOBAL",
        "all",
        kind === "challenge"
          ? limit("CAMPUS_RATE_LOGIN_GLOBAL", SCHOOL_LOGIN_LIMITS.global)
          : limit(
              "CAMPUS_RATE_SUBMIT_GLOBAL",
              SCHOOL_LOGIN_LIMITS.submitGlobal,
            ),
      ],
      [
        "SOURCE",
        subjectIndex(settings, "login-rate-source", ip),
        kind === "challenge"
          ? limit("CAMPUS_RATE_LOGIN_SOURCE", SCHOOL_LOGIN_LIMITS.source)
          : limit(
              "CAMPUS_RATE_SUBMIT_SOURCE",
              SCHOOL_LOGIN_LIMITS.submitSource,
            ),
      ],
    ];
    if (account !== undefined)
      scopes.push([
        "ACCOUNT",
        subjectIndex(settings, "login-rate-account", account),
        limit("CAMPUS_RATE_LOGIN_ACCOUNT", SCHOOL_LOGIN_LIMITS.account),
      ]);
    const allowed = await this.transaction(async (tx) => {
      const now = this.clock.now();
      let ok = true;
      for (const [scope, subject, scopeLimit] of scopes) {
        const hit = await consumeBudget(tx, {
          kind: `login-${kind}`,
          scope,
          subject,
          limit: scopeLimit,
          windowMs,
          now,
        });
        ok = hit && ok;
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
    if (this.inFlight >= MAX_UPSTREAM_IN_FLIGHT)
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

  private view(row: Transaction): SchoolLoginTransactionView {
    return {
      id: row.id,
      status: row.status,
      expiresAt: row.expiresAt.toISOString(),
      reason: row.reason,
    };
  }

  // 持有凭证不命中、事务不存在一律 404，不泄露事务是否存在。
  private async owned(
    tx: AccessTransaction,
    id: string,
    holderHash: string,
  ): Promise<Transaction> {
    const [row] = await tx
      .select()
      .from(schoolLoginTransactions)
      .where(
        and(
          eq(schoolLoginTransactions.id, id),
          eq(schoolLoginTransactions.holderHash, holderHash),
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

  private async terminate(
    tx: AccessTransaction,
    row: Transaction,
    status: string,
    reason: string,
    now: Date,
  ): Promise<Transaction> {
    const [updated] = await tx
      .update(schoolLoginTransactions)
      .set({
        status,
        reason,
        operation: null,
        challengeVersion: null,
        finishedAt: now,
      })
      .where(eq(schoolLoginTransactions.id, row.id))
      .returning();
    return updated!;
  }

  private async fail(id: string, reason: string, requestId: string) {
    await this.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(schoolLoginTransactions)
        .where(eq(schoolLoginTransactions.id, id));
      if (!row || !ACTIVE.includes(row.status)) return;
      const now = this.clock.now();
      await this.terminate(tx, row, "failed", reason, now);
      // 匿名事务没有平台账号，只能用不带用户引用的认证审计记录安全原因。
      await this.repository.recordAudit(
        {
          kind: "campus_login_failed",
          requestId,
          metadata: { reason },
          now,
        },
        tx,
      );
    });
  }

  private async acceptChallenge(
    id: string,
    holderHash: string,
    challenge: AuthChallenge,
    holderToken: string,
  ): Promise<SchoolLoginChallengeView> {
    return this.transaction(async (tx) => {
      const row = await this.owned(tx, id, holderHash),
        now = this.clock.now();
      this.requireEnabled(now);
      if (
        row.status !== "processing" ||
        !["create", "refresh"].includes(row.operation ?? "") ||
        now >= row.expiresAt ||
        !this.live.has(id)
      )
        throw createApiError(
          409,
          "CAMPUS_TRANSACTION_ENDED",
          "认证事务已结束，请重新发起",
        );
      const [updated] = await tx
        .update(schoolLoginTransactions)
        .set({
          status: "waiting",
          operation: null,
          challengeVersion: challenge.challengeVersion,
        })
        .where(eq(schoolLoginTransactions.id, id))
        .returning();
      return {
        ...this.view(updated!),
        holderToken,
        challenge: {
          version: challenge.challengeVersion,
          imageDataUrl: challenge.imageDataUrl,
          expiresAt: new Date(
            Math.min(challenge.expiresAt, row.expiresAt.getTime()),
          ).toISOString(),
        },
      };
    });
  }

  /** 匿名客户端申请短期认证事务并取得验证码与不可猜测的持有凭证。 */
  async create(
    ip: string,
    requestId: string,
  ): Promise<SchoolLoginChallengeView> {
    await this.maintain();
    this.requireEnabled(this.clock.now());
    await this.budget("challenge", ip);
    const holderToken = generateToken();
    const holderHash = hashToken(holderToken);
    const row = await this.transaction(async (tx) => {
      const now = this.clock.now();
      this.requireEnabled(now);
      const active = await tx
        .select({ id: schoolLoginTransactions.id })
        .from(schoolLoginTransactions)
        .where(inArray(schoolLoginTransactions.status, ACTIVE));
      if (active.length >= MAX_ACTIVE)
        throw createApiError(
          503,
          "CAMPUS_SESSION_CAPACITY",
          "统一身份认证服务繁忙",
        );
      const id = randomUUID();
      const [created] = await tx
        .insert(schoolLoginTransactions)
        .values({
          id,
          holderHash,
          instanceId: this.instanceId,
          status: "processing",
          operation: "create",
          createdAt: now,
          expiresAt: new Date(now.getTime() + TRANSACTION_TTL_MS),
        })
        .returning();
      this.live.set(id, { holderHash, controller: new AbortController() });
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
      return await this.acceptChallenge(
        row.id,
        holderHash,
        challenge,
        holderToken,
      );
    } catch (error) {
      try {
        await this.fail(row.id, safeSchoolReason(error), requestId);
      } finally {
        this.drop(row.id);
      }
      throw schoolApiError(error);
    }
  }

  /** 刷新验证码；不延长总期限，也不重建持有凭证。 */
  async refreshChallenge(
    id: string,
    holderToken: string,
    ip: string,
    requestId: string,
  ): Promise<SchoolLoginChallengeView> {
    await this.maintain();
    this.requireEnabled(this.clock.now());
    const holderHash = hashToken(holderToken);
    await this.transaction(async (tx) => {
      const row = await this.owned(tx, id, holderHash);
      if (row.status !== "waiting")
        throw createApiError(
          409,
          "CAMPUS_TRANSACTION_BUSY",
          "认证事务当前不可刷新",
        );
    });
    await this.budget("challenge", ip);
    await this.transaction(async (tx) => {
      const row = await this.owned(tx, id, holderHash);
      if (row.status !== "waiting")
        throw createApiError(
          409,
          "CAMPUS_TRANSACTION_BUSY",
          "认证事务当前不可刷新",
        );
      await tx
        .update(schoolLoginTransactions)
        .set({
          status: "processing",
          operation: "refresh",
          challengeVersion: null,
        })
        .where(eq(schoolLoginTransactions.id, id));
    });
    try {
      const live = this.live.get(id);
      if (!live?.handle) throw new SchoolAuthError("invalid_session");
      const challenge = await this.upstream(() =>
        this.school.refreshChallenge(live.handle!, live.controller.signal),
      );
      return await this.acceptChallenge(id, holderHash, challenge, holderToken);
    } catch (error) {
      try {
        await this.fail(id, safeSchoolReason(error), requestId);
      } finally {
        this.drop(id);
      }
      throw schoolApiError(error);
    }
  }

  /**
   * 提交姓名、学号、密码与验证码。校方返回后先逐字比对，再进入短事务建号并签发会话；
   * 已终结的事务只回放安全状态，不重放密码，也不二次下发凭据。
   */
  async submit(
    id: string,
    holderToken: string,
    input: SchoolLoginSubmitInput,
    ip: string,
    requestId: string,
  ): Promise<SchoolLoginCredentialView> {
    await this.maintain();
    const holderHash = hashToken(holderToken);
    const existing = await this.transaction(async (tx) => {
      const row = await this.owned(tx, id, holderHash);
      if (row.status !== "waiting") return this.view(row);
      if (row.challengeVersion !== input.challengeVersion)
        throw createApiError(409, "CAMPUS_STALE_CHALLENGE", "验证码版本已变化");
      return null;
    });
    if (existing) return existing;
    this.requireEnabled(this.clock.now());
    this.assertConsent(input.consentVersion);
    await this.budget("submit", ip, input.account.trim());
    const admitted = await this.transaction(async (tx) => {
      const row = await this.owned(tx, id, holderHash),
        now = this.clock.now();
      if (row.status !== "waiting") return this.view(row);
      this.requireEnabled(now);
      if (now >= row.expiresAt)
        return this.view(
          await this.terminate(tx, row, "expired", "expired", now),
        );
      if (row.challengeVersion !== input.challengeVersion)
        throw createApiError(409, "CAMPUS_STALE_CHALLENGE", "验证码版本已变化");
      await tx
        .update(schoolLoginTransactions)
        .set({ status: "processing", operation: "submit" })
        .where(eq(schoolLoginTransactions.id, id));
      return null;
    });
    if (admitted) {
      if (admitted.status !== "processing") this.drop(id);
      return admitted;
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
      return await this.commitLogin(
        id,
        holderHash,
        input.challengeVersion,
        identity,
        requestId,
      );
    } catch (error) {
      await this.fail(id, safeSchoolReason(error), requestId);
      throw schoolApiError(error);
    } finally {
      this.drop(id);
    }
  }

  // 唯一一次「建号 + 绑定 + 资料 + 资格 + 会话 + 令牌」短事务；学校请求早已结束。
  private async commitLogin(
    id: string,
    holderHash: string,
    version: string,
    identity: AuthIdentity,
    requestId: string,
  ): Promise<SchoolLoginCredentialView> {
    const tokens = generateTokenPair();
    const outcome = await this.transaction(async (tx) => {
      const row = await this.owned(tx, id, holderHash),
        now = this.clock.now();
      const { settings, term } = this.requireEnabled(now);
      if (
        row.status !== "processing" ||
        row.operation !== "submit" ||
        row.challengeVersion !== version ||
        now >= row.expiresAt ||
        !this.live.has(id)
      )
        throw createApiError(
          409,
          "CAMPUS_TRANSACTION_ENDED",
          "认证事务已结束，请重新发起",
        );
      const digest = subjectIndex(settings, identity.source, identity.subject);
      const { user, created } = await this.repository.findOrCreateSchoolUser(
        tx,
        {
          source: SOURCE,
          subjectHmac: digest,
          defaultNickname: DEFAULT_NICKNAME,
          now,
        },
      );
      if (user.status !== "active") {
        // 受限/注销中账号不得签发新会话，也不得靠重新建号绕过限制。
        await this.terminate(tx, row, "failed", "account_restricted", now);
        await this.repository.recordAudit(
          {
            kind: "campus_login_rejected_account",
            userId: user.id,
            requestId,
            metadata: { status: user.status },
            now,
          },
          tx,
        );
        return { rejected: user as UserRecord };
      }
      const profile = {
        ...sealProfile(settings, user.id, SOURCE, {
          accountNumber: identity.accountNumber,
          name: identity.name,
        }),
        source: SOURCE,
        updatedAt: now,
      };
      await tx
        .insert(campusProfiles)
        .values({ userId: user.id, ...profile })
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
        .values({ userId: user.id, ...qualification })
        .onConflictDoUpdate({
          target: campusQualifications.userId,
          set: qualification,
        });
      await tx.insert(campusAuditLogs).values({
        id: randomUUID(),
        userId: user.id,
        requestId,
        kind: "succeeded",
        reason: null,
        createdAt: now,
      });
      const session = await this.repository.issueSessionInTx(tx, {
        userId: user.id,
        tokens,
        now,
      });
      const finished = await this.terminate(
        tx,
        row,
        "succeeded",
        "verified",
        now,
      );
      await this.repository.recordAudit(
        {
          kind: "campus_login_succeeded",
          userId: user.id,
          sessionId: session.id,
          requestId,
          metadata: { method: SOURCE, created },
          now,
        },
        tx,
      );
      return { rejected: null, user, session, expiresAt: finished.expiresAt };
    });
    if (outcome.rejected)
      throw createApiError(403, "ACCOUNT_RESTRICTED", "账号当前受限，无法登录");
    const { user, session, expiresAt } = outcome as {
      user: UserRecord;
      session: { id: string; absoluteExpiresAt: Date };
      expiresAt: Date;
    };
    return {
      id,
      status: "succeeded",
      expiresAt: expiresAt.toISOString(),
      reason: "verified",
      credential: {
        kind: "active",
        user: { id: user.id, nickname: user.nickname, status: user.status },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessExpiresAt: accessExpiry(this.clock.now()).toISOString(),
        sessionExpiresAt: session.absoluteExpiresAt.toISOString(),
      },
    };
  }

  async get(
    id: string,
    holderToken: string,
  ): Promise<SchoolLoginTransactionView> {
    await this.maintain();
    const holderHash = hashToken(holderToken);
    return this.transaction(async (tx) =>
      this.view(await this.owned(tx, id, holderHash)),
    );
  }

  async cancel(
    id: string,
    holderToken: string,
    requestId: string,
  ): Promise<SchoolLoginTransactionView> {
    const holderHash = hashToken(holderToken);
    const result = await this.transaction(async (tx) => {
      const row = await this.owned(tx, id, holderHash);
      if (!ACTIVE.includes(row.status)) return this.view(row);
      const now = this.clock.now();
      const updated = await this.terminate(
        tx,
        row,
        "cancelled",
        "cancelled",
        now,
      );
      await this.repository.recordAudit(
        {
          kind: "campus_login_cancelled",
          requestId,
          metadata: { reason: "cancelled" },
          now,
        },
        tx,
      );
      return this.view(updated);
    });
    this.drop(id);
    return result;
  }

  @Cron("*/10 * * * * *", {
    name: "school-login-cleanup",
    waitForCompletion: true,
  })
  async scheduledMaintenance() {
    if (
      this.config.get("NODE_ENV") === "test" ||
      !this.config.get("DATABASE_URL")
    )
      return;
    try {
      await this.maintain();
    } catch {
      this.logger.warn("学校登录事务清理未完成，将继续重试");
    }
  }

  // 过期、入口关闭、跨实例和失去持有凭证的事务一律终结，并销毁校方句柄。
  async maintain() {
    const ended = await this.transaction(async (tx) => {
      const now = this.clock.now(),
        settings = this.settings();
      const rows = await tx
        .select()
        .from(schoolLoginTransactions)
        .where(inArray(schoolLoginTransactions.status, ACTIVE));
      const ids: string[] = [];
      const activeIds = new Set(rows.map((row) => row.id));
      for (const id of this.live.keys()) if (!activeIds.has(id)) ids.push(id);
      for (const row of rows) {
        const expired = now >= row.expiresAt;
        if (
          expired ||
          row.instanceId !== this.instanceId ||
          !settings.enabled ||
          !this.live.has(row.id)
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
        .delete(schoolLoginTransactions)
        .where(
          lt(
            schoolLoginTransactions.finishedAt,
            new Date(now.getTime() - 86_400_000),
          ),
        );
      return ids;
    });
    for (const id of ended) this.drop(id);
  }

  onApplicationShutdown() {
    this.shuttingDown = true;
    for (const id of this.live.keys()) this.drop(id);
  }
}
