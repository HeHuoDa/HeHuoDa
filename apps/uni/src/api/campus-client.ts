import type {
  CampusPolicy,
  CampusQualification,
  CampusProfile,
  CampusTransaction,
  CampusSubmit,
} from "@hehuoda/api-types";
import type { createHttpClient } from "./http.ts";

const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const date = (v: unknown): v is string =>
  text(v) && Number.isFinite(Date.parse(v));
const nullableText = (v: unknown) => v === null || text(v);
const nullableDate = (v: unknown) => v === null || date(v);
function summary(v: unknown): boolean {
  return (
    object(v) &&
    ["unverified", "valid", "expired", "revoked"].includes(String(v.status)) &&
    nullableText(v.termId) &&
    nullableDate(v.verifiedAt) &&
    nullableDate(v.validUntil) &&
    nullableText(v.source)
  );
}
export function isCampusPolicy(v: unknown): v is CampusPolicy {
  return (
    object(v) &&
    Number.isInteger(v.version) &&
    Number(v.version) > 0 &&
    text(v.content)
  );
}
export function isCampusQualification(v: unknown): v is CampusQualification {
  return (
    object(v) &&
    summary(v) &&
    typeof v.available === "boolean" &&
    Number.isInteger(v.policyVersion) &&
    Number(v.policyVersion) > 0 &&
    (v.currentTerm === null ||
      (object(v.currentTerm) &&
        text(v.currentTerm.id) &&
        date(v.currentTerm.startAt) &&
        date(v.currentTerm.endAt)))
  );
}
export function isCampusProfile(v: unknown): v is CampusProfile {
  return (
    object(v) &&
    (v.profile === null ||
      (object(v.profile) &&
        text(v.profile.accountNumber) &&
        text(v.profile.name) &&
        text(v.profile.source) &&
        date(v.profile.updatedAt)))
  );
}
export function isCampusTransaction(v: unknown): v is CampusTransaction {
  if (
    !object(v) ||
    !text(v.id) ||
    ![
      "waiting",
      "processing",
      "succeeded",
      "failed",
      "cancelled",
      "expired",
    ].includes(String(v.status)) ||
    !date(v.expiresAt) ||
    !nullableText(v.reason)
  )
    return false;
  if (v.qualification !== undefined && !summary(v.qualification)) return false;
  if (v.challenge !== undefined) {
    const c = v.challenge;
    if (
      !object(c) ||
      !text(c.version) ||
      !date(c.expiresAt) ||
      !text(c.imageDataUrl) ||
      !/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(
        c.imageDataUrl,
      ) ||
      c.imageDataUrl.length > 1_500_000
    )
      return false;
  }
  return true;
}

/** 只请求平台 API；不接收学校 URL、Cookie 或稳定主体。 */
export function createCampusApi(http: ReturnType<typeof createHttpClient>) {
  const base = "/campus-verification";
  const path = (id: string) => `${base}/transactions/${encodeURIComponent(id)}`;
  return {
    policy: () => http.get(`${base}/policy`, isCampusPolicy),
    status: () => http.get(base, isCampusQualification),
    profile: () => http.get(`${base}/profile`, isCampusProfile),
    /** 创建事务不再要求告知版本：未勾选同意也可先取验证码。 */
    create: () =>
      http.post(`${base}/transactions`, undefined, isCampusTransaction),
    refresh: (id: string) =>
      http.post(`${path(id)}/captcha`, undefined, isCampusTransaction),
    submit: (id: string, body: CampusSubmit) =>
      http.post(`${path(id)}/submit`, { ...body }, isCampusTransaction),
    query: (id: string) => http.get(path(id), isCampusTransaction),
    cancel: (id: string) => http.delete(path(id), isCampusTransaction),
  };
}
