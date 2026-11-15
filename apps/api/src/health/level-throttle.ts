/**
 * 告警节流：同一等级每 `windowMs` 只放行一次。
 *
 * 单独成模块而不是留在 `HealthService` 的私有方法里，是因为它是纯逻辑
 * （只依赖当前时间与上次放行时间），却承担了「等级升级不能被吞掉」这条
 * 关键行为。健康检查每 10 秒调用一次，这条规则错了会静默——要么刷爆日志，
 * 要么在最需要告警时沉默。
 */
export class LevelThrottle {
  private readonly lastAt = new Map<string, number>();

  constructor(private readonly windowMs: number) {}

  /** 是否放行本次告警；放行会记录当前时间。 */
  allow(level: string, now: number): boolean {
    const last = this.lastAt.get(level);
    if (last !== undefined && now - last < this.windowMs) return false;
    this.lastAt.set(level, now);
    return true;
  }
}
