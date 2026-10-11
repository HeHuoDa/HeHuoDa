import { testDatabase } from "./competition-fixture.js";
import { IngestionRunner } from "../src/ingestion/runner.js";
import { BoundedFetcher } from "../src/ingestion/http.js";
import { sources } from "../src/ingestion/sources.js";
import {
  initializeSources,
  configureSource,
  persistArticle,
} from "../src/ingestion/store.js";
import { informationArticle } from "../src/ingestion/fixtures.js";
import { extractArticle } from "../src/ingestion/html.js";
import { parseCandidate } from "../src/ingestion/parse.js";

const source = sources[0];
const url = (id: number) => `https://${source.host}/info/1043/${id}.htm`;
const listing = (ids: number[], next = "") =>
  ids
    .map(
      (id) =>
        `<div id="line_u_${id}"><h1 class="content-page-title"><a rel="bookmark" href="${url(id)}">2026年测试竞赛${id}</a></h1><span class="spanTime">2026-10-08</span></div>`,
    )
    .join("") +
  `<div class="p_pages">${next ? `<a href="${next}">下页</a>` : ""}</div>`;

describe("采集增量与自动恢复", () => {
  let db: Awaited<ReturnType<typeof testDatabase>>;
  beforeAll(async () => {
    db = await testDatabase();
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await db.pool.query("TRUNCATE ingestion_sources CASCADE");
    await initializeSources(db.pool);
  });
  async function seed(id: number) {
    const article = extractArticle(informationArticle, url(id), source);
    return persistArticle(
      db.pool,
      source,
      url(id),
      {
        status: 200,
        headers: {},
        body: new TextEncoder().encode(informationArticle),
        html: informationArticle,
        url: url(id),
      },
      article,
      parseCandidate(article, url(id), []),
    );
  }
  function scanner(pages: Record<string, string>, requests: string[]) {
    let clock = 0;
    return new IngestionRunner(
      db.pool,
      (s, l) =>
        new BoundedFetcher(
          s,
          l,
          async (u) => {
            requests.push(u.toString());
            return {
              status: u.pathname === "/robots.txt" ? 404 : 200,
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
    );
  }
  const due = () =>
    db.pool.query("UPDATE ingestion_sources SET last_started_at=NULL");
  it("默认80请求预算下78条旧通知不能挤掉首页新通知", async () => {
    const ids = Array.from({ length: 78 }, (_, i) => 200 + i);
    for (const id of ids) await seed(id);
    const requests: string[] = [];
    const result = await scanner(
      { [source.listUrl]: listing([100, ...ids]) },
      requests,
    ).scan({ sourceId: source.id, trigger: "scheduled" });
    expect(result).toMatchObject({ counts: { new: 1 } });
    expect(requests).toContain(url(100));
    expect(requests.length).toBeLessThanOrEqual(80);
  });
  it("已知通知复查遵守日期上界", async () => {
    await seed(200);
    const requests: string[] = [];
    await scanner({ [source.listUrl]: listing([100]) }, requests).scan({
      sourceId: source.id,
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(requests).not.toContain(url(200));
  });
  it("只有普通文章时翻页预算耗尽仍为partial，不推进失败页", async () => {
    await configureSource(db.pool, source, true, { requests: 2 });
    const next = `https://${source.host}/xygl/tz/1.htm`;
    const html = listing([100], next).replace(
      "2026年测试竞赛100",
      "普通学术新闻",
    );
    expect(
      await scanner({ [source.listUrl]: html }, []).scan({
        sourceId: source.id,
      }),
    ).toMatchObject({ status: "partial", cursor: { pages: [next] } });
  });
  it("单次请求时robots后预算耗尽可恢复，不被当作官网失败", async () => {
    await configureSource(db.pool, source, true, { requests: 1 });
    expect(
      await scanner({}, []).scan({ sourceId: source.id, url: url(100) }),
    ).toMatchObject({
      status: "partial",
      cursor: { pending: [expect.objectContaining({ url: url(100) })] },
    });
  });
  it("手动历史续跑保持原范围，已被续跑的父记录不重复执行", async () => {
    await configureSource(db.pool, source, true, { requests: 2, maxPages: 1 });
    const first = await scanner({ [source.listUrl]: listing([100]) }, []).scan({
      sourceId: source.id,
      from: "2026-10-01",
      to: "2026-10-09",
    });
    if (!("runId" in first) || !first.runId) throw new Error("缺少运行记录");
    await configureSource(db.pool, source, true, { requests: 80 });
    expect(
      await scanner({}, []).scan({
        sourceId: source.id,
        resume: first.runId,
        from: "2026-09-01",
        to: "2026-09-02",
      }),
    ).toMatchObject({ status: "succeeded", counts: { new: 1 } });
    expect(
      await scanner({}, []).scan({ sourceId: source.id, resume: first.runId }),
    ).toMatchObject({
      status: "failed",
      errors: [
        expect.objectContaining({
          message: expect.stringContaining("已被续跑"),
        }),
      ],
    });
  });
  it("列表预算耗尽为partial并保留下一页和未处理通知", async () => {
    await configureSource(db.pool, source, true, { requests: 2 });
    const requests: string[] = [];
    const next = `https://${source.host}/xygl/tz/1.htm`;
    expect(
      await scanner({ [source.listUrl]: listing([100], next) }, requests).scan({
        sourceId: source.id,
      }),
    ).toMatchObject({
      status: "partial",
      cursor: {
        pages: [next],
        pending: [expect.objectContaining({ url: url(100) })],
      },
    });
  });
  it("小预算下定时扫描交替续跑与首页发现且不重新拾取已续跑的父游标", async () => {
    await configureSource(db.pool, source, true, { requests: 3, maxPages: 1 });
    const first = await scanner(
      { [source.listUrl]: listing([100, 101]) },
      [],
    ).scan({ sourceId: source.id, trigger: "scheduled" });
    expect(first).toMatchObject({ status: "partial", counts: { new: 1 } });
    await due();
    const secondRequests: string[] = [];
    expect(
      await scanner({}, secondRequests).scan({
        sourceId: source.id,
        trigger: "scheduled",
      }),
    ).toMatchObject({ status: "succeeded", counts: { new: 1 } });
    expect(secondRequests).toContain(url(101));
    expect(secondRequests).not.toContain(source.listUrl);
    await due();
    const thirdRequests: string[] = [];
    expect(
      await scanner(
        { [source.listUrl]: listing([102, 100, 101]) },
        thirdRequests,
      ).scan({ sourceId: source.id, trigger: "scheduled" }),
    ).toMatchObject({ counts: { new: 1 } });
    expect(thirdRequests).toContain(source.listUrl);
    expect(thirdRequests).toContain(url(102));
  });
  it("maxPages=1的定时扫描仍能推进第二页，同时下一轮检查首页", async () => {
    await configureSource(db.pool, source, true, { maxPages: 1 });
    const next = `https://${source.host}/xygl/tz/1.htm`;
    expect(
      await scanner({ [source.listUrl]: listing([100], next) }, []).scan({
        sourceId: source.id,
        trigger: "scheduled",
      }),
    ).toMatchObject({ status: "partial" });
    await due();
    const resumedRequests: string[] = [];
    expect(
      await scanner({ [next]: listing([101]) }, resumedRequests).scan({
        sourceId: source.id,
        trigger: "scheduled",
      }),
    ).toMatchObject({ status: "succeeded", counts: { new: 1 } });
    expect(resumedRequests).toContain(next);
    await due();
    const freshRequests: string[] = [];
    await scanner({ [source.listUrl]: listing([102]) }, freshRequests).scan({
      sourceId: source.id,
      trigger: "scheduled",
    });
    expect(freshRequests).toContain(url(102));
  });
});
