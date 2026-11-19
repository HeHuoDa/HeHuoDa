import { createApiError } from "../common/api-error.js";
import type { AccessTransaction } from "../database/access-transaction.js";
import { sql } from "drizzle-orm";

/**
 * 学校校方操作的进程级共享准入。
 *
 * 单实例部署下，匿名登录与已登录核验共用同一份在途预算与活动事务上限
 * （见 docs/campus-verification.md：五个学校操作共享在途准入，最多 128 个活动事务）。
 * 因此刻意做成模块级单例而不是每服务一份，避免两套服务叠加放大到 10 / 256。
 */
export class SchoolCapacity {
  private inFlight = 0;

  get current(): number {
    return this.inFlight;
  }

  async run<T>(limit: number, operation: () => Promise<T>): Promise<T> {
    if (this.inFlight >= limit)
      throw createApiError(
        503,
        "CAMPUS_UPSTREAM_CAPACITY",
        "统一身份认证服务繁忙",
      );
    this.inFlight++;
    try {
      return await operation();
    } finally {
      this.inFlight--;
    }
  }
}

export const schoolCapacity = new SchoolCapacity();
export const MAX_SCHOOL_UPSTREAM_IN_FLIGHT = 5;
export const MAX_ACTIVE_SCHOOL_TRANSACTIONS = 128;

// 两张事务表共用同一上限：匿名登录与已登录核验合计不超过 128 个活动事务。
export async function countActiveSchoolTransactions(
  tx: AccessTransaction,
): Promise<number> {
  const result = await tx.execute(
    sql`select (
      (select count(*) from campus_transactions where status in ('waiting','processing'))
      + (select count(*) from school_login_transactions where status in ('waiting','processing'))
    ) as count`,
  );
  return Number((result.rows[0] as { count: unknown }).count);
}
