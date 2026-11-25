import type { IncomingHttpHeaders } from "node:http";
import type { ConfigService } from "@nestjs/config";
import { parseAllowedOrigins } from "../common/allowed-origins.js";
import { createApiError } from "../common/api-error.js";
import { isH5RefreshToken } from "./auth-token.js";
import type { UserStatus } from "./auth.constants.js";
import type { H5CredentialResponseDto } from "./auth.dto.js";

export const USER_REFRESH_COOKIE = "hh_user_refresh";
export const H5_REFRESH_COOKIE_PATH = "/api/v1/auth";
export const H5_CSRF_HEADER = "x-refresh-csrf";
export const H5_CSRF_VALUE = "1";

export type H5CookieRead =
  | { state: "absent" }
  | { state: "invalid" }
  | { state: "present"; token: string };

export function h5Origins(raw: string, production = false): string[] {
  return parseAllowedOrigins(raw, production, "H5");
}

export function readH5RefreshCookie(
  cookieHeader: string | string[] | undefined,
): H5CookieRead {
  const normalized = Array.isArray(cookieHeader)
    ? cookieHeader.join(";")
    : (cookieHeader ?? "");
  const matches = normalized
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(USER_REFRESH_COOKIE + "="));
  if (matches.length === 0) return { state: "absent" };
  // 重复同名 Cookie 视为非法，避免歧义选择。
  if (matches.length > 1) return { state: "invalid" };
  const value = matches[0]!.slice(USER_REFRESH_COOKIE.length + 1);
  return isH5RefreshToken(value)
    ? { state: "present", token: value }
    : { state: "invalid" };
}

export function isH5ChannelRequest(headers: IncomingHttpHeaders): boolean {
  return (
    readH5RefreshCookie(headers.cookie).state !== "absent" ||
    headers[H5_CSRF_HEADER] !== undefined
  );
}

function parseExactOrigin(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.hostname.includes("*") ||
      url.origin !== raw ||
      !["http:", "https:"].includes(url.protocol)
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

function parseRefererOrigin(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.origin === "null")
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

// 显式 Origin 优先，非法 Origin 绝不回退到 Referer；仅 Origin 缺失时解析 Referer 源并精确匹配。
export function assertH5OriginAndCsrf(
  headers: IncomingHttpHeaders,
  allowedOrigins: readonly string[],
): void {
  const sourceOrigin =
    headers.origin !== undefined
      ? parseExactOrigin(headers.origin)
      : parseRefererOrigin(headers.referer);
  const csrf = headers[H5_CSRF_HEADER];
  if (
    !sourceOrigin ||
    !allowedOrigins.includes(sourceOrigin) ||
    typeof csrf !== "string" ||
    csrf !== H5_CSRF_VALUE
  )
    throw createApiError(403, "FORBIDDEN", "禁止访问");
}

// 原生 JSON/Bearer 凭据签发与刷新不接受浏览器来源请求，避免网页脚本绕过 H5 Cookie 通道。
export function assertNativeClientBoundary(headers: IncomingHttpHeaders): void {
  const hasBrowserSignal =
    headers.origin !== undefined ||
    headers.referer !== undefined ||
    Object.keys(headers).some((key) => key.startsWith("sec-fetch-")) ||
    headers[H5_CSRF_HEADER] !== undefined ||
    readH5RefreshCookie(headers.cookie).state !== "absent";
  if (hasBrowserSignal) throw createApiError(403, "FORBIDDEN", "禁止访问");
}

export function assertConfiguredH5Security(
  config: ConfigService,
  headers: IncomingHttpHeaders,
): void {
  const origins = h5Origins(
    config.get<string>("H5_ALLOWED_ORIGINS", ""),
    config.get("NODE_ENV") === "production",
  );
  assertH5OriginAndCsrf(headers, origins);
}

export function buildConfiguredH5Cookie(
  config: ConfigService,
  now: Date,
  token: string,
  absoluteExpiresAt: Date,
): string {
  return buildH5RefreshCookie(
    token,
    absoluteExpiresAt,
    now,
    config.get("NODE_ENV") === "production",
  );
}

export function clearConfiguredH5Cookie(config: ConfigService): string {
  return clearH5RefreshCookie(config.get("NODE_ENV") === "production");
}

// 显式构造浏览器专用响应，避免内部含 refreshToken 的凭据对象直接序列化。
export function toH5Credential(input: {
  kind: "active";
  user: { id: string; nickname: string; status: UserStatus };
  accessToken: string;
  accessExpiresAt: string;
  sessionExpiresAt: string;
}): H5CredentialResponseDto {
  return {
    kind: input.kind,
    user: input.user,
    accessToken: input.accessToken,
    accessExpiresAt: input.accessExpiresAt,
    sessionExpiresAt: input.sessionExpiresAt,
  };
}

export function buildH5RefreshCookie(
  token: string,
  absoluteExpiresAt: Date,
  now: Date,
  production: boolean,
): string {
  const maxAgeSeconds = Math.max(
    0,
    Math.floor((absoluteExpiresAt.getTime() - now.getTime()) / 1000),
  );
  return `${USER_REFRESH_COOKIE}=${token}; Path=${H5_REFRESH_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}; Expires=${absoluteExpiresAt.toUTCString()}${production ? "; Secure" : ""}`;
}

export function clearH5RefreshCookie(production: boolean): string {
  return `${USER_REFRESH_COOKIE}=; Path=${H5_REFRESH_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=0${production ? "; Secure" : ""}`;
}
