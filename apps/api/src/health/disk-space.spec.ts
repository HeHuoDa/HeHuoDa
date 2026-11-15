import {
  assessDirectoryDisk,
  assessDiskSpace,
  describeDiskAssessment,
  diskThresholdsFromEnv,
  DISK_CRITICAL_BYTES_DEFAULT,
  DISK_WARNING_BYTES_DEFAULT,
  readDiskSpace,
} from "./disk-space.js";

const GiB = 1024 ** 3;

describe("磁盘余量评估", () => {
  it("按绝对可用量分级，而不是按百分比", () => {
    // 40G 盘剩 3%，约 1.2G，仍高于严重门槛但低于告警门槛。
    expect(
      assessDiskSpace({ availableBytes: 1.2 * GiB, totalBytes: 40 * GiB })
        .level,
    ).toBe("warning");
    // 5T 盘剩 0.03%，约 1.5G，仍不该判严重。
    expect(
      assessDiskSpace({ availableBytes: 1.5 * GiB, totalBytes: 5000 * GiB })
        .level,
    ).toBe("warning");
    expect(
      assessDiskSpace({ availableBytes: 50 * GiB, totalBytes: 5000 * GiB })
        .level,
    ).toBe("ok");
  });

  it("门槛边界取闭区间下界：等于门槛不算越界", () => {
    expect(
      assessDiskSpace({
        availableBytes: DISK_CRITICAL_BYTES_DEFAULT,
        totalBytes: 40 * GiB,
      }).level,
    ).toBe("warning");
    expect(
      assessDiskSpace({
        availableBytes: DISK_CRITICAL_BYTES_DEFAULT - 1,
        totalBytes: 40 * GiB,
      }).level,
    ).toBe("critical");
    expect(
      assessDiskSpace({
        availableBytes: DISK_WARNING_BYTES_DEFAULT,
        totalBytes: 40 * GiB,
      }).level,
    ).toBe("ok");
  });

  it("支持自定义门槛，并记录触发门槛以便日志可解释", () => {
    const result = assessDiskSpace(
      { availableBytes: 600 * 1024 ** 2, totalBytes: 40 * GiB },
      { criticalBytes: 512 * 1024 ** 2, warningBytes: 900 * 1024 ** 2 },
    );
    expect(result.level).toBe("warning");
    expect(result.thresholdBytes).toBe(900 * 1024 ** 2);
  });

  it("拒绝不一致或负数的门槛", () => {
    expect(() =>
      assessDiskSpace(
        { availableBytes: 1, totalBytes: 2 },
        { criticalBytes: 100, warningBytes: 50 },
      ),
    ).toThrow("告警门槛不得低于严重门槛");
    expect(() =>
      assessDiskSpace(
        { availableBytes: 1, totalBytes: 2 },
        { criticalBytes: -1 },
      ),
    ).toThrow("不得为负数");
  });

  it("总量为 0 时占比记 0，不产生 NaN", () => {
    const result = assessDiskSpace({ availableBytes: 0, totalBytes: 0 });
    expect(result.level).toBe("critical");
    expect(result.availableRatio).toBe(0);
    expect(Number.isNaN(result.availableRatio)).toBe(false);
  });

  it("ok 时不产出告警文案，避免正常路径写入噪音", () => {
    expect(
      describeDiskAssessment(
        assessDiskSpace({ availableBytes: 50 * GiB, totalBytes: 100 * GiB }),
        "工作目录",
      ),
    ).toBeUndefined();
  });

  it("告警文案包含主体、可用量与门槛", () => {
    const text = describeDiskAssessment(
      assessDiskSpace({
        availableBytes: 2 * GiB,
        totalBytes: 40 * GiB,
      }),
      "/app",
    );
    expect(text).toContain("/app");
    expect(text).toContain("2048 MiB");
    expect(text).toContain("偏低");
    expect(text).toContain("5120 MiB");
  });

  it("严重不足时文案与等级一致，且引用严重门槛", () => {
    const text = describeDiskAssessment(
      assessDiskSpace({
        availableBytes: 800 * 1024 ** 2,
        totalBytes: 40 * GiB,
      }),
      "/app",
    );
    expect(text).toContain("严重不足");
    expect(text).toContain("1024 MiB");
  });

  it("能读取真实文件系统，且可用量不超过总量", () => {
    const space = readDiskSpace(process.cwd());
    expect(space.blockSize).toBeGreaterThan(0);
    expect(space.availableBytes).toBeGreaterThanOrEqual(0);
    expect(space.availableBytes).toBeLessThanOrEqual(space.totalBytes);
  });

  it("目录不存在时抛出，交由调用方决定降级", () => {
    expect(() => readDiskSpace("/nonexistent-path-for-disk-space")).toThrow();
  });

  it("从环境变量读门槛并换算 MiB，非法值回退默认", () => {
    expect(diskThresholdsFromEnv({})).toEqual({
      criticalBytes: DISK_CRITICAL_BYTES_DEFAULT,
      warningBytes: DISK_WARNING_BYTES_DEFAULT,
    });
    expect(
      diskThresholdsFromEnv({
        DISK_CRITICAL_MIB: "256",
        DISK_WARNING_MIB: "2048",
      }),
    ).toEqual({
      criticalBytes: 256 * 1024 ** 2,
      warningBytes: 2048 * 1024 ** 2,
    });
    // 非数字、负数、0 都不能被当成有效门槛。
    expect(
      diskThresholdsFromEnv({
        DISK_CRITICAL_MIB: "abc",
        DISK_WARNING_MIB: "-5",
      }),
    ).toEqual({
      criticalBytes: DISK_CRITICAL_BYTES_DEFAULT,
      warningBytes: DISK_WARNING_BYTES_DEFAULT,
    });
  });

  it("门槛过小取整后为 0 时回退默认，否则永远不触发告警", () => {
    // 0.4 MiB 取整为 0，门槛 0 会让 availableBytes < 0 永不成立。
    for (const raw of ["0.4", "1e-9", "0.0001"]) {
      expect(diskThresholdsFromEnv({ DISK_CRITICAL_MIB: raw })).toEqual({
        criticalBytes: DISK_CRITICAL_BYTES_DEFAULT,
        warningBytes: DISK_WARNING_BYTES_DEFAULT,
      });
    }
  });

  it("Infinity 与极小值都不被当成有效门槛", () => {
    const result = diskThresholdsFromEnv({
      DISK_CRITICAL_MIB: "1e999",
      DISK_WARNING_MIB: "1e999",
    });
    expect(Number.isFinite(result.criticalBytes)).toBe(true);
    expect(Number.isFinite(result.warningBytes)).toBe(true);
    expect(result.criticalBytes).toBe(DISK_CRITICAL_BYTES_DEFAULT);
  });

  it("读取目录时读不到空间就返回 undefined，而不是抛错或误判为耗尽", () => {
    // 容器挂载异常时不应让清理停工，也不应谎称磁盘已满。
    expect(
      assessDirectoryDisk("/nonexistent-path-for-disk-space"),
    ).toBeUndefined();
    // 正常目录必然给出结论。
    const real = assessDirectoryDisk(process.cwd());
    expect(real).toBeDefined();
    expect(["ok", "warning", "critical"]).toContain(real!.level);
  });
});
