import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

export interface CampusTerm {
  id: string;
  startAt: string;
  endAt: string;
}
export interface CampusSettings {
  enabled: boolean;
  terms: CampusTerm[];
  policyVersion: number;
  hmacKey: Buffer | null;
  keys: Map<string, Buffer>;
  keyId: string;
}
// 校验错误不得携带配置原值，尤其不能让 Joi 将密钥包含在错误消息里。
export function campusSettings(
  config: Record<string, unknown>,
): CampusSettings {
  try {
    const enabled = config.CAMPUS_VERIFICATION_ENABLED === true;
    const raw: unknown = JSON.parse(String(config.CAMPUS_TERMS ?? "[]"));
    if (!Array.isArray(raw)) throw new Error();
    const ids = new Set<string>();
    const instant = (value: unknown): string => {
      if (
        typeof value !== "string" ||
        !/(Z|[+-]\d{2}:\d{2})$/.test(value) ||
        !Number.isFinite(Date.parse(value))
      )
        throw new Error();
      return new Date(value).toISOString();
    };
    const terms: CampusTerm[] = raw
      .map((term: unknown) => {
        if (!term || typeof term !== "object") throw new Error();
        const t = term as Record<string, unknown>;
        if (
          typeof t.id !== "string" ||
          !/^[a-zA-Z0-9_-]{1,64}$/.test(t.id) ||
          ids.has(t.id)
        )
          throw new Error();
        ids.add(t.id);
        const startAt = instant(t.startAt),
          endAt = instant(t.endAt);
        if (startAt >= endAt) throw new Error();
        return { id: t.id, startAt, endAt };
      })
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
    if (terms.some((t, i) => i > 0 && t.startAt < terms[i - 1]!.endAt))
      throw new Error();
    const decode = (value: unknown) => {
      if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value))
        throw new Error();
      const key = Buffer.from(value, "base64");
      if (key.length !== 32 || key.toString("base64") !== value)
        throw new Error();
      return key;
    };
    const hmacKey = config.CAMPUS_SUBJECT_HMAC_KEY
      ? decode(config.CAMPUS_SUBJECT_HMAC_KEY)
      : null;
    const keyValues: unknown = JSON.parse(
      String(config.CAMPUS_PROFILE_KEYS ?? "{}"),
    );
    if (!keyValues || typeof keyValues !== "object" || Array.isArray(keyValues))
      throw new Error();
    const keys = new Map<string, Buffer>();
    for (const [id, value] of Object.entries(keyValues)) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error();
      const key = decode(value);
      if (hmacKey?.equals(key)) throw new Error();
      keys.set(id, key);
    }
    const keyId = String(config.CAMPUS_PROFILE_KEY_ID ?? "");
    if (enabled && (!hmacKey || !keys.has(keyId) || !terms.length))
      throw new Error();
    return {
      enabled,
      terms,
      hmacKey,
      keys,
      keyId,
      policyVersion: Number(config.CAMPUS_POLICY_VERSION ?? 1),
    };
  } catch {
    throw new Error("校园核验配置无效；检查学期区间和独立密钥配置");
  }
}
export function currentTerm(
  settings: CampusSettings,
  now: Date,
): CampusTerm | null {
  const time = now.toISOString();
  return (
    settings.terms.find((t) => t.startAt <= time && time < t.endAt) ?? null
  );
}
export interface SealedProfile {
  ciphertext: string;
  nonce: string;
  tag: string;
  keyId: string;
  version: number;
}
const aad = (userId: string, source: string, version: number) =>
  Buffer.from(JSON.stringify([userId, source, version]));
export function subjectIndex(
  settings: CampusSettings,
  source: string,
  subject: string,
): string {
  if (!settings.hmacKey) throw new Error("校园索引密钥不可用");
  return createHmac("sha256", settings.hmacKey)
    .update(JSON.stringify([source, subject]))
    .digest("hex");
}
export function sealProfile(
  settings: CampusSettings,
  userId: string,
  source: string,
  profile: { accountNumber: string; name: string },
): SealedProfile {
  const key = settings.keys.get(settings.keyId);
  if (!key) throw new Error("校园资料密钥不可用");
  const nonce = randomBytes(12),
    version = 1;
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad(userId, source, version));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(profile), "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyId: settings.keyId,
    version,
  };
}
export function openProfile(
  settings: CampusSettings,
  userId: string,
  source: string,
  sealed: SealedProfile,
): { accountNumber: string; name: string } {
  try {
    const key = settings.keys.get(sealed.keyId);
    if (!key || sealed.version !== 1) throw new Error();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(sealed.nonce, "base64"),
    );
    decipher.setAAD(aad(userId, source, sealed.version));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    const value = JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(sealed.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8"),
    ) as Record<string, unknown>;
    if (
      typeof value.accountNumber !== "string" ||
      typeof value.name !== "string"
    )
      throw new Error();
    return { accountNumber: value.accountNumber, name: value.name };
  } catch {
    throw new Error("校园资料无法安全解密");
  }
}
