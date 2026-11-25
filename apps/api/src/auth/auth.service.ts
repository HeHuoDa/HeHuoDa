import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { IncomingHttpHeaders } from "node:http";
import { AuthClock } from "./auth-clock.js";
import {
  CURRENT_CONSENT_VERSION,
  DEFAULT_NICKNAME,
  RATE_LIMIT_DEFAULTS,
  RATE_LIMIT_WINDOW_SECONDS,
  WECHAT_PROVIDER,
  type UserStatus,
} from "./auth.constants.js";
import { authenticateBearerAccess } from "./auth.guard.js";
import {
  accessExpiry,
  AuthRepository,
  type AccessContext,
} from "./auth.repository.js";
import {
  generateH5TokenPair,
  generateTokenPair,
  hashToken,
  isH5RefreshToken,
  isNativeRefreshToken,
} from "./auth-token.js";
import {
  assertConfiguredH5Security,
  buildConfiguredH5Cookie,
  clearConfiguredH5Cookie,
} from "./h5-security.js";
import { AuthRateLimiter, windowStart } from "./auth-rate-limiter.js";
import type { WechatProvider } from "./wechat/wechat-provider.js";
import { createApiError } from "../common/api-error.js";
import { AccountLifecycle } from "../business-access/lifecycle.service.js";
import { CampusService } from "../campus/campus.service.js";

export interface RequestContext {
  requestId: string;
  ip: string;
}

export interface CredentialResult {
  kind: "active";
  user: { id: string; nickname: string; status: UserStatus };
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  sessionExpiresAt: string;
}

