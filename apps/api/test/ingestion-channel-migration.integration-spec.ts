import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { migrate } from "../src/database/migrate.js";
import { testDatabase } from "./competition-fixture.js";
import { sources } from "@hehuoda/sicau-connectors/notices";
import {
  channelFingerprint,
  initializeChannels,
  readChannel,
} from "../src/ingestion/channel-store.js";

describe("多栏目存储迁移", () => {
  it("旧来源、游标与通知可升级到默认栏目且重复迁移不改历史数据", async () => {
    const folder = await mkdtemp(join(tmpdir(), "hh-ingestion-channels-"));
    let db: Awaited<ReturnType<typeof testDatabase>> | undefined;
    try {
      for (const name of (await readdir(resolve("migrations"))).filter(
        (entry) => entry.endsWith(".sql") && entry < "0009",
      ))
        await copyFile(join(resolve("migrations"), name), join(folder, name));
      db = await testDatabase(folder);
      await initializeChannels(db.pool);
      const source = sources.find((entry) => entry.id === "life-sciences")!;
      const oldConfig = {
        id: source.id,
        publisher: source.publisher,
        host: source.host,
        listUrl: source.listUrl,
        version: source.version,
        defaultChannelId: source.defaultChannelId,
        channels: source.channels,
      };
      await db.pool.query(
        "INSERT INTO ingestion_sources(id,data,enabled,settings) VALUES($1,$2,true,$3)",
        [source.id, oldConfig, { requests: 37, maxPages: 4 }],
      );
      for (const otherSource of sources.filter(
        (entry) => entry.id !== source.id,
      ))
        await db.pool.query(
          "INSERT INTO ingestion_sources(id,data,enabled) VALUES($1,$2,false)",
          [otherSource.id, otherSource],
        );
      const cursor = { pages: [source.listUrl], pending: [], seen: [] };
      const options = {
        sourceId: source.id,
        from: "2026-01-01",
        to: "2026-12-31",
      };
      await db.pool.query(
        "INSERT INTO ingestion_runs(id,source_id,trigger,status,options,cursor,counts,errors) VALUES($1,$2,'manual','partial',$3,$4,'{}','[]')",
        ["old-run", source.id, options, cursor],
      );
      await db.pool.query(
        "INSERT INTO ingestion_notices(id,source_id,url,final_url,fetched_at,health) VALUES('old-notice',$1,$2,$2,now(),'available')",
        [source.id, `https://${source.host}/info/1061/100.htm`],
      );
      await db.pool.query(
        `INSERT INTO ingestion_versions(id,notice_id,revision,body_hash,adapter_version,fetched_at,article,extracted,response_headers)
         VALUES('old-version','old-notice',1,'body-hash','adapter-1',now(),'{}','{}','{}')`,
      );
      await db.pool.query(
        `INSERT INTO ingestion_candidates(id,notice_id,source_version,revision,status,data)
         VALUES('old-candidate','old-notice','old-version',2,'pending','{"title":"保留候选"}')`,
      );

      await migrate(db.pool);
      const channel = (
        await db.pool.query(
          "SELECT source_id,id,data,enabled,settings,verification_status,verified_at,verified_by FROM ingestion_channels WHERE source_id=$1",
          [source.id],
        )
      ).rows[0];
      expect(channel).toMatchObject({
        source_id: source.id,
        id: "default",
        data: source.channels[0],
        enabled: true,
        settings: { requests: 37, maxPages: 4 },
        verification_status: "pending",
        verified_at: null,
        verified_by: null,
      });
      expect(await readChannel(db.pool, source.id, "default")).toMatchObject({
        source_id: source.id,
        id: "default",
        data: source.channels[0],
        enabled: true,
      });
      expect(
        (await db.pool.query("SELECT * FROM ingestion_notice_channels")).rows,
      ).toMatchObject([
        expect.objectContaining({
          notice_id: "old-notice",
          source_id: source.id,
          channel_id: "default",
        }),
      ]);
      const oldRun = (
        await db.pool.query(
          "SELECT source_id,options,cursor,status FROM ingestion_runs WHERE id='old-run'",
        )
      ).rows[0];
      expect(oldRun).toEqual({
        source_id: source.id,
        options,
        cursor,
        status: "partial",
      });
      const oldVersionAndCandidate = (
        await db.pool.query(
          `SELECT v.id AS version_id,v.notice_id,v.revision AS version_revision,
                  c.id AS candidate_id,c.source_version,c.revision AS candidate_revision,c.data
             FROM ingestion_versions v JOIN ingestion_candidates c ON c.source_version=v.id
            WHERE v.id='old-version' AND c.id='old-candidate'`,
        )
      ).rows[0];
      expect(oldVersionAndCandidate).toEqual({
        version_id: "old-version",
        notice_id: "old-notice",
        version_revision: 1,
        candidate_id: "old-candidate",
        source_version: "old-version",
        candidate_revision: 2,
        data: { title: "保留候选" },
      });

      await db.pool.query(
        `UPDATE ingestion_channels
            SET enabled=false,settings='{"requests":9}'::jsonb,
                verification_status='verified',verification='{"reviewer":"admin"}'::jsonb,
                verified_at=now(),verified_by='admin'
          WHERE source_id=$1 AND id='default'`,
        [source.id],
      );

      await migrate(db.pool);
      await initializeChannels(db.pool);
      await initializeChannels(db.pool);
      const legacyRunAfterInitialization = (
        await db.pool.query(
          "SELECT id,phase,config_hash,options,cursor FROM ingestion_runs WHERE id='old-run'",
        )
      ).rows[0];
      expect(legacyRunAfterInitialization).toEqual({
        id: "old-run",
        phase: null,
        config_hash: channelFingerprint(source, source.channels[0]!),
        options,
        cursor,
      });
      expect(
        (
          await db.pool.query(
            `SELECT enabled,settings,verification_status,verification,verified_by
               FROM ingestion_channels WHERE source_id=$1 AND id='default'`,
            [source.id],
          )
        ).rows[0],
      ).toMatchObject({
        enabled: false,
        settings: { requests: 9 },
        verification_status: "verified",
        verification: { reviewer: "admin" },
        verified_by: "admin",
      });
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int AS count FROM ingestion_channels",
          )
        ).rows[0].count,
      ).toBe(sources.reduce((sum, entry) => sum + entry.channels.length, 0));
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int AS count FROM ingestion_notice_channels WHERE notice_id='old-notice'",
          )
        ).rows[0].count,
      ).toBe(1);
      expect(
        (
          await db.pool.query(
            "SELECT id FROM ingestion_runs WHERE id='old-run'",
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await db.pool.query(
            "SELECT id FROM ingestion_versions WHERE id='old-version'",
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await db.pool.query(
            "SELECT id FROM ingestion_candidates WHERE id='old-candidate'",
          )
        ).rows,
      ).toHaveLength(1);
    } finally {
      await db?.close();
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("从未开启的旧来源升级后默认栏目也保持停用", async () => {
    const folder = await mkdtemp(
      join(tmpdir(), "hh-ingestion-channels-disabled-"),
    );
    let db: Awaited<ReturnType<typeof testDatabase>> | undefined;
    try {
      for (const name of (await readdir(resolve("migrations"))).filter(
        (entry) => entry.endsWith(".sql") && entry < "0009",
      ))
        await copyFile(join(resolve("migrations"), name), join(folder, name));
      db = await testDatabase(folder);
      const source = sources[0]!;
      await db.pool.query(
        "INSERT INTO ingestion_sources(id,data,enabled) VALUES($1,$2,false)",
        [source.id, source],
      );
      await migrate(db.pool);
      expect(
        (
          await db.pool.query(
            "SELECT enabled FROM ingestion_channels WHERE source_id=$1 AND id='default'",
            [source.id],
          )
        ).rows[0],
      ).toEqual({ enabled: false });
    } finally {
      await db?.close();
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("fresh任务按round唯一，其他phase仍保持单个active task", async () => {
    const db = await testDatabase();
    try {
      const source = sources[0]!;
      await db.pool.query(
        "INSERT INTO ingestion_sources(id,data) VALUES($1,$2)",
        [source.id, source],
      );
      await initializeChannels(db.pool);
      const rounds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
      for (const roundId of rounds)
        await db.pool.query(
          "INSERT INTO ingestion_rounds(id,due_at,status) VALUES($1,now(),'running')",
          [roundId],
        );

      const insertTask = (
        id: string,
        phase: string,
        roundId: string | null,
        rebuildOf: string | null = null,
      ) =>
        db!.pool.query(
          `INSERT INTO ingestion_scan_tasks
             (id,source_id,channel_id,round_id,rebuild_of,phase,from_date,to_date,config_hash,status)
           VALUES($1,$2,'default',$3,$4,$5,'2026-01-01','2026-01-31','config','pending')`,
          [id, source.id, roundId, rebuildOf, phase],
        );

      const originalFresh = randomUUID();
      await insertTask(originalFresh, "fresh", rounds[0]!);
      await insertTask(randomUUID(), "fresh", rounds[1]!);
      await expect(
        insertTask(randomUUID(), "fresh", rounds[0]!),
      ).rejects.toThrow();
      await insertTask(randomUUID(), "fresh", rounds[2]!, originalFresh);
      await expect(
        insertTask(randomUUID(), "fresh", rounds[3]!, originalFresh),
      ).rejects.toThrow();

      await insertTask(randomUUID(), "backfill", null);
      await expect(
        insertTask(randomUUID(), "backfill", null),
      ).rejects.toThrow();
    } finally {
      await db.close();
    }
  });
});
