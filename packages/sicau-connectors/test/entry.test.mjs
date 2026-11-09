import { TextEncoder } from "node:util";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SchoolAuthClient,
  SchoolAuthError,
} from "@hehuoda/sicau-connectors/auth";
import {
  BoundedFetcher,
  extractArticle,
  parseCandidate,
  sources,
} from "../dist/notices/index.js";

test("auth 自引用解析到构建 ESM，与 notices 共存且关闭后无需学校外联", async () => {
  assert.ok(
    import.meta
      .resolve("@hehuoda/sicau-connectors/auth")
      .endsWith("/dist/auth/index.js"),
  );
  const client = new SchoolAuthClient();
  client.dispose();
  await assert.rejects(
    client.createChallenge(),
    (error) => error instanceof SchoolAuthError && error.code === "disposed",
  );
});

test("构建入口独立完成已注册来源的公开正文抓取与候选解析", async () => {
  const body = "<p>参赛对象：全校学生。</p><p>报名截止：2026年10月20日。</p>";
  const pages = {
    economics: `<form name="_newscontent_fromname"><h1>2026年测试竞赛报名通知</h1><p>2026-10-20</p><div id="vsb_content"><div class="v_news_content">${body}</div></div></form>`,
    "information-engineering": `<h1 class="page-title">2026年测试竞赛报名通知</h1><div class="news-body"><div id="vsb_content"><div class="v_news_content">${body}</div></div></div>`,
    "life-sciences": `<h1 class="pageArticleTitle">2026年测试竞赛报名通知</h1><div id="vsb_content_4"><div class="v_news_content">${body}</div></div>`,
    science: `<p class="burl">2026年测试竞赛报名通知</p><p class="time">2026-09-22</p><div class="wenzan" id="vsb_content"><div class="v_news_content">${body}</div></div>`,
    "arts-media": `<div id="mainContent"><div id="newscontent"><div id="newsconttitle"><h1>2026年测试竞赛报名通知</h1><p>2026-10-26 10:00:00</p></div><div id="newcontent"><div id="vsb_content"><div class="v_news_content">${body}</div></div></div></div></div>`,
    agriculture: `<form name="_newscontent_fromname"><div class="con_nav"><h2>2026年测试竞赛报名通知</h2><div class="ly">时间:2026-01-04</div><div id="vsb_content_7" class="hznr"><div class="v_news_content">${body}</div></div></div></form>`,
    "animal-science": `<form name="_newscontent_fromname"><div class="tit">2026年测试竞赛报名通知</div><div class="infor">发布日期：2026年10月22日</div><div id="vsb_content_4"><div class="v_news_content">${body}</div></div></form>`,
    "veterinary-medicine": `<div class="news_title"><div class="title">2026年测试竞赛报名通知</div></div><div id="vsb_content"><div class="v_news_content">${body}</div></div>`,
    "grassland-science": `<div class="articles_header"><div class="articles_title">2026年测试竞赛报名通知</div><div class="articles_detail">2026年10月09日 11:31</div></div><div id="vsb_content_7"><div class="v_news_content">${body}</div></div>`,
    fisheries: `<div class="art-tit"><h3>2026年测试竞赛报名通知</h3><p>发布时间：2026-10-22</p></div><div id="vsb_content_7"><div class="v_news_content">${body}</div></div>`,
    forestry: `<form name="_newscontent_fromname"><span class="title">2026年测试竞赛报名通知</span><div class="source">发布日期：2026-10-22</div><div id="vsb_content_6"><div class="v_news_content">${body}</div></div></form>`,
    horticulture: `<form name="_newscontent_fromname"><div class="content"><h3>2026年测试竞赛报名通知</h3><span class="pr">发布日期：2026-10-21</span><div id="vsb_content_2" class="content"><div class="v_news_content">${body}</div></div></div></form>`,
    "landscape-architecture": `<h1 class="page_box_news_title">2026年测试竞赛报名通知</h1><h2>时间：2026-10-21</h2><div id="vsb_content"><div class="v_news_content">${body}</div></div>`,
    resources: `<form name="_newscontent_fromname"><div><h1>2026年测试竞赛报名通知</h1><div align="center">2026年10月16日</div><div id="vsb_content"><div class="v_news_content">${body}</div></div></div></form>`,
    environment: `<h1 class="page_box_news_title">2026年测试竞赛报名通知</h1><h2>时间：2026-09-20</h2><div id="vsb_content"><div class="v_news_content">${body}</div></div>`,
    management: `<form name="_newscontent_fromname"><div class="article_w on"><h1>2026年测试竞赛报名通知</h1><p>2026年10月18日</p><div id="vsb_content"><div class="v_news_content">${body}</div></div></div></form>`,
    "agricultural-engineering": `<header class="article-head"><h1>2026年测试竞赛报名通知</h1><div class="meta"><span>发布时间：2026-10-30</span></div></header><div id="vsb_content_6"><div class="v_news_content">${body}</div></div>`,
    "food-science": `<div class="article"><h2 class="tit">2026年测试竞赛报名通知</h2><p class="conttime"><span>发布时间：2026-10-29</span></p><div id="vsb_content_7"><div class="v_news_content">${body}</div></div></div>`,
    "mechanical-electrical": `<header class="jdxy-article-head"><h1>2026年测试竞赛报名通知</h1><div class="jdxy-article-meta"><span>发布时间：2026-10-21</span></div></header><div id="vsb_content_7"><div class="v_news_content">${body}</div></div>`,
    "water-conservancy": `<div class="article-header"><h1 class="article-title">2026年测试竞赛报名通知</h1><div class="article-meta">发布时间：2026年10月20日</div></div><div id="vsb_content"><div class="v_news_content">${body}</div></div>`,
    humanities: `<form name="_newscontent_fromname"><div class="article-title"><p2>2026年测试竞赛报名通知</p2><div class="borde"><p3>发布于:2026年10月22日</p3></div></div><div class="article-words" id="vsb_content"><div class="v_news_content">${body}</div></div></form>`,
    "public-administration": `<div id="newsconttitle"><h1>2026年测试竞赛报名通知</h1><p>2026-10-29</p></div><div id="vsb_content"><div class="v_news_content">${body}</div></div>`,
    // 批次四：正文模板取自实站，发布日期用早于报名截止的日期，避免样例本身触发时间冲突。
    law: `<form name="_newscontent_fromname"><h3>2026年测试竞赛报名通知</h3><p class="abstitle"><i>2026年10月12日 08:26</i></p><div id="vsb_content_503"><div class="v_news_content">${body}</div></div></form>`,
    sports: `<form name="_newscontent_fromname"><div class="container-main"><h1>2026年测试竞赛报名通知</h1><div class="article-info"><div class="article-info-item">发布于：2026-10-14 08:52:14</div></div><div id="vsb_content_4"><div class="v_news_content">${body}</div></div></div></form>`,
    "architecture-planning": `<form name="_newscontent_fromname"><div class="art-tit cont-tit d"><h3>2026年测试竞赛报名通知</h3><p><span>时间：2026-10-12</span></p></div><div id="vsb_content"><div class="v_news_content">${body}</div></div></form>`,
    "civil-engineering": `<form name="_newscontent_fromname"><h1>2026年测试竞赛报名通知</h1><div class="prompt"><div class="d_r">发布时间：2026年10月12日 11:16</div></div><div id="vsb_content_501"><div class="v_news_content">${body}</div></div></form>`,
    "business-tourism": `<form name="_newscontent_fromname"><div id="newsconttitle"><h1>2026年测试竞赛报名通知</h1><p>2026-10-12</p></div><div id="vsb_content"><div class="v_news_content">${body}</div></div></form>`,
  };
  for (const source of sources) {
    const html = pages[source.id];
    assert.ok(html, `来源 ${source.id} 缺少离线正文样例`);
    const fetcher = new BoundedFetcher(
      source,
      undefined,
      async (url) => ({
        status: url.pathname === "/robots.txt" ? 404 : 200,
        headers: {},
        body: new TextEncoder().encode(html),
      }),
      () => 0,
      async () => {},
    );
    await fetcher.checkRobots();
    const response = await fetcher.get(source.listUrl);
    const article = extractArticle(response.html, response.url, source);
    const candidate = parseCandidate(article, response.url, []);
    // 通知种类不再写入候选字段；本用例断言契约标记与赛事名剥离结果。
    // 年份属于赛事区分信息，必须保留；只剥离「关于/举办/的通知」这类套语。
    assert.equal(candidate.fieldsContract, "candidate-fields-v2");
    assert.equal(candidate.fields.kind, undefined);
    assert.equal(candidate.fields.name, "2026年测试竞赛");
    assert.deepEqual(candidate.fields.deadline, {
      precision: "date",
      value: "2026-10-20",
    });
    assert.equal(candidate.fields.scope.kind, "all");
    assert.ok(candidate.evidence.some((entry) => entry.field === "deadline"));
  }
});
