import { testDatabase } from "./competition-fixture.js";
import { IngestionRunner } from "../src/ingestion/runner.js";
import { initializeSources } from "../src/ingestion/store.js";
import { BoundedFetcher, sources } from "@hehuoda/sicau-connectors/notices";

const science = sources.find((source) => source.id === "science")!;
const artsMedia = sources.find((source) => source.id === "arts-media")!;

const body = (title: string) =>
  `<p>${title}</p><p>参赛对象：全校学生。</p><p>报名截止：2026年10月20日。</p>`;
// 首页在 /xwjtz/ 下用 ../info，历史页在 /xwjtz/tzgg/ 下用 ../../info，按页面深度区分。
const scienceRow = (
  id: number,
  title: string,
  date: string,
  prefix = "../info",
) =>
  `<li id="line_u8_${id}"><a href="${prefix}/1071/${id}.htm"><span class="fl">${title}</span><span class="fr orage">[${date}]</span></a></li>`;
const sciencePage = (rows: string, next?: string) =>
  `<ul>${rows}</ul><div class="pb_sys_common"><span class="p_pages">${next ? `<span class="p_next p_fun"><a href="${next}">下页</a></span>` : `<span class="p_next_d p_fun_d">下页</span>`}</span></div>`;
const scienceArticle = (title: string, date = "2026-09-22") =>
  `<p class="burl">${title}</p><p class="time">${date}</p><div class="wenzan" id="vsb_content"><div class="v_news_content">${body(title)}</div></div>`;
const artsRow = (id: number, title: string, date: string) =>
  `<li id="line_u5_${id}"><span>${date}</span><a href="../../info/1053/${id}.htm" title="${title}">${title}</a></li>`;
const artsPage = (rows: string) =>
  `<div id="newlist"><ul>${rows}</ul></div><div class="pb_sys_common"><span class="p_t">共310条</span><span class="p_pages"><span class="p_next_d p_fun_d">下页</span></span></div>`;
const artsArticle = (title: string) =>
  `<div id="mainContent"><div id="newscontent"><div id="newsconttitle"><h1>${title}</h1><p>2026-10-26 10:00:00 来源: </p></div><div id="newcontent"><div id="vsb_content"><div class="v_news_content">${body(title)}</div></div></div></div><div id="articeBottom"></div><ul style="list-style-type:none;"><li>附件【<a href="/system/_content/download.jsp?urltype=news.DownloadAttachUrl&owner=2">附件：报名表.xlsx</a>】</li></ul></div>`;
// 农学院列表把日期拆成「日」和「年-月」两块，用于验证 listDatePattern 驱动范围过滤。
const agriculture = sources.find((source) => source.id === "agriculture")!;
const agricultureRow = (
  id: number,
  title: string,
  day: string,
  yearMonth: string,
) =>
  `<li class="cleafix" id="line_u8_${id}"><a href="../info/1269/${id}.htm" title="${title}"><div class="list-data fl"><p class="day">${day}</p><p class="year">${yearMonth}</p></div><div class="list-box fr"><div class="list-boxfl"><h2>${title}</h2></div></div></a></li>`;
const agriculturePage = (rows: string) =>
  `<ul class="list cleafix">${rows}</ul><div class="pb_sys_common"><span class="p_pages"><span class="p_next_d p_fun_d">下页</span></span></div>`;
const agricultureArticle = (title: string, date: string) =>
  `<form name="_newscontent_fromname"><div class="con_nav"><h2>${title}</h2><div class="ly">时间:${date}</div><div id="vsb_content_7" class="hznr"><div class="v_news_content">${body(title)}</div></div></div></form>`;
// 管理学院列表只有「月-日 时:分」没有年份，正文日期才是发布日期。
const management = sources.find((source) => source.id === "management")!;
const managementRow = (id: number, title: string, date: string) =>
  `<li id="line_u6_${id}"><a href="../info/1076/${id}.htm"> <span class="leftDate">${date}</span> <span class="title" title="${title}">${title}</span> </a></li>`;
const managementPage = (rows: string) =>
  `<ul>${rows}</ul><div class="pb_sys_common"><span class="p_pages"><span class="p_next_d p_fun_d">下页</span></span></div>`;
const managementArticle = (title: string, date: string) =>
  `<form name="_newscontent_fromname"><div class="article_w on"><h1>${title}</h1><p>${date}</p><div id="vsb_content"><div class="v_news_content">${body(title)}</div></div></div></form>`;

