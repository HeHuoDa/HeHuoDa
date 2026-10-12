import { dateRange } from "./runner.js";
describe("扫描日期配置", () => {
  it("默认近90天按北京时间计算", () =>
    expect(
      dateRange(
        { sourceId: "life-sciences" },
        new Date("2026-10-10T23:00:00Z"),
      ),
    ).toEqual({ from: "2026-07-14", to: "2026-10-11" }));
  it.each([
    ["2026-02-30", "2026-10-11"],
    ["2026-10-12", "2026-10-11"],
    ["2024-10-01", "2026-10-11"],
  ])("无效或超范围日期拒绝", (from, to) =>
    expect(() => dateRange({ sourceId: "life-sciences", from, to })).toThrow(),
  );
});
