import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { initializeSources } from "./store.js";
import { IngestionRunner, type ScanPhase } from "./runner.js";
import { queueDueAttachments } from "./attachment-store.js";

/** 北京时间最近的09/18时隙；nextDueAt是该轮必须完成的下个触发点。 */
export function scheduledWindow(now: Date) {
  const day =
    Math.floor((now.getTime() + 8 * 3600000) / 86400000) * 86400000 -
    8 * 3600000;
  const hour9 = day + 9 * 3600000,
    hour18 = day + 18 * 3600000;
  const dueAt =
    now.getTime() >= hour18
      ? hour18
      : now.getTime() >= hour9
        ? hour9
        : day - 6 * 3600000;
  const nextDueAt =
    dueAt === hour18 ? day + 33 * 3600000 : dueAt === hour9 ? hour18 : hour9;
  return { dueAt: new Date(dueAt), nextDueAt: new Date(nextDueAt) };
}
interface FreshCheck {
  status: string;
  taskId?: string;
  runId?: string;
}
interface RoundRow {
  id: string;
  fresh_check_status: Record<string, FreshCheck>;
  budget_usage: {
    requests?: number;
    downloadedBytes?: number;
    elapsedMs?: number;
    taskIds?: string[];
  };
  finished_at: Date | null;
}
export class ChannelRoundRunner {
  constructor(
    private readonly pool: Pool,
    private readonly runner = new IngestionRunner(pool),
    private readonly now = () => new Date(),
  ) {}
  async run(
    limits: {
      requests?: number;
      durationMs?: number;
      sliceRequests?: number;
    } = {},
    signal?: AbortSignal,
  ) {
    const requestLimit = limits.requests ?? 200,
      duration = limits.durationMs ?? 900000,
      slice = limits.sliceRequests ?? 10;
    if (
      ![requestLimit, duration, slice].every(Number.isInteger) ||
      requestLimit < 1 ||
      requestLimit > 200 ||
      duration < 1000 ||
      duration > 900000 ||
      slice < 1 ||
      slice > 200
    )
      throw new Error("调度轮预算超出边界");
    await initializeSources(this.pool);
    const lock = await this.pool.connect();
    const started = this.now().getTime();
    let round: RoundRow | undefined;
    const window = scheduledWindow(this.now());
    // 协调锁不代替23000网络锁；每个工作片仍通过同一个runner取得全局锁。
    try {
      if (
        !(await lock.query("SELECT pg_try_advisory_lock(23006) AS locked"))
          .rows[0].locked
      )
        return { status: "locked" };
      round = (
        await lock.query(
          "SELECT * FROM ingestion_rounds WHERE due_at=$1 ORDER BY started_at LIMIT 1",
          [window.dueAt],
        )
      ).rows[0];
      if (round?.finished_at) return { status: "succeeded", roundId: round.id };
      if (!round)
        round = (
          await lock.query(
            "INSERT INTO ingestion_rounds(id,due_at,next_due_at,status,started_at) VALUES($1,$2,$3,'running',$4) RETURNING *",
            [randomUUID(), window.dueAt, window.nextDueAt, this.now()],
          )
        ).rows[0];
      if (!round) throw new Error("调度轮未创建");
      // Queue before checking the round status: old approvals cannot outlive a due recheck.
      await queueDueAttachments(this.pool, window.dueAt);
      // 工作进程可能在片完成、轮统计落账前退出；以逐请求持久化的run消耗重建预算。
      const consumed = (
        await lock.query(
          "SELECT COALESCE(sum((budget_usage->>'requests')::int),0) AS requests,COALESCE(sum((budget_usage->>'downloadedBytes')::bigint),0) AS bytes,COALESCE(sum((budget_usage->>'elapsedMs')::bigint),0) AS elapsed,COALESCE(array_agg(DISTINCT task_id) FILTER(WHERE task_id IS NOT NULL),'{}'::text[]) AS tasks FROM ingestion_runs WHERE round_id=$1",
          [round.id],
        )
      ).rows[0];
      round.budget_usage = {
        ...round.budget_usage,
        requests: Number(consumed.requests),
        downloadedBytes: Number(consumed.bytes),
        elapsedMs: Math.max(
          round.budget_usage.elapsedMs ?? 0,
          Number(consumed.elapsed),
        ),
        taskIds: [
          ...new Set([
            ...(round.budget_usage.taskIds ?? []),
            ...(consumed.tasks as string[]),
          ]),
        ],
      };
      let used = 0,
        downloaded = 0;
      const required = new Set(round.budget_usage.taskIds ?? []);
      const fresh = round.fresh_check_status;
      const save = async () =>
        lock.query(
          "UPDATE ingestion_rounds SET fresh_check_status=$2,budget_usage=budget_usage || $3::jsonb WHERE id=$1",
          [
            round!.id,
            JSON.stringify(fresh),
            JSON.stringify({
              requests: (round!.budget_usage.requests ?? 0) + used,
              downloadedBytes:
                (round!.budget_usage.downloadedBytes ?? 0) + downloaded,
              elapsedMs:
                (round!.budget_usage.elapsedMs ?? 0) +
                Math.max(0, this.now().getTime() - started),
              taskIds: [...required],
            }),
          ],
        );
      const room = () =>
        !signal?.aborted &&
        used + (round!.budget_usage.requests ?? 0) < requestLimit &&
        this.now().getTime() - started + (round!.budget_usage.elapsedMs ?? 0) <
          duration - 1000;
      const work = async (
        sourceId: string,
        channelId: string,
        phase: ScanPhase,
        taskId?: string,
        attachmentUrl?: string,
      ) => {
        const result = await this.runner.scan(
          {
            sourceId,
            channelId,
            phase: attachmentUrl ? undefined : phase,
            url: attachmentUrl,
            taskId,
            roundId: round!.id,
            trigger: attachmentUrl ? "manual" : "scheduled",
            workSliceRequests: Math.min(
              slice,
              requestLimit - used - (round!.budget_usage.requests ?? 0),
            ),
            workSliceDurationMs: Math.max(
              1000,
              duration -
                (round!.budget_usage.elapsedMs ?? 0) -
                (this.now().getTime() - started),
            ),
          },
          signal,
          { roundId: round!.id },
        );
        const runId = "runId" in result ? result.runId : null;
        const row = runId
          ? (
              await lock.query(
                "SELECT task_id,budget_usage,counts,status FROM ingestion_runs WHERE id=$1",
                [runId],
              )
            ).rows[0]
          : null;
        if (row?.task_id) required.add(row.task_id);
        if (row) {
          used += row.budget_usage.requests ?? 0;
          downloaded += row.budget_usage.downloadedBytes ?? 0;
        }
        // 持久轮转顺序；一个工作片后让出来源，无论成功、积压还是故障。
        await lock.query(
          "UPDATE ingestion_channels SET rotation_seq=(SELECT COALESCE(max(rotation_seq),0)+1 FROM ingestion_channels) WHERE source_id=$1 AND id=$2",
          [sourceId, channelId],
        );
        await lock.query(
          "UPDATE ingestion_rounds SET rotation_cursor=$2 WHERE id=$1",
          [round!.id, `${sourceId}/${channelId}`],
        );
        await save();
        return { result, row, runId };
      };
      const channels = (
        await lock.query(
          "SELECT c.source_id,c.id,c.backoff_until FROM ingestion_channels c JOIN ingestion_sources s ON s.id=c.source_id WHERE c.enabled AND s.enabled ORDER BY c.rotation_seq,c.source_id,c.id",
        )
      ).rows;
      for (const c of channels) {
        const key = `${c.source_id}/${c.id}`;
        fresh[key] ??= { status: "pending" };
      }
      await save();
      for (const c of channels) {
        const key = `${c.source_id}/${c.id}`;
        if (fresh[key]?.status === "checked") continue;
        if (c.backoff_until && new Date(c.backoff_until) > this.now()) {
          fresh[key] = { status: "backoff" };
          await save();
          continue;
        }
        if (!room()) break;
        const previous = (
          await lock.query(
            "SELECT t.id,r.id AS run_id,r.counts,r.budget_usage FROM ingestion_scan_tasks t LEFT JOIN ingestion_runs r ON r.id=t.leaf_run_id WHERE t.round_id=$1 AND t.source_id=$2 AND t.channel_id=$3 AND t.phase='fresh' ORDER BY t.created_at DESC,t.id DESC LIMIT 1",
            [round.id, c.source_id, c.id],
          )
        ).rows[0];
        if (previous?.budget_usage?.pages > 0 && !previous.counts.failed) {
          fresh[key] = {
            status: "checked",
            taskId: previous.id,
            runId: previous.run_id,
          };
          required.add(previous.id);
          await save();
          continue;
        }
        const { row, runId, result } = await work(
          c.source_id,
          c.id,
          "fresh",
          previous?.id,
        );
        fresh[key] = {
          status:
            row?.budget_usage.pages > 0 && !row.counts.failed
              ? "checked"
              : result.status === "locked"
                ? "pending"
                : row?.counts.failed
                  ? "failed"
                  : "pending",
          ...(row?.task_id ? { taskId: row.task_id } : {}),
          ...(runId ? { runId } : {}),
        };
        await save();
      }
      // 附件积压按栏目轮转；不让历史补抓占满预算，也不因 HTML 304 跳过附件。
      if (process.env.INGESTION_ATTACHMENTS_ENABLED === "true") {
        const attemptedAttachments = new Set<string>();
        let progressed = true;
        while (room() && progressed) {
          progressed = false;
          for (const c of channels) {
            if (!room()) break;
            if (c.backoff_until && new Date(c.backoff_until) > this.now())
              continue;
            const next = (
              await lock.query(
                `SELECT DISTINCT n.id,n.url FROM ingestion_attachments a
               JOIN ingestion_notices n ON n.id=a.notice_id
               JOIN ingestion_notice_channels nc ON nc.notice_id=n.id
               WHERE n.source_id=$1 AND nc.channel_id=$2 AND a.state='stale'
                 AND NOT (n.id=ANY($3::text[])) ORDER BY n.id LIMIT 1`,
                [c.source_id, c.id, [...attemptedAttachments]],
              )
            ).rows[0];
            if (!next) continue;
            attemptedAttachments.add(next.id);
            progressed = true;
            const { result } = await work(
              c.source_id,
              c.id,
              "revisit",
              undefined,
              next.url,
            );
            if (result.status === "locked") {
              progressed = false;
              break;
            }
          }
        }
      }
      // 新通知机会全部分配后，再建立/接续各自独立范围的历史、复查和重试任务。
      if (
        channels.every(
          (c) =>
            fresh[`${c.source_id}/${c.id}`]?.status &&
            fresh[`${c.source_id}/${c.id}`].status !== "pending",
        )
      ) {
        const attempted = new Set<string>();
        while (room()) {
          const due = (
            await lock.query(
              `SELECT c.source_id,c.id,c.activated_on::text AS activated_on,c.rotation_seq FROM ingestion_channels c JOIN ingestion_sources s ON s.id=c.source_id WHERE c.enabled AND s.enabled AND (c.backoff_until IS NULL OR c.backoff_until<=$1) ORDER BY c.rotation_seq,c.source_id,c.id`,
              [this.now()],
            )
          ).rows;
          let next:
            | {
                sourceId: string;
                channelId: string;
                phase: ScanPhase;
                taskId?: string;
              }
            | undefined;
          for (const c of due) {
            const tasks = (
              await lock.query(
                "SELECT id,phase,status,to_date::text AS to_date FROM ingestion_scan_tasks WHERE source_id=$1 AND channel_id=$2 ORDER BY CASE WHEN status NOT IN ('succeeded','superseded') THEN 0 ELSE 1 END,updated_at,id",
                [c.source_id, c.id],
              )
            ).rows;
            const pending = tasks.find(
              (t) =>
                !["succeeded", "superseded"].includes(t.status) &&
                !attempted.has(t.id),
            );
            if (pending) {
              next = {
                sourceId: c.source_id,
                channelId: c.id,
                phase: pending.phase,
                taskId: pending.id,
              };
              break;
            }
            for (const phase of ["backfill", "revisit", "retry"] as const) {
              const key = `${c.source_id}/${c.id}/${phase}`;
              if (
                attempted.has(key) ||
                (phase === "backfill" &&
                  tasks.some(
                    (t) =>
                      t.phase === phase &&
                      t.status === "succeeded" &&
                      t.to_date === c.activated_on,
                  ))
              )
                continue;
              attempted.add(key);
              next = { sourceId: c.source_id, channelId: c.id, phase };
              break;
            }
            if (next) break;
          }
          if (!next) break;
          if (next.taskId) attempted.add(next.taskId);
          const { result, row } = await work(
            next.sourceId,
            next.channelId,
            next.phase,
            next.taskId,
          );
          if (row?.task_id) attempted.add(row.task_id);
          if (result.status === "locked") break;
        }
      }
      // 核对明确任务范围；失败/积压保留partial，不用“调度函数结束”冒充本轮完成。
      for (const value of Object.values(fresh)) {
        if (
          value.taskId &&
          !["checked", "backoff"].includes(value.status) &&
          (
            await lock.query(
              "SELECT status FROM ingestion_scan_tasks WHERE id=$1",
              [value.taskId],
            )
          ).rows[0]?.status === "succeeded"
        )
          value.status = "checked";
      }
      const incomplete = required.size
        ? (
            await lock.query(
              "SELECT count(*)::int AS count FROM ingestion_scan_tasks WHERE id=ANY($1::text[]) AND status NOT IN ('succeeded','superseded')",
              [[...required]],
            )
          ).rows[0].count
        : 0;
      const pendingAttachments = (
        await lock.query(
          `SELECT count(*)::int AS count FROM ingestion_attachments a JOIN ingestion_notices n ON n.id=a.notice_id
         WHERE a.state='stale' AND EXISTS(SELECT 1 FROM ingestion_notice_channels nc JOIN ingestion_channels c ON c.source_id=nc.source_id AND c.id=nc.channel_id JOIN ingestion_sources s ON s.id=c.source_id WHERE nc.notice_id=n.id AND c.enabled AND s.enabled)`,
        )
      ).rows[0].count;
      const complete =
        !pendingAttachments &&
        !incomplete &&
        channels.every((c) =>
          ["checked", "backoff"].includes(
            fresh[`${c.source_id}/${c.id}`]?.status,
          ),
        );
      await save();
      await lock.query(
        "UPDATE ingestion_rounds SET status=$2,finished_at=CASE WHEN $3 THEN $4::timestamptz ELSE NULL END WHERE id=$1",
        [round.id, complete ? "succeeded" : "partial", complete, this.now()],
      );
      // 后续轮完成旧任务时补记旧轮真实完成时刻，保留是否逾期的证据。
      if (!pendingAttachments)
        await lock.query(
          `UPDATE ingestion_rounds r SET status='succeeded',finished_at=$1,fresh_check_status=COALESCE((SELECT jsonb_object_agg(f.key,CASE WHEN EXISTS(SELECT 1 FROM ingestion_scan_tasks t WHERE t.id=f.value->>'taskId' AND t.status='succeeded') THEN f.value || '{"status":"checked"}'::jsonb ELSE f.value END) FROM jsonb_each(r.fresh_check_status) f),'{}'::jsonb) WHERE r.id<>$2 AND r.finished_at IS NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(r.budget_usage->'taskIds','[]')) j JOIN ingestion_scan_tasks t ON t.id=j#>>'{}' WHERE t.status NOT IN ('succeeded','superseded')) AND NOT EXISTS(SELECT 1 FROM jsonb_each(r.fresh_check_status) f WHERE f.value->>'status' NOT IN ('checked','backoff') AND NOT EXISTS(SELECT 1 FROM ingestion_scan_tasks t WHERE t.id=f.value->>'taskId' AND t.status='succeeded'))`,
          [this.now(), round.id],
        );
      return {
        status: complete ? "succeeded" : "partial",
        roundId: round.id,
        requests: used,
      };
    } finally {
      await lock
        .query("SELECT pg_advisory_unlock(23006)")
        .catch(() => undefined);
      lock.release(true);
    }
  }
}
