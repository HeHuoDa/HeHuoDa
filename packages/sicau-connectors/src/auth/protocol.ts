import { createDecipheriv, createHash } from "node:crypto";
import {
  SchoolAuthError,
  type AuthHttpResponse,
  type AuthIdentity,
} from "./types.js";

export const origin = "https://auth.sicau.edu.cn";
export const appid = "sicau-cas";
export const captchaPath = "/api/v1/captcha?appid=sicau-cas";
export const loginPath = "/api/v1/cas/login";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SchoolAuthError("unknown_response");
  return value as Record<string, unknown>;
}

export function decode(response: AuthHttpResponse): Record<string, unknown> {
  if (response.status >= 500 || response.status === 429)
    throw new SchoolAuthError("upstream_unavailable");
  // 已验证流程无须跳转；拒绝所有 3xx，尤其不能重放带密码的 POST。
  if (
    response.status !== 200 ||
    !String(response.headers["content-type"]).startsWith("application/json")
  )
    throw new SchoolAuthError("unknown_response");
  try {
    const envelope = object(
      JSON.parse(Buffer.from(response.body).toString("utf8")),
    );
    if (typeof envelope.data === "string" && envelope.data.length) {
      if (
        typeof envelope.requestId !== "string" ||
        !envelope.requestId.length ||
        envelope.requestId.length > 256
      )
        throw new SchoolAuthError("unknown_response");
      const encoded = envelope.data;
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
        throw new SchoolAuthError("unknown_response");
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.length < 32 || bytes.length % 16 !== 0)
        throw new SchoolAuthError("unknown_response");
      const key = createHash("md5")
        .update(envelope.requestId + ":" + appid)
        .digest();
      const decipher = createDecipheriv(
        "aes-128-cbc",
        key,
        bytes.subarray(0, 16),
      );
      const plaintext = Buffer.concat([
        decipher.update(bytes.subarray(16)),
        decipher.final(),
      ]);
      try {
        envelope.data = JSON.parse(plaintext.toString("utf8"));
      } finally {
        plaintext.fill(0);
        key.fill(0);
      }
    }
    return envelope;
  } catch {
    // 不保留 JSON / OpenSSL 错误、cause 或上游报文，避免泄露敏感片段。
    throw new SchoolAuthError("unknown_response");
  }
}

export function parseChallenge(envelope: Record<string, unknown>): {
  uuid: string;
  imageDataUrl: string;
} {
  const uuid = envelope.id,
    imageDataUrl = envelope.data;
  if (
    envelope.code !== 200 ||
    typeof uuid !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(uuid) ||
    typeof imageDataUrl !== "string" ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(imageDataUrl)
  )
    throw new SchoolAuthError("unknown_response");
  const image = Buffer.from(
    imageDataUrl.slice("data:image/png;base64,".length),
    "base64",
  );
  if (
    image.length < 24 ||
    image.length > 128 * 1024 ||
    image.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
  )
    throw new SchoolAuthError("unknown_response");
  return { uuid, imageDataUrl };
}

function identityText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 128 &&
    value.trim().length > 0 &&
    !/\p{Cc}/u.test(value)
  );
}

export function parseIdentity(envelope: Record<string, unknown>): AuthIdentity {
  if (envelope.code !== 200 || envelope.msg !== "登录成功") {
    if (envelope.msg === "验证码错误")
      throw new SchoolAuthError("captcha_failed");
    if (envelope.msg === "用户不存在或未激活")
      throw new SchoolAuthError("credentials_failed");
    // 其余失败尚未逐项验证，不能猜测密码错误或二次认证的学校字段。
    throw new SchoolAuthError("unknown_response");
  }
  const data = object(envelope.data);
  if (
    typeof data.st !== "string" ||
    !data.st ||
    typeof data.tgt !== "string" ||
    !data.tgt
  )
    throw new SchoolAuthError("unknown_response");
  // 多身份分支没有可靠实测契约；不能把 users[0] 当作本次核验身份。
  if (!Array.isArray(data.users) || data.users.length !== 0)
    throw new SchoolAuthError("unsupported_verification");
  const user = object(data.user);
  // 学校会返回数字 ID；仅接受正安全整数，避免精度丢失造成主体绑定碰撞。
  const subject =
    typeof user.id === "number" && Number.isSafeInteger(user.id) && user.id > 0
      ? String(user.id)
      : user.id;
  if (typeof subject !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(subject))
    throw new SchoolAuthError("unknown_response");
  const accountNumber = user.number,
    name = user.name;
  if (!identityText(accountNumber) || !identityText(name))
    throw new SchoolAuthError("unknown_response");
  return { source: "sicau-eauth", subject, accountNumber, name };
}
