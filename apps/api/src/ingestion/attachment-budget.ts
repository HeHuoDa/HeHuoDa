import type { Pool } from "pg";
import { BudgetExhaustedError } from "@hehuoda/sicau-connectors/notices";

/** Every network attempt, including robots/redirect/retry, shares the current 09/18 window. */
export async function reserveAttachmentNetworkRequest(
  pool: Pool,
  now = new Date(),
) {
  const day =
    Math.floor((now.getTime() + 8 * 3600000) / 86400000) * 86400000 -
    8 * 3600000;
  const due =
    now.getTime() >= day + 18 * 3600000
      ? day + 18 * 3600000
      : now.getTime() >= day + 9 * 3600000
        ? day + 9 * 3600000
        : day - 6 * 3600000;
  const result = await pool.query(
    "INSERT INTO ingestion_network_windows(due_at,requests) VALUES($1,1) ON CONFLICT(due_at) DO UPDATE SET requests=ingestion_network_windows.requests+1 WHERE ingestion_network_windows.requests<200 RETURNING requests",
    [new Date(due)],
  );
  if (!result.rowCount)
    throw new BudgetExhaustedError("本调度时段共享请求预算耗尽");
  await pool.query(
    "UPDATE ingestion_rounds SET budget_usage=jsonb_set(budget_usage,'{globalRequests}',to_jsonb($2::int)) WHERE due_at=$1",
    [new Date(due), result.rows[0].requests],
  );
}
