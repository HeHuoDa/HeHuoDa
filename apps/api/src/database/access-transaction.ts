import { sql } from "drizzle-orm";
import type { DatabaseService } from "./database.service.js";
import { createApiError } from "../common/api-error.js";

export type AccessTransaction = Parameters<
  Parameters<DatabaseService["db"]["transaction"]>[0]
>[0];

// 所有权限相关写入先取得此锁，再取得行锁；禁止锁内访问学校网络。
// 首版有意串行化，避免跨用户/跨队伍及注销之间出现不一致锁序。
export async function lockAccessTransaction(
  tx: AccessTransaction,
): Promise<void> {
  const isolation = await tx.execute(
    sql`select current_setting('transaction_isolation') as isolation`,
  );
  if (isolation.rows[0]?.isolation !== "read committed")
    throw createApiError(
      409,
      "ACCESS_TRANSACTION_ISOLATION",
      "权限事务须使用 READ COMMITTED",
    );
  await tx.execute(sql`select pg_advisory_xact_lock(133, 1)`);
}
