import { windowStart } from "./auth-rate-limiter.js";

describe("限流固定窗口", () => {
  it("同一分钟内落到同一窗口起点", () => {
    const a = windowStart(new Date("2026-10-24T12:00:00.000Z"));
    const b = windowStart(new Date("2026-10-24T12:00:59.999Z"));
    expect(a).toEqual(new Date("2026-10-24T12:00:00.000Z"));
    expect(b).toEqual(new Date("2026-10-24T12:00:00.000Z"));
  });
  it("跨分钟落到下一窗口起点", () => {
    expect(windowStart(new Date("2026-10-24T12:01:00.000Z"))).toEqual(
      new Date("2026-10-24T12:01:00.000Z"),
    );
    expect(windowStart(new Date("2026-10-24T12:01:30.000Z"))).toEqual(
      new Date("2026-10-24T12:01:00.000Z"),
    );
  });
});
