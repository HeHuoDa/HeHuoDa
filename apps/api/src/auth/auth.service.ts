import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthClock } from "./auth-clock.js";
import {
  CURRENT_CONSENT_VERSION,
  DEFAULT_NICKNAME,
  RATE_LIMIT_DEFAULTS,
  RATE_LIMIT_WINDOW_SECONDS,
  WECHAT_PROVIDER,
  type UserStatus,
} from "./auth.constants.js";
import {
  accessExpiry,
  AuthRepository,
  type AccessContext,
} from "./auth.repository.js";
import { generateTokenPair, hashToken } from "./auth-token.js";
import { AuthRateLimiter, windowStart } from "./auth-rate-limiter.js";
import type { WechatProvider } from "./wechat/wechat-provider.js";
import { createApiError } from "../common/api-error.js";

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
    status: "unverified";
    termId: string | null;
    verifiedAt: string | null;
    validUntil: string | null;
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
    input: { refreshToken: string },
    ctx: RequestContext,
  ): Promise<CredentialResult> {
    this.assertLoginEnabled();
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
    await this.enforceRate(
      "refresh-token",
      hashToken(input.refreshToken),
      "AUTH_RATE_REFRESH_PER_SUBJECT",
      RATE_LIMIT_DEFAULTS.refreshPerSubject,
      now,
    );
    const tokens = generateTokenPair();
    const outcome = await this.repository.rotateWithRefresh({
      refreshToken: input.refreshToken,
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
        await this.repository.recordAudit({
          kind: "refresh_rejected",
          requestId: ctx.requestId,
          metadata: { reason: outcome.kind },
          now,
        });
        throw createApiError(
          401,
          "INVALID_REFRESH_TOKEN",
          "登录状态已失效，请重新登录",
        );
      }
    }
  }

  // 退出只要求会话仍然有效（含受限账号），保证客户端总能清理远端会话。
  async logout(access: AccessContext, requestId: string): Promise<void> {
    const now = this.clock.now();
    await this.repository.revokeSession(access.sessionId, "logout", now);
    await this.repository.recordAudit({
      kind: "session_revoked",
      userId: access.user.id,
      sessionId: access.sessionId,
      requestId,
      metadata: { reason: "logout" },
      now,
    });
  }

  me(access: AccessContext): ProfileResult {
    this.ensureActive(access);
    return profileOf(access);
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
    return profileOf({ ...access, user });
  }

  private assertLoginEnabled(): void {
    if (!this.config.get<boolean>("WECHAT_LOGIN_ENABLED", false))
      throw createApiError(
        503,
        "WECHAT_LOGIN_UNAVAILABLE",
        "微信登录服务暂未开放",
      );
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

  private ensureActive(access: AccessContext): void {
    if (access.user.status !== "active")
      throw createApiError(403, "ACCOUNT_RESTRICTED", "账号当前受限");
  }
}

function profileOf(access: AccessContext): ProfileResult {
  return {
    user: {
      id: access.user.id,
      nickname: access.user.nickname,
      status: access.user.status,
    },
    campus: {
      status: "unverified",
      termId: null,
      verifiedAt: null,
      validUntil: null,
    },
    availability: { teaming: false },
  };
}
