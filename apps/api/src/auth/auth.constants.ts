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
export const WECHAT_PROVIDER = "WECHAT_PROVIDER";
