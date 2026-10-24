import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.service.js";
import {
  authAuditLogs,
  authSessions,
  authTokens,
  users,
  wechatIdentities,
} from "../database/schema.js";
import {
  ACCESS_TOKEN_MINUTES,
  REFRESH_SESSION_DAYS,
} from "./auth.constants.js";
import { hashToken, newId, type TokenPair } from "./auth-token.js";

export interface UserRecord {
  id: string;
  nickname: string;
  status: string;
}

export interface AccessContext {
  sessionId: string;
  generation: number;
  user: UserRecord;
}

export type RotateOutcome =
  | {
      kind: "rotated";
      session: { id: string; absoluteExpiresAt: Date };
      user: UserRecord;
    }
  | { kind: "unknown" }
  | { kind: "replay"; sessionId: string }
  | { kind: "rejected" }
  | { kind: "account"; user: UserRecord | null };

export type AuditKind =
  | "login_succeeded"
  | "login_failed"
  | "login_rejected_account"
  | "refresh_rotated"
  | "refresh_replay"
  | "refresh_rejected"
  | "session_revoked"
  | "nickname_changed";

export function accessExpiry(now: Date): Date {
  return new Date(now.getTime() + ACCESS_TOKEN_MINUTES * 60_000);
}

export function sessionExpiry(now: Date): Date {
  return new Date(now.getTime() + REFRESH_SESSION_DAYS * 24 * 60 * 60_000);
}

@Injectable()
export class AuthRepository {
  constructor(private readonly database: DatabaseService) {}

