import {
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";

// OWASP scrypt profile: N=2^15, r=8, p=3; params are fixed for this credential version.
export const PASSWORD_OPTIONS = {
  N: 32768,
  r: 8,
  p: 3,
  maxmem: 64 * 1024 * 1024,
};
export function passwordHash(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, PASSWORD_OPTIONS, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}
export const digest = (value: string) =>
  createHash("sha256").update(value).digest();
export const newSecret = () => randomBytes(32).toString("base64url");
export const csrfToken = (token: string) =>
  createHmac("sha256", token).update("hh-admin-csrf-v1").digest("base64url");
export function equalHash(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}
export const ADMIN_COOKIE = "hh_admin_session";
export function sessionToken(cookie: string | undefined): string | undefined {
  const matches = (cookie ?? "")
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value.startsWith(ADMIN_COOKIE + "="));
  if (matches.length !== 1) return;
  const value = matches[0]!.slice(ADMIN_COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}

import { parseAllowedOrigins } from "../common/allowed-origins.js";

export function adminOrigins(raw: string, production = false): string[] {
  return parseAllowedOrigins(raw, production, "管理员");
}
