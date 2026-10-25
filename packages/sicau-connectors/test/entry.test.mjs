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

test("构建入口独立完成两院公开正文抓取与候选解析", async () => {
  for (const source of sources) {
    const body = "<p>参赛对象：全校学生。</p><p>报名截止：2026年10月20日。</p>";
    const html =
      source.id === "information-engineering"
        ? `<h1 class="page-title">2026年测试竞赛报名通知</h1><div class="news-body"><div id="vsb_content"><div class="v_news_content">${body}</div></div></div>`
        : `<h1 class="pageArticleTitle">2026年测试竞赛报名通知</h1><div id="vsb_content_4"><div class="v_news_content">${body}</div></div>`;
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
    assert.equal(candidate.fields.kind, "registration");
    assert.deepEqual(candidate.fields.deadline, {
      precision: "date",
      value: "2026-10-20",
    });
    assert.equal(candidate.fields.scope.kind, "all");
    assert.ok(candidate.evidence.some((entry) => entry.field === "deadline"));
  }
});
