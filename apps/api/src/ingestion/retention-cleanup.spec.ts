import { runRetentionCleanup } from "./retention-cleanup.js";

const pool = {} as never;

function recorder() {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    logger: {
      log: (message: string) => logs.push(message),
      error: (message: string) => errors.push(message),
    },
  };
}

describe("保留期清理编排", () => {
  it("一个清理失败不影响另一个，且两者结果分别记录", async () => {
    // 回归：两个清理曾经共用同一个 try，附件清理抛错会让原始响应的
    // 结果被当成整体失败，反之亦然。
    const { logs, errors, logger } = recorder();
    const outcome = await runRetentionCleanup(pool, 30, {
      logger,
      cleanupResponses: async () => ({ removed: 3 }),
      cleanupAttachmentBodies: async () => {
        throw new Error(
          "permission denied for table ingestion_attachment_versions",
        );
      },
    });

    expect(outcome.stages).toEqual([
      { label: "原始响应", removed: 3 },
      {
        label: "附件字节",
        error: "permission denied for table ingestion_attachment_versions",
      },
    ]);
    // 失败的那个不阻断另一个：成功项仍被记录。
    expect(logs.join("\n")).toContain("原始响应：removed=3");
    expect(errors.join("\n")).toContain("附件字节失败");
  });

  it("两个都失败时都不抛出，两个都记为失败", async () => {
    const { errors, logger } = recorder();
    const outcome = await runRetentionCleanup(pool, 30, {
      logger,
      cleanupResponses: async () => {
        throw new Error("connection terminated");
      },
      cleanupAttachmentBodies: async () => {
        throw new Error("disk full");
      },
    });

    expect(outcome.stages.every((stage) => stage.error)).toBe(true);
    expect(errors).toHaveLength(2);
  });

  it("失败与「没有到期数据」必须可区分", async () => {
    // removed=0 表示真的没有过期数据；失败则必须带 error。
    // 两者若不可区分，运维会把失败读成「一切正常」。
    const { logger } = recorder();
    const outcome = await runRetentionCleanup(pool, 30, {
      logger,
      cleanupResponses: async () => ({ removed: 0 }),
      cleanupAttachmentBodies: async () => {
        throw new Error("boom");
      },
    });

    const [response, attachment] = outcome.stages;
    expect(response).toEqual({ label: "原始响应", removed: 0 });
    expect(response).not.toHaveProperty("error");
    expect(attachment).toHaveProperty("error");
    expect(attachment).not.toHaveProperty("removed");
  });

  it("没有传 logger 时也能正常返回结果", async () => {
    const outcome = await runRetentionCleanup(pool, 30, {
      cleanupResponses: async () => ({ removed: 1 }),
      cleanupAttachmentBodies: async () => ({ removed: 2 }),
    });
    expect(outcome.stages).toEqual([
      { label: "原始响应", removed: 1 },
      { label: "附件字节", removed: 2 },
    ]);
  });
});
