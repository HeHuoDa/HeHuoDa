import type {
  CampusPolicy,
  CredentialResponse,
  H5CredentialResponse,
  ProfileResponse,
  SchoolLoginChallenge,
  SchoolLoginH5Credential,
  SchoolLoginSubmit,
  SchoolLoginTransaction,
} from "@hehuoda/api-types";
import { isCampusPolicy } from "./campus-client.ts";
import { createHttpClient } from "./http.ts";

type HttpClient = ReturnType<typeof createHttpClient>;

const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;
const nullableText = (v: unknown): v is string | null => v === null || text(v);
const isoDate = (v: unknown): v is string =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const USER_STATUSES = ["active", "restricted", "closing", "deleted"] as const;
const TRANSACTION_STATUSES = [
  "waiting",
  "processing",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
] as const;

function isUser(v: unknown): boolean {
  return (
    object(v) &&
    text(v.id) &&
    text(v.nickname) &&
    USER_STATUSES.includes(v.status as (typeof USER_STATUSES)[number])
  );
}

function isChallengeData(v: unknown): boolean {
  return (
    object(v) &&
    text(v.version) &&
    isoDate(v.expiresAt) &&
    text(v.imageDataUrl) &&
    /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(
      v.imageDataUrl,
    ) &&
    v.imageDataUrl.length <= 1_500_000
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

export function isH5CredentialResponse(v: unknown): v is H5CredentialResponse {
  return (
    object(v) &&
    v.kind === "active" &&
    isUser(v.user) &&
    text(v.accessToken) &&
    v.refreshToken === undefined &&
    isoDate(v.accessExpiresAt) &&
    isoDate(v.sessionExpiresAt)
  );
}

export function isSchoolLoginTransaction(
  v: unknown,
): v is SchoolLoginTransaction {
  return (
    object(v) &&
    text(v.id) &&
    TRANSACTION_STATUSES.includes(
      v.status as (typeof TRANSACTION_STATUSES)[number],
    ) &&
    isoDate(v.expiresAt) &&
    nullableText(v.reason)
  );
}

export function isSchoolLoginChallenge(v: unknown): v is SchoolLoginChallenge {
  return (
    isSchoolLoginTransaction(v) &&
    text((v as Record<string, unknown>).holderToken) &&
    isChallengeData((v as Record<string, unknown>).challenge)
  );
}

export function isSchoolLoginH5Credential(
  v: unknown,
): v is SchoolLoginH5Credential {
  if (!isSchoolLoginTransaction(v)) return false;
  const credential = (v as Record<string, unknown>).credential;
  return credential === undefined || isH5CredentialResponse(credential);
}

export function isProfileResponse(v: unknown): v is ProfileResponse {
  return (
    object(v) &&
    isUser(v.user) &&
    object(v.campus) &&
    typeof v.campus.status === "string" &&
    ["unverified", "valid", "expired", "revoked"].includes(v.campus.status) &&
    [v.campus.termId, v.campus.verifiedAt, v.campus.validUntil].every(
      (x) => x === null || typeof x === "string",
    ) &&
    (v.campus.maskedAccountNumber === undefined ||
      (typeof v.campus.maskedAccountNumber === "string" &&
        /^••••\d{2}$/.test(v.campus.maskedAccountNumber))) &&
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

const H5_COOKIE_OPTIONS = {
  withCredentials: true,
  header: { "X-Refresh-CSRF": "1" },
} as const;

export interface CreateAuthApiOptions {
  h5?: boolean;
}

export { isCampusPolicy };
export type { CampusPolicy };

/** bare 客户端发匿名登录、H5 Cookie 刷新与登出；authed 发带 Bearer 的会话请求。 */
export function createAuthApi(
  bare: HttpClient,
  authed: HttpClient,
  options: CreateAuthApiOptions = {},
) {
  const h5 = options.h5 === true;
  const schoolPath = (id: string) =>
    `/auth/school/challenges/${encodeURIComponent(id)}`;
  return {
    schoolPolicy() {
      return bare.get("/campus-verification/policy", isCampusPolicy);
    },
    schoolCreateChallenge() {
      return bare.post("/auth/school/challenges", {}, isSchoolLoginChallenge);
    },
    schoolRefreshChallenge(id: string, holderToken: string) {
      return bare.post(
        `${schoolPath(id)}/captcha`,
        { holderToken },
        isSchoolLoginChallenge,
      );
    },
    schoolSubmitH5(id: string, body: SchoolLoginSubmit) {
      return bare.post(
        `${schoolPath(id)}/submit/h5`,
        { ...body },
        isSchoolLoginH5Credential,
        H5_COOKIE_OPTIONS,
      );
    },
    schoolQueryStatus(id: string, holderToken: string) {
      return bare.post(
        `${schoolPath(id)}/status`,
        { holderToken },
        isSchoolLoginTransaction,
      );
    },
    schoolCancel(id: string, holderToken: string) {
      return bare.post(
        `${schoolPath(id)}/cancel`,
        { holderToken },
        isSchoolLoginTransaction,
      );
    },
    wechatLogin(code: string, consentVersion: number) {
      return bare.post(
        "/auth/wechat/login",
        { code, consentVersion },
        isCredentialResponse,
      );
    },
    refresh(refreshToken?: string) {
      if (h5) {
        return bare.post(
          "/auth/refresh",
          {},
          isH5CredentialResponse,
          H5_COOKIE_OPTIONS,
        );
      }
      return bare.post("/auth/refresh", { refreshToken }, isCredentialResponse);
    },
    logout() {
      if (h5) {
        return bare.post(
          "/auth/logout",
          {},
          acceptsNoContent,
          H5_COOKIE_OPTIONS,
        );
      }
      return authed.post("/auth/logout", undefined, acceptsNoContent);
    },
    profile() {
      return authed.get("/auth/me", isProfileResponse);
    },
    updateNickname(nickname: string) {
      if (h5) {
        return authed.patch("/auth/me", { nickname }, isProfileResponse);
      }
      // wx.request 不支持 PATCH；POST /auth/me 是后端为微信小程序提供的别名。
      return authed.post("/auth/me", { nickname }, isProfileResponse);
    },
  };
}
