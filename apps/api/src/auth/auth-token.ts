import { createHash, randomBytes, randomUUID } from "node:crypto";

// 平台 ID 用随机 UUID；凭据用 32 字节高熵随机值，数据库只保存 SHA-256 摘要。
export function newId(): string {
  return randomUUID();
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export function generateTokenPair(): TokenPair {
  return { accessToken: generateToken(), refreshToken: generateToken() };
}
