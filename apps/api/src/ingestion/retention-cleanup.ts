import { Logger } from "@nestjs/common";
import type { Pool } from "pg";
import { cleanupResponses } from "./store.js";
import { cleanupAttachmentBodies } from "./attachment-store.js";

export interface CleanupOutcome {
  /** 每个清理阶段的独立结果；失败也会记录，而不是整体失败。 */
  stages: {
    label: string;
    removed?: number;
    error?: string;
  }[];
}

/**
 * 依次执行两个保留期清理，并各自独立记录结果。
 *
 * 两个清理必须分开捕获：之前包在同一个 try 里，附件清理抛错会让
 * 原始响应清理的结果被当成整体失败；反过来也一样。更糟的是调用方
 * 无法区分「没有过期数据」与「清理执行失败」。
 *
 * 清理失败不阻断另一个清理，也不在这里抛错——调用方看到的是每个阶段
 * 各自的结果，可自行决定是否告警或中止。
 */
export async function runRetentionCleanup(
  pool: Pool,
  days: number,
  operations: {
    logger?: Pick<Logger, "log" | "error">;
    cleanupResponses?: typeof cleanupResponses;
    cleanupAttachmentBodies?: typeof cleanupAttachmentBodies;
  } = {},
): Promise<CleanupOutcome> {
  const logger = operations.logger;
  const stages: CleanupOutcome["stages"] = [];
  const jobs = [
    {
      label: "原始响应",
      run: operations.cleanupResponses ?? cleanupResponses,
    },
    {
      label: "附件字节",
      run: operations.cleanupAttachmentBodies ?? cleanupAttachmentBodies,
    },
  ] as const;

  for (const job of jobs) {
    try {
      const { removed } = await job.run(pool, days);
      stages.push({ label: job.label, removed: removed ?? 0 });
      logger?.log(`清理${job.label}：removed=${removed}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stages.push({ label: job.label, error: message });
      logger?.error(`清理${job.label}失败：${message}`);
    }
  }

  return { stages };
}
