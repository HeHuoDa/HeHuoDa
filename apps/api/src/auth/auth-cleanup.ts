import type { Pool } from "pg";

// 凭据摘要与消费记录在失效后再保留 30 天供排查，随后清理；
// 审计默认按配置天数（默认 180 天）到期清理。
const ARTIFACT_GRACE_DAYS = 30;
const RATE_WINDOW_GRACE_MS = 60 * 60 * 1000;

export interface AuthCleanupResult {
  auditLogs: number;
  tokens: number;
  sessions: number;
  rateWindows: number;
}

export async function cleanupAuthArtifacts(
  pool: Pool,
  auditRetentionDays: number,
  now = new Date(),
): Promise<AuthCleanupResult> {
  if (!Number.isInteger(auditRetentionDays) || auditRetentionDays < 1)
    throw new Error("审计保留天数须为正整数");
  const auditCutoff = new Date(
    now.getTime() - auditRetentionDays * 24 * 60 * 60 * 1000,
  );
  const artifactCutoff = new Date(
    now.getTime() - ARTIFACT_GRACE_DAYS * 24 * 60 * 60 * 1000,
  );
  const auditLogs = await pool.query(
    "DELETE FROM auth_audit_logs WHERE created_at < $1",
    [auditCutoff],
  );
  const tokens = await pool.query(
    "DELETE FROM auth_tokens WHERE (consumed_at IS NOT NULL AND consumed_at < $1) OR refresh_expires_at < $1",
    [artifactCutoff],
  );
  const sessions = await pool.query(
    "DELETE FROM auth_sessions WHERE absolute_expires_at < $1",
    [artifactCutoff],
  );
  const rateWindows = await pool.query(
    "DELETE FROM auth_rate_limits WHERE window_started_at < $1",
    [new Date(now.getTime() - RATE_WINDOW_GRACE_MS)],
  );
  return {
    auditLogs: auditLogs.rowCount ?? 0,
    tokens: tokens.rowCount ?? 0,
    sessions: sessions.rowCount ?? 0,
    rateWindows: rateWindows.rowCount ?? 0,
  };
}
