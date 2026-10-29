import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  sources,
  extractArticle,
  parseCandidate,
} from "@hehuoda/sicau-connectors/notices";
import { migrate } from "../src/database/migrate.js";
import { initializeSources, persistArticle } from "../src/ingestion/store.js";
import { importBatch } from "../src/competitions/import.js";
import { testDatabase, directory, edition } from "./competition-fixture.js";
import { informationArticle } from "./notice-fixtures.js";

describe("采集管理增量迁移", () => {
  it("升级保留原来源配置、通知版本、候选、正式比赛和维护者审计，旧查询仍可执行", async () => {
    const folder = await mkdtemp(join(tmpdir(), "hh-ingestion-upgrade-"));
    let db: Awaited<ReturnType<typeof testDatabase>> | undefined;
    try {
      const migrations = resolve("migrations");
      for (const name of (await readdir(migrations)).filter(
        (name) => name.endsWith(".sql") && name < "0007",
      ))
        await copyFile(join(migrations, name), join(folder, name));
      db = await testDatabase(folder);
      await initializeSources(db.pool);
      await importBatch(db.pool, {
        colleges: directory,
        competitions: [edition()],
      });
      const source = sources[0]!;
      const url = `https://${source.host}/info/1043/100.htm`;
      const article = extractArticle(informationArticle, url, source);
      const stored = await persistArticle(
        db.pool,
        source,
        url,
        {
          status: 200,
          headers: {},
          body: new TextEncoder().encode(informationArticle),
          url,
          html: informationArticle,
        },
        article,
        parseCandidate(article, url, directory!),
      );
      await db.pool.query(
        "UPDATE ingestion_sources SET enabled=false,settings=settings || '{\"maxPages\":3}'::jsonb WHERE id=$1",
        [source.id],
      );
      await db.pool.query(
        "INSERT INTO admin_operations(actor_type,action,object_type,reason,result,request_id) VALUES('maintenance','legacy.check','source','原维护记录','success','legacy')",
      );
      const before = (
        await db.pool.query(
          "SELECT c.*,v.article,v.extracted FROM ingestion_candidates c JOIN ingestion_versions v ON v.id=c.source_version WHERE c.id=$1",
          [stored.candidateId],
        )
      ).rows[0];
      await migrate(db.pool);
      await migrate(db.pool);
      expect(
        (
          await db.pool.query(
            "SELECT c.*,v.article,v.extracted FROM ingestion_candidates c JOIN ingestion_versions v ON v.id=c.source_version WHERE c.id=$1",
            [stored.candidateId],
          )
        ).rows[0],
      ).toEqual({
        ...before,
        classification: "suspected",
        rule_version: "legacy",
        extraction_key: null,
        classification_override: null,
        needs_review: true,
        priority: 2,
      });
      expect(
        (
          await db.pool.query(
            "SELECT enabled,settings->>'maxPages' AS pages FROM ingestion_sources WHERE id=$1",
            [source.id],
          )
        ).rows[0],
      ).toEqual({ enabled: false, pages: "3" });
      expect(
        (
          await db.pool.query(
            "SELECT publication FROM competitions WHERE id='alpha'",
          )
        ).rows[0],
      ).toEqual({ publication: "published" });
      expect(
        (
          await db.pool.query(
            "SELECT reason,command_operation_id FROM admin_operations WHERE request_id='legacy'",
          )
        ).rows[0],
      ).toEqual({ reason: "原维护记录", command_operation_id: null });
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int AS total FROM ingestion_requests",
          )
        ).rows[0].total,
      ).toBe(0);
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int AS total FROM schema_migrations WHERE name LIKE '0007%' OR name LIKE '0008%'",
          )
        ).rows[0].total,
      ).toBe(2);
    } finally {
      await db?.close();
      await rm(folder, { recursive: true, force: true });
    }
  }, 60000);
});