  // 同一 (AppID,OpenID) 的并发登录用咨询锁串行，数据库唯一约束兜底，
  // 保证首次/重复/并发登录只落一个账号。
  async findOrCreateWechatUser(input: {
    appId: string;
    openId: string;
    unionId: string | null;
    defaultNickname: string;
    now: Date;
  }): Promise<{ user: UserRecord; created: boolean }> {
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${"wechat-identity:" + input.appId + ":" + input.openId}))`,
      );
      const [identity] = await tx
        .select({ userId: wechatIdentities.userId })
        .from(wechatIdentities)
        .where(
          and(
            eq(wechatIdentities.appId, input.appId),
            eq(wechatIdentities.openId, input.openId),
          ),
        );
      if (identity) {
        const [user] = await tx
          .select({
            id: users.id,
            nickname: users.nickname,
            status: users.status,
          })
          .from(users)
          .where(eq(users.id, identity.userId));
        return { user: user!, created: false };
      }
      const userId = newId();
      await tx.insert(users).values({
        id: userId,
        nickname: input.defaultNickname,
        createdAt: input.now,
        updatedAt: input.now,
      });
      await tx.insert(wechatIdentities).values({
        id: newId(),
        appId: input.appId,
        openId: input.openId,
        unionId: input.unionId,
        userId,
        createdAt: input.now,
      });
      return {
        user: { id: userId, nickname: input.defaultNickname, status: "active" },
        created: true,
      };
    });
  }

  async createSession(input: {
    userId: string;
    tokens: TokenPair;
    now: Date;
  }): Promise<{ id: string; absoluteExpiresAt: Date; generation: number }> {
    const absoluteExpiresAt = sessionExpiry(input.now);
    return this.database.db.transaction(async (tx) => {
      const sessionId = newId();
      await tx.insert(authSessions).values({
        id: sessionId,
        userId: input.userId,
        createdAt: input.now,
        absoluteExpiresAt,
      });
      await tx.insert(authTokens).values({
        id: newId(),
        sessionId,
        generation: 1,
        accessHash: hashToken(input.tokens.accessToken),
        accessExpiresAt: accessExpiry(input.now),
        refreshHash: hashToken(input.tokens.refreshToken),
        refreshExpiresAt: absoluteExpiresAt,
        createdAt: input.now,
      });
      return { id: sessionId, absoluteExpiresAt, generation: 1 };
    });
  }

  // 原子消费旧刷新凭据并发放新代次；已消费凭据再次出现时撤销整个会话族。
  // 刷新绝不延长会话绝对期限。
  async rotateWithRefresh(input: {
    refreshToken: string;
    tokens: TokenPair;
    now: Date;
  }): Promise<RotateOutcome> {
    const refreshHash = hashToken(input.refreshToken);
    return this.database.db.transaction(async (tx) => {
      const [token] = await tx
        .select()
        .from(authTokens)
        .where(eq(authTokens.refreshHash, refreshHash))
        .for("update");
      if (!token) return { kind: "unknown" } as const;
      const [session] = await tx
        .select()
        .from(authSessions)
        .where(eq(authSessions.id, token.sessionId));
      if (!session) return { kind: "unknown" } as const;
      const [user] = await tx
        .select({
          id: users.id,
          nickname: users.nickname,
          status: users.status,
        })
        .from(users)
        .where(eq(users.id, session.userId));
      if (token.consumedAt) {
        await tx
          .update(authSessions)
          .set({ revokedAt: input.now, revokedReason: "refresh_replay" })
          .where(
            and(
              eq(authSessions.id, session.id),
              isNull(authSessions.revokedAt),
            ),
          );
        return { kind: "replay", sessionId: session.id } as const;
      }
      if (
        session.revokedAt ||
        input.now >= session.absoluteExpiresAt ||
        input.now >= token.refreshExpiresAt
      )
        return { kind: "rejected" } as const;
      if (!user || user.status !== "active")
        return { kind: "account", user: user ?? null } as const;
      await tx
        .update(authTokens)
        .set({ consumedAt: input.now })
        .where(eq(authTokens.id, token.id));
      await tx.insert(authTokens).values({
        id: newId(),
        sessionId: session.id,
        generation: token.generation + 1,
        accessHash: hashToken(input.tokens.accessToken),
        accessExpiresAt: accessExpiry(input.now),
        refreshHash: hashToken(input.tokens.refreshToken),
        refreshExpiresAt: session.absoluteExpiresAt,
        createdAt: input.now,
      });
      return {
        kind: "rotated",
        session: {
          id: session.id,
          absoluteExpiresAt: session.absoluteExpiresAt,
        },
        user,
      } as const;
    });
  }

  // 会话维度的访问校验：凭据、代次、撤销与到期任一不满足即视为未登录；
  // 账号状态由调用方另行判断（403），避免把受限账号混同于无效凭据。
  async findActiveAccess(
    accessToken: string,
    now: Date,
  ): Promise<AccessContext | undefined> {
    const [row] = await this.database.db
      .select({
        sessionId: authTokens.sessionId,
        generation: authTokens.generation,
        consumedAt: authTokens.consumedAt,
        accessExpiresAt: authTokens.accessExpiresAt,
        revokedAt: authSessions.revokedAt,
        absoluteExpiresAt: authSessions.absoluteExpiresAt,
        userId: users.id,
        nickname: users.nickname,
        status: users.status,
      })
      .from(authTokens)
      .innerJoin(authSessions, eq(authSessions.id, authTokens.sessionId))
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(eq(authTokens.accessHash, hashToken(accessToken)));
    if (!row) return undefined;
    if (row.consumedAt) return undefined;
    if (now >= row.accessExpiresAt) return undefined;
    if (row.revokedAt) return undefined;
    if (now >= row.absoluteExpiresAt) return undefined;
    return {
      sessionId: row.sessionId,
      generation: row.generation,
      user: { id: row.userId, nickname: row.nickname, status: row.status },
    };
  }

  async revokeSession(
    sessionId: string,
    reason: string,
    now: Date,
  ): Promise<void> {
    await this.database.db
      .update(authSessions)
      .set({ revokedAt: now, revokedReason: reason })
      .where(
        and(eq(authSessions.id, sessionId), isNull(authSessions.revokedAt)),
      );
  }

  async updateNickname(
    userId: string,
    nickname: string,
    now: Date,
  ): Promise<UserRecord> {
    const [user] = await this.database.db
      .update(users)
      .set({ nickname, updatedAt: now })
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        nickname: users.nickname,
        status: users.status,
      });
    return user!;
  }

  // 审计只存内部引用与安全元数据，不保存原始凭据、code 或上游原报文。
  async recordAudit(input: {
    kind: AuditKind;
    userId?: string | null;
    sessionId?: string | null;
    requestId: string;
    metadata?: Record<string, unknown>;
    now: Date;
  }): Promise<void> {
    await this.database.db.insert(authAuditLogs).values({
      id: newId(),
      kind: input.kind,
      userId: input.userId ?? null,
      sessionId: input.sessionId ?? null,
      requestId: input.requestId,
      metadata: input.metadata ?? {},
      createdAt: input.now,
    });
  }
}
