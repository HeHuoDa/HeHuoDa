import { statfsSync } from "node:fs";

export interface DiskSpace {
  /** 文件系统块大小（字节） */
  blockSize: number;
  /** 非特权进程可用块数 */
  availableBlocks: number;
  /** 可用字节数 */
  availableBytes: number;
  /** 总字节数 */
  totalBytes: number;
}

export type DiskLevel = "ok" | "warning" | "critical";

export interface DiskAssessment {
  level: DiskLevel;
  availableBytes: number;
  totalBytes: number;
  /** 剩余可用占比，0–1；总量为 0 时为 0 */
  availableRatio: number;
  /** 触发该等级的门槛（字节）；ok 时为 undefined */
  thresholdBytes?: number;
}

/** 默认门槛：低于 1 GiB 视为严重，低于 5 GiB 视为告警。 */
export const DISK_CRITICAL_BYTES_DEFAULT = 1024 ** 3;
export const DISK_WARNING_BYTES_DEFAULT = 5 * 1024 ** 3;

/**
 * 从环境变量读门槛（MiB），非法或缺省时回退到默认值。
 *
 * 两处调用点（健康检查与采集调度器）共用同一实现，避免默认值散在
 * 多个文件里、改一次要同时改三处。
 */
export function diskThresholdsFromEnv(env: NodeJS.ProcessEnv = process.env): {
  criticalBytes: number;
  warningBytes: number;
} {
  const mib = (raw: string | undefined, fallback: number): number => {
    const value = Number(raw);
    // 负数、0、NaN、非整数一律回退：`-5 * 1024**2` 是真值，
    // 只靠 `||` 回退会把负数当成有效门槛传下去。
    if (!Number.isFinite(value) || value <= 0) return fallback;
    const bytes = Math.round(value) * 1024 ** 2;
    // `0.4` 这类极小值取整后为 0，会让门槛永远不被触发；回退到默认。
    return bytes > 0 ? bytes : fallback;
  };
  return {
    criticalBytes: mib(env.DISK_CRITICAL_MIB, DISK_CRITICAL_BYTES_DEFAULT),
    warningBytes: mib(env.DISK_WARNING_MIB, DISK_WARNING_BYTES_DEFAULT),
  };
}

/**
 * 评估目录所在文件系统，供日志告警使用。
 *
 * 读不到空间信息时返回 undefined 而不是抛错：容器内若挂载异常，
 * 已有其他检查会先暴露问题，不应把「测不出磁盘」当成磁盘耗尽，
 * 更不应让它阻断清理本身（清理就是为了腾空间）。
 */
export function assessDirectoryDisk(
  directory: string,
  env: NodeJS.ProcessEnv = process.env,
): DiskAssessment | undefined {
  try {
    return assessDiskSpace(
      readDiskSpace(directory),
      diskThresholdsFromEnv(env),
    );
  } catch {
    return undefined;
  }
}

/**
 * 读取目录所在文件系统的可用空间。
 *
 * 用 `statfs` 而不是解析 `df`：不依赖外部命令、不依赖 locale，
 * 且在 Linux 与 Windows 上行为一致。目录不存在时抛错，由调用方决定如何降级。
 */
export function readDiskSpace(directory: string): DiskSpace {
  const stats = statfsSync(directory);
  const blockSize = Number(stats.bsize);
  const availableBlocks = Number(stats.bavail);
  const totalBlocks = Number(stats.blocks);
  return {
    blockSize,
    availableBlocks,
    availableBytes: blockSize * availableBlocks,
    totalBytes: blockSize * totalBlocks,
  };
}

/**
 * 按可用字节数判定等级。
 *
 * 用绝对可用量而不是百分比：40G 的盘剩 10% 是 4G，还够用；
 * 而 500G 的盘剩 10% 是 50G，更不该报警。百分比阈值在这两种规模下不安全。
 */
export function assessDiskSpace(
  space: Pick<DiskSpace, "availableBytes" | "totalBytes">,
  thresholds: {
    criticalBytes?: number;
    warningBytes?: number;
  } = {},
): DiskAssessment {
  const critical = thresholds.criticalBytes ?? DISK_CRITICAL_BYTES_DEFAULT;
  const warning = thresholds.warningBytes ?? DISK_WARNING_BYTES_DEFAULT;
  if (critical < 0 || warning < 0) throw new Error("磁盘余量门槛不得为负数");
  if (warning < critical) throw new Error("磁盘余量告警门槛不得低于严重门槛");

  const { availableBytes, totalBytes } = space;
  const availableRatio =
    totalBytes > 0 ? Math.min(1, Math.max(0, availableBytes / totalBytes)) : 0;

  if (availableBytes < critical)
    return {
      level: "critical",
      availableBytes,
      totalBytes,
      availableRatio,
      thresholdBytes: critical,
    };
  if (availableBytes < warning)
    return {
      level: "warning",
      availableBytes,
      totalBytes,
      availableRatio,
      thresholdBytes: warning,
    };
  return { level: "ok", availableBytes, totalBytes, availableRatio };
}

/**
 * 把评估结果转成一行可读告警文案；ok 时返回 undefined，
 * 让调用方在正常路径上不产生任何日志噪音。
 */
export function describeDiskAssessment(
  assessment: DiskAssessment,
  subject: string,
): string | undefined {
  if (assessment.level === "ok") return undefined;
  const availableMiB = Math.floor(assessment.availableBytes / 1024 ** 2);
  const thresholdMiB = Math.floor((assessment.thresholdBytes ?? 0) / 1024 ** 2);
  const percent = (assessment.availableRatio * 100).toFixed(1);
  return (
    `磁盘余量${assessment.level === "critical" ? "严重不足" : "偏低"}：` +
    `${subject} 可用 ${availableMiB} MiB（${percent}%），` +
    `低于 ${
      assessment.level === "critical" ? "严重" : "告警"
    }门槛 ${thresholdMiB} MiB`
  );
}
