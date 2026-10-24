export const CURRENT_CONSENT_VERSION = 1;
export const ACCESS_TOKEN_MINUTES = 15;
export const REFRESH_SESSION_DAYS = 30;
export const DEFAULT_NICKNAME = "微信用户";
export const RATE_LIMIT_WINDOW_SECONDS = 60;
export const USER_STATUS_VALUES = [
  "active",
  "restricted",
  "closing",
  "deleted",
] as const;
export type UserStatus = (typeof USER_STATUS_VALUES)[number];
export type SessionRevokeReason = "logout" | "refresh_replay";

// 迁移 0004 的 CHECK 约束保证 users.status 值域；未知值按受限处理，防失效开放。
export function asUserStatus(value: string): UserStatus {
  return (USER_STATUS_VALUES as readonly string[]).includes(value)
    ? (value as UserStatus)
    : "restricted";
}
export const WECHAT_PROVIDER = "WECHAT_PROVIDER";

// 限流预算默认值的唯一来源；env 校验与服务层兜底都引用这里，
// 调整预算时不再需要同步多处硬编码。
export const RATE_LIMIT_DEFAULTS = {
  loginPerSource: 10,
  loginPerIdentity: 20,
  loginGlobal: 300,
  refreshPerSubject: 20,
  refreshGlobal: 600,
} as const;
export const AUDIT_RETENTION_DAYS_DEFAULT = 180;
