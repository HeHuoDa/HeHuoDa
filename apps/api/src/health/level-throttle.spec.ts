import { LevelThrottle } from "./level-throttle.js";

const MINUTE = 60_000;

describe("告警节流", () => {
  it("同一等级在窗口内只放行一次", () => {
    const throttle = new LevelThrottle(10 * MINUTE);
    expect(throttle.allow("warning", 0)).toBe(true);
    expect(throttle.allow("warning", 1 * MINUTE)).toBe(false);
    expect(throttle.allow("warning", 9.9 * MINUTE)).toBe(false);
    // 窗口边界：正好满 10 分钟应放行。
    expect(throttle.allow("warning", 10 * MINUTE)).toBe(true);
  });

  it("等级升级不被低等级刚告警过而吞掉", () => {
    // 回归：曾用单个时间戳，warning 之后立即 critical 会被节流掉，
    // 而那正是最需要看到告警的时刻。
    const throttle = new LevelThrottle(10 * MINUTE);
    expect(throttle.allow("warning", 0)).toBe(true);
    expect(throttle.allow("critical", 1)).toBe(true);
    // 同等级仍然受限。
    expect(throttle.allow("critical", 2)).toBe(false);
    expect(throttle.allow("warning", 3)).toBe(false);
  });

  it("等级降级同样独立计时，不受其他等级影响", () => {
    const throttle = new LevelThrottle(10 * MINUTE);
    expect(throttle.allow("critical", 0)).toBe(true);
    expect(throttle.allow("warning", 0)).toBe(true);
    expect(throttle.allow("ok", 0)).toBe(true);
    expect(throttle.allow("critical", 1)).toBe(false);
  });

  it("窗口为 0 时每次都放行", () => {
    const throttle = new LevelThrottle(0);
    expect(throttle.allow("warning", 0)).toBe(true);
    expect(throttle.allow("warning", 0)).toBe(true);
  });
});