export interface ProfileResult {
  user: { id: string; nickname: string; status: UserStatus };
  campus: {
    status: "unverified" | "valid" | "expired" | "revoked";
    termId: string | null;
    verifiedAt: string | null;
    validUntil: string | null;
    maskedAccountNumber?: string;
  };
  availability: { teaming: false };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly repository: AuthRepository,
    private readonly rateLimiter: AuthRateLimiter,
    @Inject(WECHAT_PROVIDER) private readonly provider: WechatProvider,
    private readonly clock: AuthClock,
    private readonly lifecycle: AccountLifecycle,
    private readonly campus: CampusService,
  ) {}

  async wechatLogin(
    input: { code: string; consentVersion: number },
    ctx: RequestContext,
  ): Promise<CredentialResult> {
    this.assertLoginEnabled();
    if (input.consentVersion !== CURRENT_CONSENT_VERSION)
      throw createApiError(
        400,
        "CONSENT_VERSION_MISMATCH",
        "协议版本不一致，请确认最新版本",
        {
          currentVersion: CURRENT_CONSENT_VERSION,
        },
      );
    const now = this.clock.now();
    await this.enforceRate(
      "login-global",
      "all",
      "AUTH_RATE_LOGIN_GLOBAL",
      RATE_LIMIT_DEFAULTS.loginGlobal,
      now,
    );
    await this.enforceRate(
      "login-source",
      ctx.ip,
      "AUTH_RATE_LOGIN_PER_SOURCE",
      RATE_LIMIT_DEFAULTS.loginPerSource,
      now,
    );

    const exchange = await this.provider.exchange(input.code);
    if (!exchange.ok) {
      await this.repository.recordAudit({
        kind: "login_failed",
        requestId: ctx.requestId,
        metadata: { reason: exchange.reason },
        now,
      });
      if (exchange.reason === "invalid_code")
        throw createApiError(
          401,
          "WECHAT_CODE_INVALID",
          "微信登录失败，请重试",
        );
      throw createApiError(
        503,
        "WECHAT_UPSTREAM_UNAVAILABLE",
        "微信登录服务暂不可用，请稍后重试",
      );
    }
    const appId = this.config.get<string>("WECHAT_APP_ID") ?? "";
    await this.enforceRate(
      "login-openid",
      appId + ":" + exchange.identity.openId,
      "AUTH_RATE_LOGIN_PER_IDENTITY",
      RATE_LIMIT_DEFAULTS.loginPerIdentity,
      now,
    );

    const { user, created } = await this.repository.findOrCreateWechatUser({
      appId,
      openId: exchange.identity.openId,
      unionId: exchange.identity.unionId,
      defaultNickname: DEFAULT_NICKNAME,
      now,
    });
    if (user.status !== "active") {
      await this.repository.recordAudit({
        kind: "login_rejected_account",
        userId: user.id,
        requestId: ctx.requestId,
        metadata: { status: user.status },
        now,
      });
      throw createApiError(403, "ACCOUNT_RESTRICTED", "账号当前受限，无法登录");
    }
    const tokens = generateTokenPair();
    const session = await this.repository.createSession({
      userId: user.id,
      tokens,
      now,
    });
    await this.repository.recordAudit({
      kind: "login_succeeded",
      userId: user.id,
      sessionId: session.id,
      requestId: ctx.requestId,
      metadata: { created },
      now,
    });
    return {
      kind: "active",
      user: { id: user.id, nickname: user.nickname, status: user.status },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessExpiresAt: accessExpiry(now).toISOString(),
      sessionExpiresAt: session.absoluteExpiresAt.toISOString(),
    };
  }

  async refresh(
    input: { refreshToken: string | null; rejectedReason?: string },
    ctx: RequestContext,
    channel: "native" | "h5" = "native",
  ): Promise<CredentialResult> {
    this.assertSessionChannelEnabled();
    const now = this.clock.now();
    await this.enforceRate(
      "refresh-global",
      "all",
      "AUTH_RATE_REFRESH_GLOBAL",
      RATE_LIMIT_DEFAULTS.refreshGlobal,
      now,
    );
    await this.enforceRate(
      "refresh-source",
      ctx.ip,
      "AUTH_RATE_REFRESH_PER_SUBJECT",
      RATE_LIMIT_DEFAULTS.refreshPerSubject,
      now,
    );
    const rawToken = input.refreshToken;
    const validFormat =
      rawToken !== null &&
      (channel === "h5"
        ? isH5RefreshToken(rawToken)
        : isNativeRefreshToken(rawToken));
    if (!validFormat) {
      await this.recordRefreshRejected(
        ctx.requestId,
        input.rejectedReason ?? "invalid_format",
        now,
      );
      throw createApiError(
        401,
        "INVALID_REFRESH_TOKEN",
        "登录状态已失效，请重新登录",
      );
    }
    await this.enforceRate(
      "refresh-token",
      hashToken(rawToken),
      "AUTH_RATE_REFRESH_PER_SUBJECT",
      RATE_LIMIT_DEFAULTS.refreshPerSubject,
      now,
    );
    const tokens =
      channel === "h5" ? generateH5TokenPair() : generateTokenPair();
    const outcome = await this.repository.rotateWithRefresh({
      refreshToken: rawToken,
      tokens,
      now,
    });
    switch (outcome.kind) {
      case "rotated": {
        await this.repository.recordAudit({
          kind: "refresh_rotated",
          userId: outcome.user.id,
          sessionId: outcome.session.id,
          requestId: ctx.requestId,
          now,
        });
        return {
          kind: "active",
          user: {
            id: outcome.user.id,
            nickname: outcome.user.nickname,
            status: outcome.user.status,
          },
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          accessExpiresAt: accessExpiry(now).toISOString(),
          sessionExpiresAt: outcome.session.absoluteExpiresAt.toISOString(),
        };
      }
      case "replay": {
        await this.repository.recordAudit({
          kind: "refresh_replay",
          sessionId: outcome.sessionId,
          requestId: ctx.requestId,
          now,
        });
        throw createApiError(
          401,
          "REFRESH_TOKEN_REPLAY",
          "登录状态已失效，请重新登录",
        );
      }
      case "account": {
        await this.repository.recordAudit({
          kind: "refresh_rejected",
          userId: outcome.user?.id ?? null,
          requestId: ctx.requestId,
          metadata: { reason: "account" },
          now,
        });
        throw createApiError(
          403,
          "ACCOUNT_RESTRICTED",
          "账号当前受限，请重新登录",
        );
      }
      default: {
        await this.recordRefreshRejected(ctx.requestId, outcome.kind, now);
        throw createApiError(
          401,
          "INVALID_REFRESH_TOKEN",
          "登录状态已失效，请重新登录",
        );
      }
    }
  }

  assertH5Security(headers: IncomingHttpHeaders): void {
    assertConfiguredH5Security(this.config, headers);
  }

  buildH5Cookie(refreshToken: string, sessionExpiresAt: Date): string {
    return buildConfiguredH5Cookie(
      this.config,
      this.clock.now(),
      refreshToken,
      sessionExpiresAt,
    );
  }

  clearH5Cookie(): string {
    return clearConfiguredH5Cookie(this.config);
  }

  async authenticateAccess(
    authorization: string | undefined,
  ): Promise<AccessContext> {
    return authenticateBearerAccess(this.repository, this.clock, authorization);
  }

  async logoutByRefresh(
    refreshToken: string,
    requestId: string,
    onCommitted: () => void,
  ): Promise<void> {
    const result = await this.repository.revokeSessionByRefreshToken(
      refreshToken,
      this.clock.now(),
      requestId,
    );
    onCommitted();
    if (result.revoked && result.userId && result.sessionId) {
      await this.lifecycle.destroySchoolSessions({
        userId: result.userId,
        sessionId: result.sessionId,
      });
    }
  }

  // 退出只要求会话仍然有效（含受限账号），保证客户端总能清理远端会话。
  async logout(access: AccessContext, requestId: string): Promise<void> {
    await this.repository.withAccessTransaction(async (tx) => {
      const now = this.clock.now();
      await this.repository.assertCurrentContext(tx, access, now);
      await this.repository.revokeSession(access.sessionId, "logout", now, tx);
      await this.repository.recordAudit(
        {
          kind: "session_revoked",
          userId: access.user.id,
          sessionId: access.sessionId,
          requestId,
          metadata: { reason: "logout" },
          now,
        },
        tx,
      );
    });
    await this.lifecycle.destroySchoolSessions({
      userId: access.user.id,
      sessionId: access.sessionId,
    });
  }

  async me(access: AccessContext): Promise<ProfileResult> {
    this.ensureActive(access);
    return this.profileOf(access);
  }

  async updateNickname(
    access: AccessContext,
    input: { nickname: string },
    requestId: string,
  ): Promise<ProfileResult> {
    this.ensureActive(access);
    const nickname = input.nickname.trim();
    if (nickname.length < 1 || nickname.length > 20)
      throw createApiError(400, "NICKNAME_INVALID", "昵称须为 1–20 个字符");
    const now = this.clock.now();
    const user = await this.repository.updateNickname(
      access.user.id,
      nickname,
      now,
    );
    await this.repository.recordAudit({
      kind: "nickname_changed",
      userId: user.id,
      sessionId: access.sessionId,
      requestId,
      now,
    });
    return this.profileOf({ ...access, user });
  }

  private assertLoginEnabled(): void {
    if (!this.config.get<boolean>("WECHAT_LOGIN_ENABLED", false))
      throw createApiError(
        503,
        "WECHAT_LOGIN_UNAVAILABLE",
        "微信登录服务暂未开放",
      );
  }

  // 刷新与会话读取属于平台会话能力，只有所有登录通道都关闭时才停用，
  // 保证仅开启学校唯一登录（无微信配置）时刷新与登出正常。
  // 错误码沿用既有常量，实际下线由 #223 收口。
  private assertSessionChannelEnabled(): void {
    if (
      this.config.get<boolean>("WECHAT_LOGIN_ENABLED", false) ||
      this.config.get<boolean>("CAMPUS_VERIFICATION_ENABLED", false)
    )
      return;
    throw createApiError(503, "WECHAT_LOGIN_UNAVAILABLE", "登录服务暂未开放");
  }

  private async enforceRate(
    kind: string,
    subject: string,
    limitKey: string,
    defaultLimit: number,
    now: Date,
  ): Promise<void> {
    const limit = this.config.get<number>(limitKey, defaultLimit);
    const count = await this.rateLimiter.consume(kind, subject, now);
    if (count > limit) {
      const windowEnd =
        windowStart(now).getTime() + RATE_LIMIT_WINDOW_SECONDS * 1000;
      throw createApiError(
        429,
        "TOO_MANY_REQUESTS",
        "请求过于频繁，请稍后重试",
        {
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((windowEnd - now.getTime()) / 1000),
          ),
        },
      );
    }
  }

  private async recordRefreshRejected(
    requestId: string,
    reason: string,
    now: Date,
  ): Promise<void> {
    await this.repository.recordAudit({
      kind: "refresh_rejected",
      requestId,
      metadata: { reason },
      now,
    });
  }

  private ensureActive(access: AccessContext): void {
    if (access.user.status !== "active")
      throw createApiError(403, "ACCOUNT_RESTRICTED", "账号当前受限");
  }
  private async profileOf(access: AccessContext): Promise<ProfileResult> {
    return this.repository.withAccessTransaction(async (tx) => {
      await this.repository.assertCurrentContext(tx, access, this.clock.now());
      const summary = await this.campus.summary(tx, access.user.id);
      const maskedAccountNumber =
        summary.status === "valid"
          ? await this.campus.maskedAccountNumber(tx, access.user.id)
          : undefined;
      return {
        user: {
          id: access.user.id,
          nickname: access.user.nickname,
          status: access.user.status,
        },
        campus: {
          status: summary.status,
          termId: summary.termId,
          verifiedAt: summary.verifiedAt,
          validUntil: summary.validUntil,
          ...(maskedAccountNumber ? { maskedAccountNumber } : {}),
        },
        availability: { teaming: false },
      };
    });
  }
}
