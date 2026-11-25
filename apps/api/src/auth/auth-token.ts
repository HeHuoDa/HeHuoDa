import { createHash, randomBytes, randomUUID } from "node:crypto";

const NATIVE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const H5_REFRESH_PREFIX = "h5_";
const H5_REFRESH_PATTERN = /^h5_[A-Za-z0-9_-]{43}$/;

// 平台 ID 用随机 UUID；凭据用 32 字节高熵随机值，数据库只保存 SHA-256 摘要。
export function newId(): string {
  return randomUUID();
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function generateH5RefreshToken(): string {
  return H5_REFRESH_PREFIX + generateToken();
}

export function isNativeRefreshToken(token: string): boolean {
  return NATIVE_TOKEN_PATTERN.test(token);
}

export function isH5RefreshToken(token: string): boolean {
  return H5_REFRESH_PATTERN.test(token);
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

export function generateH5TokenPair(): TokenPair {
  return {
    accessToken: generateToken(),
    refreshToken: generateH5RefreshToken(),
  };
}
