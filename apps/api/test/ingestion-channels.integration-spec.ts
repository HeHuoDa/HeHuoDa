import { testDatabase } from "./competition-fixture.js";
import { IngestionRunner } from "../src/ingestion/runner.js";
import { ChannelRoundRunner } from "../src/ingestion/channel-scheduler.js";
import { initializeSources, configureSource } from "../src/ingestion/store.js";
import {
  BoundedFetcher,
  sources,
  type Channel,
} from "@hehuoda/sicau-connectors/notices";
import { informationArticle } from "./notice-fixtures.js";

const source = sources[0];
const original = source.channels;
const second: Channel = {
  ...original[0],
  id: "students",
  listUrl: `https://${source.host}/students/notices.htm`,
  listPath: "^/students/(?:notices\\.htm|notices/\\d+\\.htm)$",
};
const url = (id: number) => `https://${source.host}/info/1043/${id}.htm`;
const listing = (ids: number[], next = "") =>
  ids
    .map(
      (id) =>
        `<div id="line_u_${id}"><h1 class="content-page-title"><a rel="bookmark" href="${url(id)}">2026年测试竞赛${id}</a></h1><span class="spanTime">2026-10-08</span></div>`,
    )
    .join("") +
  `<div class="p_pages">${next ? `<a href="${next}">下页</a>` : ""}</div>`;
