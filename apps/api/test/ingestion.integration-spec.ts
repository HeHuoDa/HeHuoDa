import { Pool } from "pg";
import { testDatabase, directory, edition } from "./competition-fixture.js";
import { correctedReview } from "./ingestion-fixture.js";
import { importBatch } from "../src/competitions/import.js";
import { readCatalog } from "../src/competitions/catalog.js";
import {
  BoundedFetcher,
  defaultLimits,
  type HttpResponse,
  type Transport,
} from "../src/ingestion/http.js";
import { sources } from "../src/ingestion/sources.js";
import { extractArticle } from "../src/ingestion/html.js";
import {
  informationArticle,
  informationList,
} from "../src/ingestion/fixtures.js";
import { parseCandidate } from "../src/ingestion/parse.js";
import {
  persistArticle,
  initializeSources,
  cleanupResponses,
  configureSource,
  recoverInterruptedRuns,
} from "../src/ingestion/store.js";
import {
  approveReview,
  applyReview,
  exportReview,
  publishImported,
  setReviewState,
} from "../src/ingestion/review.js";
import { IngestionRunner } from "../src/ingestion/runner.js";

const source = sources[0],
  url = `https://${source.host}/info/1043/100.htm`;
const http = (
  status: number,
  html = "",
  headers: Record<string, string> = {},
): HttpResponse => ({ status, headers, body: new TextEncoder().encode(html) });
describe("通知候选与正式导入的 PostgreSQL 事务", () => {
  let db: Awaited<ReturnType<typeof testDatabase>>;
  beforeAll(async () => {
    db = await testDatabase();
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await db.pool.query(
      "TRUNCATE ingestion_sources,colleges,competitions CASCADE",
    );
    await initializeSources(db.pool);
    await importBatch(db.pool, { colleges: directory });
  });
  async function persist(html = informationArticle, version = source.version) {
    const article = extractArticle(html, url, source);
    return persistArticle(
      db.pool,
      { ...source, version },
      url,
      { ...http(200, html), url, html },
      article,
      parseCandidate(article, url, directory!),
    );
  }
  async function candidate() {
    return (await db.pool.query("SELECT * FROM ingestion_candidates")).rows[0];
  }
  async function formal() {
    const client = await db.pool.connect();
    try {
      return await readCatalog(client);
    } finally {
      client.release();
    }
  }
  async function approved(target?: string) {
    const stored = await persist();
    const file = correctedReview(
      await exportReview(db.pool, stored.candidateId!, target),
    );
    await approveReview(db.pool, file, "maintainer");
    return file;
  }
  function runner(responses: (HttpResponse | Error)[]) {
    let time = 0;
    const transport: Transport = async () => {
      const res = responses.shift();
      if (!res) throw new Error("测试内响应不足");
      if (res instanceof Error) throw res;
      return res;
    };
    return new IngestionRunner(
      db.pool,
      (s, l) =>
        new BoundedFetcher(
          s,
          l,
          transport,
          () => time,
          async (ms) => {
            time += ms;
          },
        ),
    );
  }
  it("重复采集无新版本，官网修改与适配器升级新增版本，连接重建仍保留", async () => {
    expect((await persist()).action).toBe("new");
    expect((await persist()).action).toBe("unchanged");
    expect(
      (await persist(informationArticle.replace("10月20日", "10月21日")))
        .action,
    ).toBe("changed");
    expect((await candidate()).revision).toBe(2);
    await persist(informationArticle.replace("10月20日", "10月21日"), "2");
    expect((await candidate()).revision).toBe(3);
    const restarted = new Pool({ connectionString: db.url });
    try {
      expect(
        (await restarted.query("SELECT count(*) FROM ingestion_versions"))
          .rows[0].count,
      ).toBe("3");
    } finally {
      await restarted.end();
    }
    expect((await formal()).competitions).toHaveLength(0);
  });
  it("拒绝不被重复采集重开，显式重开或新版本才恢复待审核", async () => {
    const stored = await persist();
    await setReviewState(
      db.pool,
      stored.candidateId!,
      "reject",
      "maintainer",
      "普通新闻",
    );
    await persist();
    expect((await candidate()).status).toBe("rejected");
    await setReviewState(
      db.pool,
      stored.candidateId!,
      "reopen",
      "maintainer",
      "重新核对",
    );
    expect((await candidate()).status).toBe("pending");
    await setReviewState(
      db.pool,
      stored.candidateId!,
      "reject",
      "maintainer",
      "暂不导入",
    );
    await persist(informationArticle.replace("10月20日", "10月21日"));
    expect((await candidate()).status).toBe("pending");
  });
  it("审核通过、草稿导入、显式发布分开，重复审核与应用幂等", async () => {
    const file = await approved();
    expect((await candidate()).status).toBe("approved");
    expect((await formal()).competitions).toHaveLength(0);
    expect(await approveReview(db.pool, file, "maintainer")).toMatchObject({
      status: "approved",
    });
    await applyReview(db.pool, file, "maintainer", { preview: true });
    expect((await formal()).competitions).toHaveLength(0);
    await applyReview(db.pool, file, "maintainer");
    await applyReview(db.pool, file, "maintainer");
    expect((await formal()).competitions[0].publication).toBe("draft");
    expect(
      (
        await db.pool.query(
          "SELECT count(*) FROM ingestion_operations WHERE kind='import'",
        )
      ).rows[0].count,
    ).toBe("1");
    const publish = await exportReview(db.pool, file.candidateId);
    await publishImported(
      db.pool,
      file.candidateId,
      "maintainer",
      publish.baseline,
      { preview: true },
    );
    expect((await formal()).competitions[0].publication).toBe("draft");
    await publishImported(
      db.pool,
      file.candidateId,
      "maintainer",
      publish.baseline,
    );
    await publishImported(
      db.pool,
      file.candidateId,
      "maintainer",
      publish.baseline,
    );
    expect((await formal()).competitions[0].publication).toBe("published");
    expect(
      (
        await db.pool.query(
          "SELECT kind FROM ingestion_operations ORDER BY created_at",
        )
      ).rows.map((r) => r.kind),
    ).toEqual(["approve", "preview", "import", "publish"]);
    expect((await formal()).competitions[0].notices[0].checkedAt).toBe(
      "2026-10-11",
    );
    expect(
      (await db.pool.query("SELECT fetched_at FROM ingestion_versions")).rows[0]
        .fetched_at,
    ).toBeInstanceOf(Date);
  });
  it("已导入候选不能被拒绝破坏发布状态，拒绝与重开重复执行不新增修订", async () => {
    const stored = await persist();
    const id = stored.candidateId!;
    const rejected = await setReviewState(
      db.pool,
      id,
      "reject",
      "maintainer",
      "待核对",
    );
    expect(
      await setReviewState(db.pool, id, "reject", "maintainer", "待核对"),
    ).toEqual(rejected);
    const reopened = await setReviewState(
      db.pool,
      id,
      "reopen",
      "maintainer",
      "已核对",
    );
    expect(
      await setReviewState(db.pool, id, "reopen", "maintainer", "已核对"),
    ).toEqual(reopened);
    expect((await candidate()).revision).toBe(reopened.candidateRevision);
    const file = correctedReview(await exportReview(db.pool, id));
    await approveReview(db.pool, file, "maintainer");
    await applyReview(db.pool, file, "maintainer");
    await expect(
      setReviewState(db.pool, id, "reject", "maintainer", "撤回"),
    ).rejects.toThrow("已导入");
    expect((await candidate()).status).toBe("imported");
    const publication = await exportReview(db.pool, id);
    await publishImported(db.pool, id, "maintainer", publication.baseline);
    expect((await formal()).competitions[0].publication).toBe("published");
  });
  it("并发审核和应用只提交一次正式记录与操作", async () => {
    const stored = await persist();
    const file = correctedReview(
      await exportReview(db.pool, stored.candidateId!),
    );
    await Promise.all([
      approveReview(db.pool, file, "maintainer"),
      approveReview(db.pool, file, "maintainer"),
    ]);
    await Promise.all([
      applyReview(db.pool, file, "maintainer"),
      applyReview(db.pool, file, "maintainer"),
    ]);
    expect((await formal()).competitions).toHaveLength(1);
    expect(
      (
        await db.pool.query(
          "SELECT kind,count(*) FROM ingestion_operations GROUP BY kind ORDER BY kind",
        )
      ).rows,
    ).toEqual([
      { kind: "approve", count: "1" },
      { kind: "import", count: "1" },
    ]);
  });
  it("来源配置、调度频率、取消与无锁残留运行可恢复", async () => {
    await configureSource(db.pool, source, false, { requests: 5 });
    expect(await runner([]).scan({ sourceId: source.id, url })).toMatchObject({
      status: "disabled",
    });
    await expect(
      configureSource(db.pool, source, true, { requests: 201 }),
    ).rejects.toThrow("边界");
    await configureSource(db.pool, source, true, { requests: 80 });
    const stop = new AbortController();
    stop.abort();
    const canceled = await runner([]).scan(
      { sourceId: source.id, url },
      stop.signal,
    );
    expect(canceled.status).toBe("interrupted");
    expect(
      await runner([]).scan({ sourceId: source.id, url, trigger: "scheduled" }),
    ).toMatchObject({ status: "not-due" });
    await db.pool.query(
      "UPDATE ingestion_runs SET status='running',finished_at=NULL WHERE id=$1",
      [canceled.runId],
    );
    expect(await recoverInterruptedRuns(db.pool)).toEqual({ interrupted: 1 });
    expect(
      (
        await db.pool.query("SELECT status FROM ingestion_runs WHERE id=$1", [
          canceled.runId,
        ])
      ).rows[0].status,
    ).toBe("interrupted");
  });
  it("普通通知和报名者名单不进入候选，未保存正文或原始响应", async () => {
    const ordinary = informationList
      .replace("2026年测试竞赛报名通知", "普通学术新闻")
      .replace('<a href="tz/3.htm">下页</a>', "");
    expect(
      await runner([http(404), http(200, ordinary)]).scan({
        sourceId: source.id,
      }),
    ).toMatchObject({ status: "succeeded", counts: { ignored: 1 } });
    const sensitive = informationArticle.replace(
      "2026年测试竞赛报名通知",
      "程序设计竞赛报名人员名单",
    );
    expect(
      await runner([http(404), http(200, sensitive)]).scan({
        sourceId: source.id,
        url,
      }),
    ).toMatchObject({ status: "interrupted" });
    expect(
      (await db.pool.query("SELECT count(*) FROM ingestion_versions")).rows[0]
        .count,
    ).toBe("0");
  });
  it("已有草稿保持草稿，已发布更新经过显式预览和确认前保持原公开数据", async () => {
    await importBatch(db.pool, {
      competitions: [
        edition("draft", { publication: "draft" }),
        edition("public"),
      ],
    });
    const draft = await approved("draft");
    draft.batch.competitions![0].name = "新草稿标题";
    // 重新审核内容改变必须使用新导出操作ID。
    const freshDraft = correctedReview(
      await exportReview(db.pool, draft.candidateId, "draft"),
      { name: "新草稿标题" },
    );
    await approveReview(db.pool, freshDraft, "maintainer");
    await applyReview(db.pool, freshDraft, "maintainer");
    expect(
      (await formal()).competitions.find((c) => c.id === "draft"),
    ).toMatchObject({ name: "新草稿标题", publication: "draft" });
    const publicFile = correctedReview(
      await exportReview(db.pool, draft.candidateId, "public"),
      { name: "待审核新标题" },
    );
    await approveReview(db.pool, publicFile, "maintainer");
    await expect(
      applyReview(db.pool, publicFile, "maintainer", {
        confirmPublished: true,
      }),
    ).rejects.toThrow("preview");
    await applyReview(db.pool, publicFile, "maintainer", { preview: true });
    await expect(
      applyReview(db.pool, publicFile, "maintainer"),
    ).rejects.toThrow("confirm-published");
    expect(
      (await formal()).competitions.find((c) => c.id === "public")!.name,
    ).toBe("测试比赛 public");
    await applyReview(db.pool, publicFile, "maintainer", {
      confirmPublished: true,
    });
    expect(
      (await formal()).competitions.find((c) => c.id === "public"),
    ).toMatchObject({ name: "待审核新标题", publication: "published" });
  });
  it("来源修订、候选重开、正式关系修改及新建ID被占用拒绝旧文件", async () => {
    const file = await approved();
    await persist(informationArticle.replace("10月20日", "10月21日"));
    await expect(applyReview(db.pool, file, "maintainer")).rejects.toThrow(
      "过期",
    );
    const current = correctedReview(
      await exportReview(db.pool, file.candidateId),
    );
    await approveReview(db.pool, current, "maintainer");
    await setReviewState(
      db.pool,
      file.candidateId,
      "reject",
      "maintainer",
      "复核",
    );
    await setReviewState(
      db.pool,
      file.candidateId,
      "reopen",
      "maintainer",
      "重开",
    );
    await expect(
      approveReview(
        db.pool,
        { ...current, operationId: "11111111-1111-4111-8111-111111111111" },
        "maintainer",
      ),
    ).rejects.toThrow("过期");
    const fresh = correctedReview(
      await exportReview(db.pool, file.candidateId),
    );
    await importBatch(db.pool, {
      competitions: [edition(fresh.targetId, { publication: "draft" })],
    });
    await expect(approveReview(db.pool, fresh, "maintainer")).rejects.toThrow(
      "正式",
    );
    const occupied = correctedReview(
      await exportReview(db.pool, file.candidateId),
      { name: "修改" },
    );
    await approveReview(db.pool, occupied, "maintainer");
    await importBatch(db.pool, {
      competitions: [
        {
          id: occupied.targetId,
          stages: [{ id: occupied.targetId + "-stage", hosts: ["science"] }],
        },
      ],
    });
    await expect(applyReview(db.pool, occupied, "maintainer")).rejects.toThrow(
      "关系",
    );
  });
  it("同一操作改内容、只读证据篡改、直接发布或无人工核对均拒绝", async () => {
    const file = await approved();
    const altered = structuredClone(file);
    altered.batch.competitions![0].name = "新内容";
    await expect(approveReview(db.pool, altered, "maintainer")).rejects.toThrow(
      "内容已改变",
    );
    await expect(applyReview(db.pool, altered, "maintainer")).rejects.toThrow(
      "不能更改",
    );
    const evidence = correctedReview(
      await exportReview(db.pool, file.candidateId),
    );
    evidence.article.text = "伪造证据";
    await expect(
      approveReview(db.pool, evidence, "maintainer"),
    ).rejects.toThrow("证据");
    const metadata = correctedReview(
      await exportReview(db.pool, file.candidateId),
    );
    metadata.source.publisher = "伪造发布者";
    await expect(
      approveReview(db.pool, metadata, "maintainer"),
    ).rejects.toThrow("元数据");
    const publish = correctedReview(
      await exportReview(db.pool, file.candidateId),
    );
    publish.batch.competitions![0].publication = "published";
    await expect(approveReview(db.pool, publish, "maintainer")).rejects.toThrow(
      "独立命令",
    );
    const unchecked = correctedReview(
      await exportReview(db.pool, file.candidateId),
    );
    unchecked.checkedAt = null;
    await expect(
      approveReview(db.pool, unchecked, "maintainer"),
    ).rejects.toThrow("checkedAt");
  });
  it("应用中的数据库失败回滚正式写入、映射与操作，修复后可重试", async () => {
    const file = await approved();
    await db.pool.query(
      "ALTER TABLE ingestion_mappings ADD CONSTRAINT fail_mapping CHECK(false) NOT VALID",
    );
    await expect(applyReview(db.pool, file, "maintainer")).rejects.toThrow();
    expect((await formal()).competitions).toHaveLength(0);
    expect((await candidate()).status).toBe("approved");
    expect(
      (
        await db.pool.query(
          "SELECT count(*) FROM ingestion_operations WHERE kind='import'",
        )
      ).rows[0].count,
    ).toBe("0");
    await db.pool.query(
      "ALTER TABLE ingestion_mappings DROP CONSTRAINT fail_mapping",
    );
    await applyReview(db.pool, file, "maintainer");
    expect((await candidate()).status).toBe("imported");
  });
  it("跨连接来源/全局锁阻止重叠扫描，锁释放后继续", async () => {
    const other = await db.pool.connect();
    try {
      await other.query("SELECT pg_advisory_lock(23001,hashtext($1))", [
        source.id,
      ]);
      expect(await runner([]).scan({ sourceId: source.id, url })).toMatchObject(
        { status: "locked" },
      );
      await other.query("SELECT pg_advisory_unlock(23001,hashtext($1))", [
        source.id,
      ]);
      await other.query("SELECT pg_advisory_lock(23000)");
      expect(await runner([]).scan({ sourceId: source.id, url })).toMatchObject(
        { status: "locked" },
      );
      await other.query("SELECT pg_advisory_unlock(23000)");
    } finally {
      other.release();
    }
    expect(
      await runner([http(404), http(200, informationArticle)]).scan({
        sourceId: source.id,
        url,
      }),
    ).toMatchObject({ status: "succeeded", counts: { new: 1 } });
  });
  it("扫描预览不持久化，空列表作为失败，预算断点可续跑", async () => {
    expect(
      await runner([http(404), http(200, informationArticle)]).scan({
        sourceId: source.id,
        url,
        preview: true,
      }),
    ).toMatchObject({ status: "succeeded" });
    expect(
      (await db.pool.query("SELECT count(*) FROM ingestion_candidates")).rows[0]
        .count,
    ).toBe("0");
    expect(
      (await db.pool.query("SELECT count(*) FROM ingestion_runs")).rows[0]
        .count,
    ).toBe("0");
    const bad = await runner([http(404), http(200, "<html>改版</html>")]).scan({
      sourceId: source.id,
    });
    expect(bad.status).toBe("failed");
    await db.pool.query(
      "UPDATE ingestion_sources SET settings=$2 WHERE id=$1",
      [source.id, { ...defaultLimits, maxPages: 1, requests: 2 }],
    );
    const partial = await runner([
      http(404),
      http(200, informationList.replace('<a href="tz/3.htm">下页</a>', "")),
    ]).scan({ sourceId: source.id });
    expect(partial).toMatchObject({
      status: "partial",
      counts: { discovered: 1, failed: 0 },
    });
    await db.pool.query(
      "UPDATE ingestion_sources SET settings=$2 WHERE id=$1",
      [source.id, { ...defaultLimits, maxPages: 1 }],
    );
    const resumed = await runner([
      http(404),
      http(200, informationArticle),
    ]).scan({ sourceId: source.id, resume: partial.runId! });
    expect(resumed).toMatchObject({ status: "succeeded", counts: { new: 1 } });
  });
  it("官网失联/下架仅标记需核对，原正式比赛不隐藏、不删除", async () => {
    const file = await approved();
    await applyReview(db.pool, file, "maintainer");
    const baseline = await exportReview(db.pool, file.candidateId);
    await publishImported(
      db.pool,
      file.candidateId,
      "maintainer",
      baseline.baseline,
    );
    const lost = await runner([http(404), http(404)]).scan({
      sourceId: source.id,
      url,
    });
    expect(lost.status).toBe("partial");
    expect(
      (await db.pool.query("SELECT health FROM ingestion_notices")).rows[0]
        .health,
    ).toBe("needs-check");
    expect((await formal()).competitions[0].publication).toBe("published");
  });
  it("原始响应清理不移除已审核证据、版本和来源追溯", async () => {
    const file = await approved();
    await applyReview(db.pool, file, "maintainer");
    await db.pool.query(
      "UPDATE ingestion_versions SET fetched_at=now()-interval '31 days'",
    );
    expect(await cleanupResponses(db.pool, 30)).toEqual({ removed: 1 });
    const version = (await db.pool.query("SELECT * FROM ingestion_versions"))
      .rows[0];
    expect(version.raw_response).toBeNull();
    expect(version.article.text).toContain("报名截止");
    expect(version.extracted.evidence.length).toBeGreaterThan(0);
    expect(
      (await db.pool.query("SELECT count(*) FROM ingestion_mappings")).rows[0]
        .count,
    ).toBe("1");
  });
});
