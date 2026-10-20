import { describe, expect, it } from "vitest";
import { readQuery } from "./query";
describe("管理列表URL参数", () => {
  it("拒绝无效日历日期和逆序区间，不把错误日期当无结果查询", () => {
    expect(
      readQuery({ from: "2026-02-30", to: "2026-99-99" }, {}),
    ).toMatchObject({ from: "", to: "" });
    expect(
      readQuery({ from: "2026-10-20", to: "2026-10-01" }, {}),
    ).toMatchObject({ from: "", to: "" });
    expect(
      readQuery({ from: "2024-02-29", to: "2026-10-20" }, {}),
    ).toMatchObject({ from: "2024-02-29", to: "2026-10-20" });
  });
});