describe("四院试点新来源的隔离库扫描", () => {
  let db: Awaited<ReturnType<typeof testDatabase>>;
  let clock: number;
  beforeAll(async () => {
    db = await testDatabase();
    await initializeSources(db.pool);
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    clock = Date.parse("2026-10-31T01:00:00Z");
    await db.pool.query("TRUNCATE ingestion_sources CASCADE");
    await initializeSources(db.pool);
    await db.pool.query(
      "UPDATE ingestion_sources SET enabled=true WHERE id = ANY($1)",
      [[science.id, artsMedia.id, agriculture.id]],
    );
    await db.pool.query(
      "UPDATE ingestion_channels SET enabled=true,verification_status='verified',activated_on='2026-10-31' WHERE source_id = ANY($1)",
      [[science.id, artsMedia.id, agriculture.id]],
    );
  });
  function scanner(pages: Record<string, string>, requests: string[]) {
    return new IngestionRunner(
      db.pool,
      (s, l) =>
        new BoundedFetcher(
          s,
          l,
          async (url) => {
            requests.push(url.toString());
            return {
              status: url.pathname === "/robots.txt" ? 404 : 200,
              headers: {},
              body: new TextEncoder().encode(
                url.pathname === "/robots.txt"
                  ? ""
                  : (pages[url.toString()] ?? ""),
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

  it("理学院首页与历史页去重后保留置顶旧通知，日期与正文入库", async () => {
    const pinned = "【置顶】2025年旧竞赛报名通知";
    const current = "2026年测试竞赛报名通知";
    const later = "2026年第二页竞赛报名通知";
    const pages = {
      [science.listUrl]: sciencePage(
        scienceRow(100, pinned, "2025年11月05日") +
          scienceRow(101, current, "2026年09月22日"),
        "tzgg/6.htm",
      ),
      "https://lixueyuan.sicau.edu.cn/xwjtz/tzgg/6.htm": sciencePage(
        scienceRow(100, pinned, "2025年11月05日", "../../info") +
          scienceRow(102, later, "2026年06月10日", "../../info"),
      ),
      "https://lixueyuan.sicau.edu.cn/info/1071/100.htm": scienceArticle(
        pinned,
        "2025-11-05",
      ),
      "https://lixueyuan.sicau.edu.cn/info/1071/101.htm":
        scienceArticle(current),
      "https://lixueyuan.sicau.edu.cn/info/1071/102.htm": scienceArticle(
        later,
        "2026-06-10",
      ),
    };
    const requests: string[] = [];
    const runner = scanner(pages, requests);
    expect(
      await runner.scan({ sourceId: science.id, phase: "fresh" }),
    ).toMatchObject({ status: "succeeded", counts: { new: 1 } });
    expect(
      await runner.scan({ sourceId: science.id, phase: "backfill" }),
    ).toMatchObject({ status: "succeeded" });
    const rows = (
      await db.pool.query<{ url: string; published: string | null }>(
        `SELECT n.url, v.article->>'publishedAt' AS published
           FROM ingestion_notices n
           JOIN ingestion_versions v ON v.id = n.latest_version
          WHERE n.source_id = $1
          ORDER BY n.url`,
        [science.id],
      )
    ).rows;
    expect(rows).toEqual([
      {
        url: "https://lixueyuan.sicau.edu.cn/info/1071/100.htm",
        published: "2025-11-05",
      },
      {
        url: "https://lixueyuan.sicau.edu.cn/info/1071/101.htm",
        published: "2026-09-22",
      },
      {
        url: "https://lixueyuan.sicau.edu.cn/info/1071/102.htm",
        published: "2026-06-10",
      },
    ]);
    const candidates = (
      await db.pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM ingestion_candidates",
      )
    ).rows[0].count;
    expect(candidates).toBe("3");
  });

  it("艺术与传媒学院列表标题取 title 属性，正文外附件不进入候选附件", async () => {
    const title = "艺传学院关于举办大学生职业规划大赛院内选拔赛的通知";
    const pages = {
      [artsMedia.listUrl]: artsPage(artsRow(100, title, "2026-10-26")),
      "https://yscm.sicau.edu.cn/info/1053/100.htm": artsArticle(title),
    };
    const requests: string[] = [];
    expect(
      await scanner(pages, requests).scan({
        sourceId: artsMedia.id,
        phase: "fresh",
      }),
    ).toMatchObject({ status: "succeeded", counts: { new: 1 } });
    expect(requests).toEqual([
      "https://yscm.sicau.edu.cn/robots.txt",
      artsMedia.listUrl,
      "https://yscm.sicau.edu.cn/info/1053/100.htm",
    ]);
    const row = (
      await db.pool.query<{ title: string; published: string | null }>(
        `SELECT v.article->>'title' AS title, v.article->>'publishedAt' AS published
           FROM ingestion_notices n
           JOIN ingestion_versions v ON v.id = n.latest_version
          WHERE n.source_id = $1`,
        [artsMedia.id],
      )
    ).rows[0];
    expect(row).toEqual({ title, published: "2026-10-26" });
  });
  it("农学院按「日 + 年-月」过滤范围，超期通知在 backfill 才入库", async () => {
    const recent = "2026年近期竞赛报名通知";
    const older = "2026年早期竞赛报名通知";
    const pages = {
      [agriculture.listUrl]: agriculturePage(
        agricultureRow(100, recent, "22", "2026-10") +
          agricultureRow(101, older, "22", "2026-03"),
      ),
      "https://nxy.sicau.edu.cn/info/1269/100.htm": agricultureArticle(
        recent,
        "2026-10-22",
      ),
      "https://nxy.sicau.edu.cn/info/1269/101.htm": agricultureArticle(
        older,
        "2026-03-22",
      ),
    };
    const runner = scanner(pages, []);
    expect(
      await runner.scan({ sourceId: agriculture.id, phase: "fresh" }),
    ).toMatchObject({ status: "succeeded" });
    const afterFresh = await db.pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM ingestion_notices WHERE source_id=$1",
      [agriculture.id],
    );
    expect(afterFresh.rows[0].count).toBe(1);
    expect(
      await runner.scan({ sourceId: agriculture.id, phase: "backfill" }),
    ).toMatchObject({ status: "succeeded" });
    const dates = await db.pool.query<{ published: string }>(
      `SELECT v.article->>'publishedAt' AS published
         FROM ingestion_notices n
         JOIN ingestion_versions v ON v.id = n.latest_version
        WHERE n.source_id = $1
        ORDER BY published`,
      [agriculture.id],
    );
    expect(dates.rows.map((row) => row.published)).toEqual([
      "2026-03-22",
      "2026-10-22",
    ]);
  });
  it("管理学院列表无年份日期不截断分页，范围以正文日期为准", async () => {
    const recent = "2026年近期竞赛报名通知";
    const older = "2026年早期竞赛报名通知";
    const pages = {
      [management.listUrl]: managementPage(
        managementRow(200, recent, "10-29 22:19") +
          managementRow(201, older, "03-22 10:00"),
      ),
      "https://glxy.sicau.edu.cn/info/1076/200.htm": managementArticle(
        recent,
        "2026年10月29日",
      ),
      "https://glxy.sicau.edu.cn/info/1076/201.htm": managementArticle(
        older,
        "2026年03月22日",
      ),
    };
    await db.pool.query(
      "UPDATE ingestion_sources SET enabled=true WHERE id=$1",
      [management.id],
    );
    await db.pool.query(
      "UPDATE ingestion_channels SET enabled=true,verification_status='verified',activated_on='2026-10-31' WHERE source_id=$1",
      [management.id],
    );
    const runner = scanner(pages, []);
    expect(
      await runner.scan({ sourceId: management.id, phase: "fresh" }),
    ).toMatchObject({ status: "succeeded" });
    const afterFresh = await db.pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM ingestion_notices WHERE source_id=$1",
      [management.id],
    );
    expect(afterFresh.rows[0].count).toBe(1);
    expect(
      await runner.scan({ sourceId: management.id, phase: "backfill" }),
    ).toMatchObject({ status: "succeeded" });
    const dates = await db.pool.query<{ published: string }>(
      `SELECT v.article->>'publishedAt' AS published
         FROM ingestion_notices n
         JOIN ingestion_versions v ON v.id = n.latest_version
        WHERE n.source_id = $1
        ORDER BY published`,
      [management.id],
    );
    expect(dates.rows.map((row) => row.published)).toEqual([
      "2026-03-22",
      "2026-10-29",
    ]);
  });
  it("名单类通知只跳过该条，后续竞赛通知照常入库", async () => {
    const first = "2026年测试竞赛报名通知";
    const sensitive = "2026年测试竞赛结果通知";
    const last = "2026年第二次测试竞赛报名通知";
    const sensitiveArticle = (title: string, date: string) =>
      `<p class="burl">${title}</p><p class="time">${date}</p><div class="wenzan" id="vsb_content"><div class="v_news_content"><p>${title}</p><p>参赛对象：全校学生。</p><p>现将参赛学生名单公示如下：张三、李四、王五。</p></div></div>`;
    const pages = {
      [science.listUrl]: sciencePage(
        scienceRow(300, first, "2026年10月20日") +
          scienceRow(301, sensitive, "2026年10月21日") +
          scienceRow(302, last, "2026年10月22日"),
      ),
      "https://lixueyuan.sicau.edu.cn/info/1071/300.htm": scienceArticle(
        first,
        "2026-10-20",
      ),
      "https://lixueyuan.sicau.edu.cn/info/1071/301.htm": sensitiveArticle(
        sensitive,
        "2026-10-21",
      ),
      "https://lixueyuan.sicau.edu.cn/info/1071/302.htm": scienceArticle(
        last,
        "2026-10-22",
      ),
    };
    const result = await scanner(pages, []).scan({
      sourceId: science.id,
      phase: "fresh",
    });
    expect(result).toMatchObject({
      status: "succeeded",
      counts: { ignored: 1, new: 2, failed: 0 },
    });
    expect(result.errors).toEqual([
      expect.objectContaining({
        url: "https://lixueyuan.sicau.edu.cn/info/1071/301.htm",
        code: "applicant-list",
        kind: "skipped",
      }),
    ]);
    const stored = await db.pool.query<{ url: string }>(
      "SELECT url FROM ingestion_notices WHERE source_id=$1 ORDER BY url",
      [science.id],
    );
    expect(stored.rows.map((row) => row.url)).toEqual([
      "https://lixueyuan.sicau.edu.cn/info/1071/300.htm",
      "https://lixueyuan.sicau.edu.cn/info/1071/302.htm",
    ]);
  });
});
