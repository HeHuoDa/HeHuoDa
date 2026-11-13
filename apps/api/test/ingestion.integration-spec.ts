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
  sources,
  extractArticle,
  parseCandidate,
  noticeRuleVersion,
} from "@hehuoda/sicau-connectors/notices";

import {
  informationArticle,
  informationList,
  noticeBody,
} from "./notice-fixtures.js";

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
    await persist(
      informationArticle.replace("10月20日", "10月21日"),
      `${source.version}-test-upgrade`,
    );
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
  it("HTML304仍用已有快照升级规则，旧迁移候选的批准基线失效", async () => {
    const file = await approved();
    await db.pool.query(
      "UPDATE ingestion_candidates SET rule_version='legacy',extraction_key=NULL WHERE id=$1",
      [file.candidateId],
    );
    expect(
      await runner([http(404), http(304)]).scan({ sourceId: source.id, url }),
    ).toMatchObject({ status: "succeeded", counts: { unchanged: 1 } });
    expect(await candidate()).toMatchObject({
      rule_version: noticeRuleVersion,
      status: "pending",
      revision: file.candidateRevision + 1,
    });
    await expect(
      approveReview(
        db.pool,
        { ...file, operationId: "17600000-0000-4000-8000-000000000001" },
        "maintainer",
      ),
    ).rejects.toThrow(/过期|变化/);
  });
  it.each(["list", "article"])(
    "%s 命中新名单规则时撤销已有旧版批准，不再抓取或保存名单正文",
    async (boundary) => {
      const title = "土木工程学院关于2027届毕业本科生一次性求职补贴人员的公示";
      const html = informationArticle.replace("2026年测试竞赛报名通知", title);
      const file = await approved();
      // 模拟 v2 已保存的旧快照；当前持久化入口已禁止新增这类名单。
      await db.pool.query(
        "UPDATE ingestion_versions SET article=jsonb_set(article,'{title}',to_jsonb($1::text)) WHERE id=$2",
        [title, file.sourceVersion],
      );
      await db.pool.query(
        "UPDATE ingestion_candidates SET rule_version='competition-rules-2',extraction_key=NULL WHERE id=$1",
        [file.candidateId],
      );
      await runner([http(404), http(200, html)]).scan({
        sourceId: source.id,
        url,
        preview: true,
      });
      expect(await candidate()).toMatchObject({
        status: "approved",
        rule_version: "competition-rules-2",
        revision: file.candidateRevision,
      });
      const responses =
        boundary === "list"
          ? [
              http(404),
              http(
                200,
                informationList
                  .replace("2026年测试竞赛报名通知", title)
                  .replace(/<a href="tz\/3.htm">下页<\/a>/, ""),
              ),
            ]
          : [http(404), http(200, html)];
      expect(
        await runner(responses).scan({
          sourceId: source.id,
          ...(boundary === "article" ? { url } : {}),
        }),
      ).toMatchObject({
        status: "succeeded",
        counts: { ignored: 1, failed: 0 },
      });
      expect(responses).toHaveLength(0);
      expect(await candidate()).toMatchObject({
        rule_version: noticeRuleVersion,
        status: "pending",
        approved_file: null,
        revision: file.candidateRevision + 1,
        classification: "non_competition",
      });
      await expect(applyReview(db.pool, file, "maintainer")).rejects.toThrow(
        /过期|变化|审核/,
      );
      expect((await formal()).competitions).toHaveLength(0);
      expect(
        (await db.pool.query("SELECT count(*) FROM ingestion_versions")).rows[0]
          .count,
      ).toBe("1");
    },
  );
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
  it("普通通知仅留最小分类记录，报名者名单不保存正文或原始响应", async () => {
    const ordinary = informationList
      .replace("2026年测试竞赛报名通知", "普通学术新闻")
      .replace('<a href="tz/3.htm">下页</a>', "");
    expect(
      await runner([
        http(404),
        http(200, ordinary),
        http(
          200,
          informationArticle
            .replaceAll("2026年测试竞赛报名通知", "普通学术新闻")
            .replace(
              noticeBody,
              "<p>本周办公时间安排，请各单位按通知办理相关手续。</p>",
            ),
        ),
      ]).scan({
        sourceId: source.id,
      }),
    ).toMatchObject({ status: "succeeded", counts: { new: 1 } });
    expect((await candidate()).classification).toBe("non_competition");
    const minimal = (
      await db.pool.query("SELECT article,raw_response FROM ingestion_versions")
    ).rows[0];
    expect(minimal.article.text).toBe("");
    expect(minimal.raw_response.length).toBe(0);
    const sensitive = informationArticle.replace(
      "2026年测试竞赛报名通知",
      "程序设计竞赛报名人员名单",
    );
    expect(
      await runner([http(404), http(200, sensitive)]).scan({
        sourceId: source.id,
        url,
      }),
    ).toMatchObject({
      status: "succeeded",
      counts: { ignored: 1, new: 0 },
      errors: [
        expect.objectContaining({ code: "applicant-list", kind: "skipped" }),
      ],
    });
    expect(
      (await db.pool.query("SELECT count(*) FROM ingestion_versions")).rows[0]
        .count,
    ).toBe("1");
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
  it("报名说明要求报送名单表时，实际采集与保存入口都不再跳过或拒绝", async () => {
    // 分类器已判 definite，但 runner 与 persistArticle 曾各自用全文名单判据拦截，
    // 导致真实报名通知在进入修复入口前就被丢弃。这里走真实采集与保存链。
    const signupBody = `<p>报名截止2026年11月20日。</p><p>参赛同学须向班长报送参赛名单汇总表。</p>`;
    const signupHtml = informationArticle.replace(noticeBody, signupBody);
    expect(
      await runner([http(404), http(200, signupHtml)]).scan({
        sourceId: source.id,
        url,
      }),
    ).toMatchObject({
      status: "succeeded",
      counts: { new: 1, ignored: 0, failed: 0 },
    });
    const stored = await candidate();
    expect(stored).toMatchObject({
      classification: "definite",
      status: "pending",
    });
    // 正文真实保存：报名通知不再因名单表而留成空正文。
    const version = (
      await db.pool.query(
        "SELECT article,extracted FROM ingestion_versions ORDER BY revision DESC",
      )
    ).rows[0];
    expect(version.article.text).toContain("报送参赛名单汇总表");
    expect(version.extracted.classification.exclusions).not.toContainEqual(
      "applicant-list",
    );
  });
  it("非赛事通知在实际采集与保存链路都不生成比赛名称与届次", async () => {
    // 证据入口早已返回空比赛字段，但 runner 调 parseCandidate、store 裁剪正文后
    // 再次调它，两条实际路径仍会把标题当年比赛名称、把年份当届次。
    // 正文须满足最小长度，否则会先按空正文拒绝，测不到分类分支。
    const adminBody = `<p>请符合条件的同学于2026年11月20日前提交申请材料，学院统一汇总后报学生处。</p>`;
    const adminTitle = "2026年优秀毕业生推荐通知";
    const adminHtml = informationArticle
      .replace("2026年测试竞赛报名通知", adminTitle)
      .replace(noticeBody, adminBody);
    expect(
      await runner([http(404), http(200, adminHtml)]).scan({
        sourceId: source.id,
        url,
      }),
    ).toMatchObject({ status: "succeeded", counts: { new: 1, failed: 0 } });
    const stored = await candidate();
    expect(stored).toMatchObject({ classification: "non_competition" });
    expect(stored.data.fields.name).toBe("");
    expect(stored.data.fields.edition).toBeNull();
    expect(stored.data.fields.scope).toMatchObject({
      kind: "unknown",
      colleges: [],
    });
    // 通知元数据保留：标题与发布日期仍在来源版本里，不被清空掩盖问题。
    const version = (
      await db.pool.query("SELECT article FROM ingestion_versions")
    ).rows[0];
    expect(version.article.title).toBe(adminTitle);
    expect(version.article.publishedAt).toBe("2026-10-08");
    // 正文按现行规则裁剪，原始响应不落库。
    expect(version.article.text).toBe("");
    // 预览路径与保存路径一致。
    await db.pool.query("TRUNCATE ingestion_sources CASCADE");
    await initializeSources(db.pool);
    const preview = await runner([http(404), http(200, adminHtml)]).scan({
      sourceId: source.id,
      url,
      preview: true,
    });
    expect(preview).toMatchObject({ status: "succeeded" });
    // scan 的 previews 是 unknown[]（不导出内部预览类型）；这里按 HTTP 呈现形状读取。
    const previews = preview.previews as
      | { candidate: { fieldsV2?: { name: string; edition: string | null } } }[]
      | undefined;
    expect(previews?.[0]?.candidate.fieldsV2?.name).toBe("");
    expect(previews?.[0]?.candidate.fieldsV2?.edition).toBeNull();
  });
  it("正文真实发布名单时实际入口仍不保存正文、附件字节与原始响应", async () => {
    const listBody = `<p>现将参赛名单公布如下：张三、李四、王五。</p>`;
    const listHtml = informationArticle.replace(noticeBody, listBody);
    expect(
      await runner([http(404), http(200, listHtml)]).scan({
        sourceId: source.id,
        url,
      }),
    ).toMatchObject({
      status: "succeeded",
      counts: { ignored: 1, new: 0, failed: 0 },
      errors: [
        expect.objectContaining({ code: "applicant-list", kind: "skipped" }),
      ],
    });
    expect(
      (await db.pool.query("SELECT count(*) FROM ingestion_versions")).rows[0]
        .count,
    ).toBe("0");
    // 直接调用持久化入口同样必须拒绝，不能只靠 runner 的前置校验。
    const article = extractArticle(listHtml, url, source);
    await expect(
      persistArticle(
        db.pool,
        source,
        url,
        { ...http(200, listHtml), url, html: listHtml },
        article,
        parseCandidate(article, url, directory!),
      ),
    ).rejects.toThrow("个人名单");
    expect(
      (await db.pool.query("SELECT count(*) FROM ingestion_versions")).rows[0]
        .count,
    ).toBe("0");
  });
});
