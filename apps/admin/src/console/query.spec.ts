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
  it("只接受 1–50 的每页条数，其他值回退默认", () => {
    expect(readQuery({ pageSize: "20" }, {}).pageSize).toBe(20);
    expect(readQuery({ pageSize: "50" }, {}).pageSize).toBe(50);
    expect(readQuery({ pageSize: "51" }, {}).pageSize).toBe(5);
    expect(readQuery({ pageSize: "0" }, {}).pageSize).toBe(5);
    expect(readQuery({ pageSize: "abc" }, {}).pageSize).toBe(5);
  });
  it("默认每页条数与调用方选项一致", () => {
    // 比赛列表只提供 10/20/50，默认 10 才能让选择器有有效值。
    expect(readQuery({}, {}, 10).pageSize).toBe(10);
    expect(readQuery({ pageSize: "20" }, {}, 10).pageSize).toBe(20);
    expect(readQuery({ pageSize: "7" }, {}, 10).pageSize).toBe(7);
  });
});
