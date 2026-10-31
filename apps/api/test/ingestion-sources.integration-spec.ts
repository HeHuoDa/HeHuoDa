import { testDatabase } from "./competition-fixture.js";
import { initializeSources } from "../src/ingestion/store.js";
import { sources } from "@hehuoda/sicau-connectors/notices";

describe("四院试点来源在隔离库的默认状态", () => {
  let db: Awaited<ReturnType<typeof testDatabase>>;
  beforeAll(async () => {
    db = await testDatabase();
    await initializeSources(db.pool);
  });
  afterAll(async () => {
    await db?.close();
  });

  it("新增两院默认停用且栏目待核验，原两院沿用默认启用语义", async () => {
    const rows = (
      await db.pool.query<{
        id: string;
        enabled: boolean;
        channel_enabled: boolean;
        verification_status: string;
        activated_on: string | null;
      }>(
        `SELECT s.id,s.enabled,c.enabled AS channel_enabled,c.verification_status,c.activated_on::text AS activated_on
           FROM ingestion_sources s
           JOIN ingestion_channels c ON c.source_id=s.id AND c.id='default'
          ORDER BY s.id`,
      )
    ).rows;
    expect(rows.map((row) => row.id).sort()).toEqual(
      sources.map((entry) => entry.id).sort(),
    );

    for (const id of ["science", "arts-media"]) {
      expect(rows.find((row) => row.id === id)).toEqual({
        id,
        enabled: false,
        channel_enabled: false,
        verification_status: "pending",
        activated_on: null,
      });
    }
    for (const id of ["information-engineering", "life-sciences"]) {
      const row = rows.find((entry) => entry.id === id);
      expect(row).toMatchObject({ enabled: true, channel_enabled: true });
      expect(row?.activated_on).not.toBeNull();
    }
  });

  it("新增来源的栏目预算随来源默认值初始化，未启用时不产生扫描任务", async () => {
    const tasks = await db.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM ingestion_scan_tasks WHERE source_id = ANY($1)",
      [["science", "arts-media"]],
    );
    expect(tasks.rows[0].count).toBe("0");
    const runs = await db.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM ingestion_runs WHERE source_id = ANY($1)",
      [["science", "arts-media"]],
    );
    expect(runs.rows[0].count).toBe("0");
  });
});
