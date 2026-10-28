import { scheduledWindow } from "./channel-scheduler.js";
describe("北京时间采集轮时隙", () => {
  it.each([
    [
      "2026-10-28T00:59:59Z",
      "2026-10-27T10:00:00.000Z",
      "2026-10-28T01:00:00.000Z",
    ],
    [
      "2026-10-28T01:00:00Z",
      "2026-10-28T01:00:00.000Z",
      "2026-10-28T10:00:00.000Z",
    ],
    [
      "2026-10-28T10:00:00Z",
      "2026-10-28T10:00:00.000Z",
      "2026-10-29T01:00:00.000Z",
    ],
  ])("%s绑定既定范围和下一触发截止", (now, due, next) => {
    const window = scheduledWindow(new Date(now));
    expect(window.dueAt.toISOString()).toBe(due);
    expect(window.nextDueAt.toISOString()).toBe(next);
  });
});