describe("多栏目任务、全局预算与公平持续扫描", () => {
  let db: Awaited<ReturnType<typeof testDatabase>>;
  let clock: number;
  beforeAll(async () => {
    source.channels = [...original, second];
    db = await testDatabase();
  });
  afterAll(async () => {
    source.channels = original;
    await db?.close();
  });
  beforeEach(async () => {
    clock = Date.parse("2026-10-28T01:00:00Z");
    source.channels = [...original, second];
    await db.pool.query("TRUNCATE ingestion_sources CASCADE");
    await db.pool.query("TRUNCATE ingestion_rounds CASCADE");
    await initializeSources(db.pool);
    await db.pool.query(
      "UPDATE ingestion_sources SET enabled=false WHERE id<>$1",
      [source.id],
    );
    await db.pool.query(
      "UPDATE ingestion_channels SET enabled=true,verification_status='verified',activated_on='2026-10-28' WHERE source_id=$1",
      [source.id],
    );
  });
  function scanner(
    pages: Record<string, string>,
    requests: string[],
    failing = new Set<string>(),
  ) {
    return new IngestionRunner(
      db.pool,
      (s, l) =>
        new BoundedFetcher(
          s,
          l,
          async (u) => {
            requests.push(u.toString());
            return {
              status:
                u.pathname === "/robots.txt"
                  ? 404
                  : failing.has(u.toString())
                    ? 429
                    : 200,
              headers: {},
              body: new TextEncoder().encode(
                u.pathname === "/robots.txt"
                  ? ""
                  : (pages[u.toString()] ?? informationArticle),
              ),
            };
          },
          () => clock,
          async (ms) => {
            clock += ms;
          },
        ),
      () => new Date(clock),
    );
  }
  it("轮协调锁阻止手动CLI/API扫描插入工作片之间，所有网络仍全局串行", async () => {
    const coordinator = await db.pool.connect();
    await coordinator.query("SELECT pg_advisory_lock(23006)");
    const requests: string[] = [];
    try {
      expect(
        (
          await scanner({ [source.listUrl]: listing([100]) }, requests).scan({
            sourceId: source.id,
            phase: "fresh",
          })
        ).status,
      ).toBe("locked");
      expect(requests).toHaveLength(0);
      expect(
        (
          await scanner({ [source.listUrl]: listing([100]) }, requests).scan({
            sourceId: source.id,
            phase: "fresh",
            roundId: "00000000-0000-4000-8000-000000000174",
          })
        ).status,
      ).toBe("locked");
    } finally {
      await coordinator.query("SELECT pg_advisory_unlock(23006)");
      coordinator.release(true);
    }
    expect(
      (
        await scanner({ [source.listUrl]: listing([100]) }, requests).scan({
          sourceId: source.id,
          phase: "fresh",
        })
      ).status,
    ).toBe("succeeded");
  });
  it("同一来源双栏目发现同URL只维护一条版本候选链并保留两个关联", async () => {
    const runner = scanner(
      { [source.listUrl]: listing([100]), [second.listUrl]: listing([100]) },
      [],
    );
    expect(
      await runner.scan({ sourceId: source.id, phase: "fresh" }),
    ).toMatchObject({ status: "succeeded", counts: { new: 1 } });
    expect(
      await runner.scan({
        sourceId: source.id,
        channelId: second.id,
        phase: "fresh",
      }),
    ).toMatchObject({ status: "succeeded", counts: { new: 0 } });
    const counts = (
      await db.pool.query(
        "SELECT (SELECT count(*)::int FROM ingestion_notices) notices,(SELECT count(*)::int FROM ingestion_versions) versions,(SELECT count(*)::int FROM ingestion_candidates) candidates,(SELECT count(*)::int FROM ingestion_notice_channels) links",
      )
    ).rows[0];
    expect(counts).toEqual({
      notices: 1,
      versions: 1,
      candidates: 1,
      links: 2,
    });
  });
  it("旧版CLI只更新source时仍同步默认栏目，且不能绕过已拒绝的核验", async () => {
    await db.pool.query(
      "UPDATE ingestion_sources SET enabled=false WHERE id=$1",
      [source.id],
    );
    await db.pool.query(
      "UPDATE ingestion_sources SET enabled=true,settings=settings || '{\"requests\":3}'::jsonb WHERE id=$1",
      [source.id],
    );
    expect(
      (
        await db.pool.query(
          "SELECT enabled,settings FROM ingestion_channels WHERE source_id=$1 AND id='default'",
          [source.id],
        )
      ).rows[0],
    ).toEqual({ enabled: true, settings: {} });
    await db.pool.query(
      "UPDATE ingestion_channels SET enabled=false,verification_status='rejected' WHERE source_id=$1 AND id='default'",
      [source.id],
    );
    await db.pool.query(
      "UPDATE ingestion_sources SET enabled=false WHERE id=$1",
      [source.id],
    );
    await expect(
      db.pool.query("UPDATE ingestion_sources SET enabled=true WHERE id=$1", [
        source.id,
      ]),
    ).rejects.toThrow("核验已失效");
  });
  it("backfill固定366天且预算partial后恢复不分叉，配置变化要求显式重建", async () => {
    await configureSource(db.pool, source, true, { requests: 2, maxPages: 1 });
    const runner = scanner({ [source.listUrl]: listing([100, 101]) }, []);
    const first = await runner.scan({ sourceId: source.id, phase: "backfill" });
    expect(first.status).toBe("partial");
    const task = (
      await db.pool.query(
        "SELECT *,from_date::text AS from_date,to_date::text AS to_date FROM ingestion_scan_tasks WHERE phase='backfill'",
      )
    ).rows[0];
    expect(String(task.from_date).slice(0, 10)).toBe("2025-10-28");
    expect(String(task.to_date).slice(0, 10)).toBe("2026-10-28");
    clock += 86400000;
    const changed = { ...original[0], version: "2" };
    source.channels = [changed, second];
    expect(
      await runner.scan({ sourceId: source.id, phase: "backfill" }),
    ).toMatchObject({
      status: "failed",
      errors: [expect.objectContaining({ code: "task-config-changed" })],
    });
    expect(
      (await db.pool.query("SELECT count(*)::int n FROM ingestion_scan_tasks"))
        .rows[0].n,
    ).toBe(1);
    source.channels = [...original, second];
    await configureSource(db.pool, source, true, { requests: 80 });
    const resumed = await runner.scan({
      sourceId: source.id,
      phase: "backfill",
      taskId: task.id,
      from: "2026-10-01",
      to: "2026-10-02",
    });
    expect(resumed.status).toBe("succeeded");
    const persisted = (
      await db.pool.query(
        "SELECT options FROM ingestion_runs ORDER BY started_at DESC,id DESC LIMIT 1",
      )
    ).rows[0].options;
    expect(persisted).toMatchObject({ from: "2025-10-28", to: "2026-10-28" });
    if (!("runId" in first) || !first.runId) throw new Error("缺少run");
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM ingestion_runs WHERE options->>'resume'=$1",
          [first.runId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (await runner.scan({ sourceId: source.id, resume: first.runId })).status,
    ).toBe("failed");
  });
  it("A结构失效时B仍获得新检查机会，失败退避而纯预算partial不退避", async () => {
    const requests: string[] = [];
    const runner = scanner(
      {
        [source.listUrl]: "<html>结构失效</html>",
        [second.listUrl]: listing([101]),
      },
      requests,
    );
    const job = new ChannelRoundRunner(db.pool, runner, () => new Date(clock));
    const result = await job.run({ requests: 8, sliceRequests: 3 });
    expect(result.status).toBe("partial");
    expect(requests).toContain(second.listUrl);
    expect(requests).toContain(url(101));
    const a = (
      await db.pool.query(
        "SELECT failure_count,backoff_until,last_successful_check FROM ingestion_channels WHERE source_id=$1 AND id='default'",
        [source.id],
      )
    ).rows[0];
    expect(a.failure_count).toBe(1);
    expect(a.backoff_until).not.toBeNull();
    expect(a.last_successful_check).toBeNull();
    const b = (
      await db.pool.query(
        "SELECT failure_count,last_successful_check FROM ingestion_channels WHERE source_id=$1 AND id=$2",
        [source.id, second.id],
      )
    ).rows[0];
    expect(b.failure_count).toBe(0);
    expect(b.last_successful_check).not.toBeNull();
    await db.pool.query(
      "UPDATE ingestion_channels SET failure_count=0,backoff_until=NULL WHERE source_id=$1",
      [source.id],
    );
    await configureSource(db.pool, source, true, { requests: 1 });
    expect(
      (await runner.scan({ sourceId: source.id, phase: "backfill" })).status,
    ).toBe("partial");
    expect(
      (
        await db.pool.query(
          "SELECT failure_count FROM ingestion_channels WHERE source_id=$1 AND id='default'",
          [source.id],
        )
      ).rows[0].failure_count,
    ).toBe(0);
  });
  it("工作片重启保留轮转顺序和本轮预算，下一时隙优先给未获机会的栏目", async () => {
    const requests: string[] = [];
    const runner = scanner(
      { [source.listUrl]: listing([100]), [second.listUrl]: listing([101]) },
      requests,
    );
    const first = await new ChannelRoundRunner(
      db.pool,
      runner,
      () => new Date(clock),
    ).run({ requests: 2, sliceRequests: 2 });
    expect(first.status).toBe("partial");
    expect(requests).toContain(source.listUrl);
    expect(requests).not.toContain(second.listUrl);
    requests.length = 0;
    await db.pool.query("UPDATE ingestion_rounds SET budget_usage='{}'::jsonb");
    await new ChannelRoundRunner(db.pool, runner, () => new Date(clock)).run({
      requests: 2,
      sliceRequests: 2,
    });
    expect(requests).toHaveLength(0);
    clock = Date.parse("2026-10-28T10:00:00Z");
    await new ChannelRoundRunner(db.pool, runner, () => new Date(clock)).run({
      requests: 2,
      sliceRequests: 2,
    });
    expect(requests).toContain(second.listUrl);
    expect(requests).not.toContain(source.listUrl);
    expect(
      (await db.pool.query("SELECT count(*)::int n FROM ingestion_rounds"))
        .rows[0].n,
    ).toBe(2);
  });
  it.each(["429", "timeout"])(
    "%s栏目退避后其他栏目仍推进，成功重置且退避封顶6小时",
    async (mode) => {
      let failing = true;
      const requests: string[] = [];
      const runner = new IngestionRunner(
        db.pool,
        (s, l) =>
          new BoundedFetcher(
            s,
            l,
            async (u) => {
              requests.push(u.toString());
              if (
                failing &&
                u.toString() === source.listUrl &&
                mode === "timeout"
              )
                throw new Error("controlled-timeout");
              return {
                status:
                  u.pathname === "/robots.txt"
                    ? 404
                    : failing && u.toString() === source.listUrl
                      ? 429
                      : 200,
                headers: {},
                body: new TextEncoder().encode(
                  u.pathname === "/robots.txt"
                    ? ""
                    : u.pathname.startsWith("/info/")
                      ? informationArticle
                      : listing([100]),
                ),
              };
            },
            () => clock,
            async (ms) => {
              clock += ms;
            },
          ),
        () => new Date(clock),
      );
      await new ChannelRoundRunner(db.pool, runner, () => new Date(clock)).run({
        requests: 10,
        sliceRequests: 4,
      });
      expect(requests).toContain(second.listUrl);
      let state = (
        await db.pool.query(
          "SELECT failure_count,backoff_until FROM ingestion_channels WHERE source_id=$1 AND id='default'",
          [source.id],
        )
      ).rows[0];
      expect(state.failure_count).toBe(1);
      expect(new Date(state.backoff_until).getTime() - clock).toBeGreaterThan(
        0,
      );
      for (const minutes of [30, 60, 120, 240, 360, 360]) {
        clock = new Date(state.backoff_until).getTime() + 1;
        await runner.scan({ sourceId: source.id, phase: "fresh" });
        state = (
          await db.pool.query(
            "SELECT failure_count,backoff_until FROM ingestion_channels WHERE source_id=$1 AND id='default'",
            [source.id],
          )
        ).rows[0];
        expect(new Date(state.backoff_until).getTime() - clock).toBe(
          minutes * 60000,
        );
      }
      failing = false;
      clock = new Date(state.backoff_until).getTime() + 1;
      expect(
        (await runner.scan({ sourceId: source.id, phase: "fresh" })).status,
      ).toBe("succeeded");
      expect(
        (
          await db.pool.query(
            "SELECT failure_count,backoff_until FROM ingestion_channels WHERE source_id=$1 AND id='default'",
            [source.id],
          )
        ).rows[0],
      ).toEqual({ failure_count: 0, backoff_until: null });
    },
  );
  it("剩余预算在所有阶段间有限轮转，显式重建只生成一个后继且保留旧范围", async () => {
    const runner = scanner(
      { [source.listUrl]: listing([100]), [second.listUrl]: listing([101]) },
      [],
    );
    await new ChannelRoundRunner(db.pool, runner, () => new Date(clock)).run({
      requests: 80,
      sliceRequests: 4,
    });
    expect(
      (
        await db.pool.query(
          "SELECT DISTINCT phase FROM ingestion_scan_tasks ORDER BY phase",
        )
      ).rows.map((r) => r.phase),
    ).toEqual(["backfill", "fresh", "retry", "revisit"]);
    await db.pool.query(
      "UPDATE ingestion_scan_tasks SET status='superseded' WHERE phase='backfill'",
    );
    await configureSource(db.pool, source, true, { requests: 2 });
    const first = await runner.scan({ sourceId: source.id, phase: "backfill" });
    expect(first.status).toBe("partial");
    const old = (
      await db.pool.query(
        "SELECT id,cursor,from_date::text AS from_date,to_date::text AS to_date FROM ingestion_scan_tasks WHERE phase='backfill' AND status='partial'",
      )
    ).rows[0];
    source.channels = [{ ...original[0], version: "2" }, second];
    expect(
      (
        await runner.scan({
          sourceId: source.id,
          phase: "backfill",
          rebuildTaskId: old.id,
        })
      ).status,
    ).toBe("partial");
    await runner.scan({
      sourceId: source.id,
      phase: "backfill",
      rebuildTaskId: old.id,
    });
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM ingestion_scan_tasks WHERE rebuild_of=$1",
          [old.id],
        )
      ).rows[0].n,
    ).toBe(1);
    const preserved = (
      await db.pool.query(
        "SELECT status,cursor,from_date::text AS from_date,to_date::text AS to_date FROM ingestion_scan_tasks WHERE id=$1",
        [old.id],
      )
    ).rows[0];
    expect(preserved).toEqual({
      status: "superseded",
      cursor: old.cursor,
      from_date: old.from_date,
      to_date: old.to_date,
    });
  });
  it("retry独立接续尚未落库的失败通知，不复制通知版本或改写原阶段范围", async () => {
    let failing = true;
    const runner = new IngestionRunner(
      db.pool,
      (s, l) =>
        new BoundedFetcher(
          s,
          l,
          async (u) => {
            if (failing && u.toString() === url(100))
              throw new Error("controlled-timeout");
            return {
              status: u.pathname === "/robots.txt" ? 404 : 200,
              headers: {},
              body: new TextEncoder().encode(
                u.pathname === "/robots.txt"
                  ? ""
                  : u.pathname.startsWith("/info/")
                    ? informationArticle
                    : listing([100]),
              ),
            };
          },
          () => clock,
          async (ms) => {
            clock += ms;
          },
        ),
      () => new Date(clock),
    );
    expect(
      (await runner.scan({ sourceId: source.id, phase: "fresh" })).status,
    ).toBe("partial");
    const originalTask = (
      await db.pool.query(
        "SELECT id,from_date::text,to_date::text FROM ingestion_scan_tasks WHERE phase='fresh'",
      )
    ).rows[0];
    failing = false;
    expect(
      await runner.scan({ sourceId: source.id, phase: "retry" }),
    ).toMatchObject({ status: "succeeded", counts: { new: 1 } });
    expect(
      (
        await db.pool.query(
          "SELECT id,from_date::text,to_date::text FROM ingestion_scan_tasks WHERE id=$1",
          [originalTask.id],
        )
      ).rows[0],
    ).toEqual(originalTask);
    expect(
      (await db.pool.query("SELECT count(*)::int n FROM ingestion_versions"))
        .rows[0].n,
    ).toBe(1);
  });
  it("缺少状态行的新栏目preview不发请求，backfill新任务不能指定另一范围", async () => {
    await db.pool.query(
      "DELETE FROM ingestion_channels WHERE source_id=$1 AND id=$2",
      [source.id, second.id],
    );
    const requests: string[] = [];
    const runner = scanner({ [second.listUrl]: listing([100]) }, requests);
    expect(
      (
        await runner.scan({
          sourceId: source.id,
          channelId: second.id,
          phase: "fresh",
          preview: true,
        })
      ).status,
    ).toBe("disabled");
    expect(requests).toHaveLength(0);
    expect(
      (
        await runner.scan({
          sourceId: source.id,
          phase: "backfill",
          from: "2026-01-01",
          to: "2026-01-02",
        })
      ).status,
    ).toBe("failed");
    expect(
      (await db.pool.query("SELECT count(*)::int n FROM ingestion_scan_tasks"))
        .rows[0].n,
    ).toBe(0);
  });
  it("任务完成写失败不会留下成功run与running task，恢复后可完成同一任务", async () => {
    await db.pool.query(
      "CREATE FUNCTION reject_task_finish() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='succeeded' THEN RAISE EXCEPTION 'controlled task finish failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_finish BEFORE UPDATE OF status ON ingestion_scan_tasks FOR EACH ROW EXECUTE FUNCTION reject_task_finish()",
    );
    const runner = scanner({ [source.listUrl]: listing([100]) }, []);
    try {
      expect(
        (await runner.scan({ sourceId: source.id, phase: "fresh" })).status,
      ).toBe("failed");
    } finally {
      await db.pool.query(
        "DROP TRIGGER reject_finish ON ingestion_scan_tasks; DROP FUNCTION reject_task_finish()",
      );
    }
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM ingestion_runs r JOIN ingestion_scan_tasks t ON t.leaf_run_id=r.id WHERE r.status='succeeded' AND t.status<>'succeeded'",
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (await runner.scan({ sourceId: source.id, phase: "fresh" })).status,
    ).toBe("succeeded");
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM ingestion_scan_tasks WHERE status='succeeded'",
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("在途请求开始前已持久化预算预留，进程退出不会重置本轮网络额度", async () => {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => {
        enter = resolve;
      }),
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    const runner = new IngestionRunner(
      db.pool,
      (s, l) =>
        new BoundedFetcher(
          s,
          l,
          async () => {
            enter();
            await gate;
            return { status: 404, headers: {}, body: new Uint8Array() };
          },
          () => clock,
          async (ms) => {
            clock += ms;
          },
        ),
      () => new Date(clock),
    );
    await configureSource(db.pool, source, true, { requests: 1 });
    const pending = runner.scan({ sourceId: source.id, phase: "fresh" });
    await entered;
    try {
      expect(
        (
          await db.pool.query(
            "SELECT budget_usage->>'requests' n FROM ingestion_runs WHERE status='running'",
          )
        ).rows[0].n,
      ).toBe("1");
    } finally {
      release();
    }
    expect((await pending).status).toBe("partial");
  });
  it("preview不写来源栏目任务运行通知或关联，页数与时长预算均保留进度", async () => {
    await configureSource(db.pool, source, true, { maxPages: 1 });
    const before = (
      await db.pool.query(
        "SELECT (SELECT count(*) FROM ingestion_runs) runs,(SELECT count(*) FROM ingestion_scan_tasks) tasks,(SELECT count(*) FROM ingestion_notice_channels) links",
      )
    ).rows[0];
    const runner = scanner(
      {
        [source.listUrl]: listing(
          [100],
          `https://${source.host}/xygl/tz/1.htm`,
        ),
      },
      [],
    );
    expect(
      (
        await runner.scan({
          sourceId: source.id,
          phase: "backfill",
          preview: true,
        })
      ).status,
    ).toBe("partial");
    expect(
      (
        await db.pool.query(
          "SELECT (SELECT count(*) FROM ingestion_runs) runs,(SELECT count(*) FROM ingestion_scan_tasks) tasks,(SELECT count(*) FROM ingestion_notice_channels) links",
        )
      ).rows[0],
    ).toEqual(before);
    await configureSource(db.pool, source, true, { maxPages: 1 });
    expect(
      await runner.scan({ sourceId: source.id, phase: "backfill" }),
    ).toMatchObject({
      status: "partial",
      cursor: { pages: [`https://${source.host}/xygl/tz/1.htm`] },
    });
    await configureSource(db.pool, source, true, { durationMs: 1000 });
    expect(
      await runner.scan({ sourceId: source.id, phase: "fresh" }),
    ).toMatchObject({ status: "partial", counts: { failed: 0 } });
  });
});
