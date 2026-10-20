import { describe, expect, it } from "vitest";
import { exampleGovernance, governanceExamples } from "./governance";
import { ServiceUnavailable } from "../services";
import { ConsoleError, errorMessage } from "./resource";
describe("治理服务边界", () => {
  it("筛选分页独立，隐藏与业务状态分别保留，缺服务写入不改变样例", async () => {
    const page = await exampleGovernance.list("recruitments", {
      q: "",
      status: "hidden",
      from: "",
      to: "",
      page: 2,
      pageSize: 5,
    });
    expect(page.total).toBe(7);
    expect(page.items).toHaveLength(2);
    const row = await exampleGovernance.detail(
      "recruitments",
      "example-recruitment-1",
    );
    expect(row.businessStatus).toBe("recruiting");
    expect(row.hidden).toBe(true);
    await expect(
      exampleGovernance.change("recruitments", {
        id: row.id,
        action: "恢复展示",
        reason: "核查通过",
        version: row.version,
        baseline: row.baseline,
        operationId: "test-operation",
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailable);
    expect(governanceExamples.recruitments[0]?.hidden).toBe(true);
    expect(governanceExamples.recruitments[0]?.businessStatus).toBe(
      "recruiting",
    );
  });
  it("权限与基线错误要求明确处理，不静默成功", () => {
    expect(errorMessage(new ConsoleError(403, "denied"))).toContain("权限不足");
    expect(errorMessage(new ConsoleError(409, "stale"))).toContain(
      "重新加载并重新审核",
    );
  });
});
