import { importBatch } from "../src/competitions/import.js";
import { formalScope } from "../src/ingestion/candidate-contract.js";
import { directory, edition, testDatabase } from "./competition-fixture.js";

/**
 * 候选协议四值与正式 ScopeRecord 是两套枚举。这里验证映射只走允许的四条，
 * 且被拒绝的有损映射不会写进正式数据。
 */
describe("候选范围到正式范围的映射与导入", () => {
  let isolated: Awaited<ReturnType<typeof testDatabase>>;
  beforeAll(async () => {
    isolated = await testDatabase();
    await importBatch(isolated.pool, { colleges: directory });
  });

  it("all/specified/other/unknown 各自落到正式四值", async () => {
    const cases = [
      {
        scope: { kind: "all" as const, colleges: [], note: "全校" },
        expected: "all",
        colleges: [] as string[],
      },
      {
        scope: {
          kind: "specified" as const,
          colleges: ["science"],
          note: "理学院",
        },
        expected: "colleges",
        colleges: ["science"],
      },
      {
        scope: { kind: "other" as const, colleges: [], note: "不含毕业年级" },
        expected: "complex",
        colleges: [],
      },
      {
        scope: { kind: "unknown" as const, colleges: [], note: "待核对" },
        expected: "unknown",
        colleges: [],
      },
    ];
    let index = 0;
    for (const item of cases) {
      const id = `scope-map-${index++}`;
      const record = edition(id);
      record.stages![0].scope = formalScope(item.scope);
      await importBatch(isolated.pool, {
        competitions: [record],
      });
      const saved = (
        await isolated.pool.query("SELECT data FROM stages WHERE id=$1", [
          record.stages![0].id,
        ])
      ).rows[0].data.scope;
      expect(saved).toMatchObject({
        kind: item.expected,
        note: item.scope.note,
      });
      const eligibility = (
        await isolated.pool.query(
          "SELECT college_id FROM stage_eligibility WHERE stage_id=$1 ORDER BY college_id",
          [record.stages![0].id],
        )
      ).rows.map((row: { college_id: string }) => row.college_id);
      expect(eligibility).toEqual(item.colleges);
    }
  });

  it("禁止有损映射：other 不能变成 colleges，unknown 不能变成 all", () => {
    // other 即使被误传学院也不能写入允许范围。
    expect(() =>
      formalScope({ kind: "other", colleges: ["science"], note: "否定条款" }),
    ).not.toThrow();
    expect(
      formalScope({ kind: "other", colleges: ["science"], note: "否定条款" })
        .colleges,
    ).toEqual([]);
    // unknown 只能映射为 unknown。
    expect(formalScope({ kind: "unknown", colleges: [], note: "" }).kind).toBe(
      "unknown",
    );
  });

  it("正式模型仍拒绝空指定学院与全校附学院", async () => {
    const empty = edition("invalid-empty");
    empty.stages![0].scope = { kind: "colleges", colleges: [], note: "" };
    await expect(
      importBatch(isolated.pool, { competitions: [empty] }),
    ).rejects.toThrow(/指定学院范围不能为空/);

    const polluted = edition("invalid-all");
    polluted.stages![0].scope = {
      kind: "all",
      colleges: ["science"],
      note: "",
    };
    await expect(
      importBatch(isolated.pool, { competitions: [polluted] }),
    ).rejects.toThrow(/全校范围不能附指定学院/);
  });
});
