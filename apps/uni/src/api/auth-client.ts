import type { CredentialResponse, ProfileResponse } from "@hehuoda/api-types";
import { createHttpClient } from "./http.ts";

type HttpClient = ReturnType<typeof createHttpClient>;

const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;
const isoDate = (v: unknown): v is string =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const USER_STATUSES = ["active", "restricted", "closing", "deleted"] as const;

function isUser(v: unknown): boolean {
  return (
    object(v) &&
    text(v.id) &&
    text(v.nickname) &&
    USER_STATUSES.includes(v.status as (typeof USER_STATUSES)[number])
  );
}

export function isCredentialResponse(v: unknown): v is CredentialResponse {
  return (
    object(v) &&
    v.kind === "active" &&
    isUser(v.user) &&
    text(v.accessToken) &&
    text(v.refreshToken) &&
    isoDate(v.accessExpiresAt) &&
    isoDate(v.sessionExpiresAt)
  );
}

export function isProfileResponse(v: unknown): v is ProfileResponse {
  return (
    object(v) &&
    isUser(v.user) &&
    object(v.campus) &&
    v.campus.status === "unverified" &&
    [v.campus.termId, v.campus.verifiedAt, v.campus.validUntil].every(
      (x) => x === null || typeof x === "string",
    ) &&
    object(v.availability) &&
    typeof v.availability.teaming === "boolean"
  );
}

/** 登出成功为 204 无响应体，不校验内容。 */
function acceptsNoContent(data: unknown): data is unknown {
  void data;
  return true;
}

/** 与后端 CURRENT_CONSENT_VERSION 对齐；不匹配时以错误 details.currentVersion 为准更新。 */
export const CURRENT_CONSENT_VERSION = 1;

/** bare 客户端发登录与刷新（不携带凭据、不参与 401 协调）；authed 发会话内请求。 */
export function createAuthApi(bare: HttpClient, authed: HttpClient) {
  return {
    wechatLogin(code: string) {
      return bare.post(
        "/auth/wechat/login",
        { code, consentVersion: CURRENT_CONSENT_VERSION },
        isCredentialResponse,
      );
    },
    refresh(refreshToken: string) {
      return bare.post("/auth/refresh", { refreshToken }, isCredentialResponse);
    },
    logout() {
      return authed.post("/auth/logout", undefined, acceptsNoContent);
    },
    profile() {
      return authed.get("/auth/me", isProfileResponse);
    },
    updateNickname(nickname: string) {
      // wx.request 不支持 PATCH；POST /auth/me 是后端为微信小程序提供的别名。
      return authed.post("/auth/me", { nickname }, isProfileResponse);
    },
  };
}
