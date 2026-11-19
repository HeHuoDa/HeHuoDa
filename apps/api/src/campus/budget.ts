import { eq } from "drizzle-orm";
import type { AccessTransaction } from "../database/access-transaction.js";
import { campusRateBudgets } from "../database/schema.js";

// 严格滑动窗口，持久且有界：被拒绝的请求同样计入，饱和后不再追加，
// 避免遭滥用时无界增长。调用方负责在同一个短事务内完成全部档位。
export async function consumeBudget(
  tx: AccessTransaction,
  budget: {
    kind: string;
    scope: string;
    subject: string;
    limit: number;
    windowMs: number;
    now: Date;
  },
): Promise<boolean> {
  const id = JSON.stringify([budget.kind, budget.scope, budget.subject]);
  const ms = budget.now.getTime();
  const [row] = await tx
    .select()
    .from(campusRateBudgets)
    .where(eq(campusRateBudgets.id, id));
  const events = (row?.events ?? []).filter(
    (time) => time > ms - budget.windowMs,
  );
  const allowed = events.length < budget.limit;
  if (allowed) events.push(ms);
  await tx
    .insert(campusRateBudgets)
    .values({ id, events, updatedAt: budget.now })
    .onConflictDoUpdate({
      target: campusRateBudgets.id,
      set: { events, updatedAt: budget.now },
    });
  return allowed;
}
