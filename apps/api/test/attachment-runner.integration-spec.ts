import {
  BoundedFetcher,
  sources,
  type HttpResponse,
  extractArticle,
  parseCandidate,
} from "@hehuoda/sicau-connectors/notices";
import { persistArticle, initializeSources } from "../src/ingestion/store.js";
import { checkNoticeAttachments } from "../src/ingestion/attachment-runner.js";
import { testDatabase } from "./competition-fixture.js";
import { informationArticle } from "./notice-fixtures.js";
import { IngestionRunner } from "../src/ingestion/runner.js";
import { exportReview } from "../src/ingestion/review.js";
import {
  listAttachments,
  listAttachmentVersions,
} from "../src/ingestion/attachment-store.js";

describe("HTML 未变时的附件复查", () => {
  let db: Awaited<ReturnType<typeof testDatabase>>;
  const previous = process.env.INGESTION_ATTACHMENTS_ENABLED;
  beforeAll(async () => {
    db = await testDatabase();
    await initializeSources(db.pool);
    process.env.INGESTION_ATTACHMENTS_ENABLED = "true";
  });
  afterAll(async () => {
    if (previous === undefined)
      delete process.env.INGESTION_ATTACHMENTS_ENABLED;
    else process.env.INGESTION_ATTACHMENTS_ENABLED = previous;
    await db?.close();
  });
  it("重复规范URL的任一标题指向名单时禁止下载", async () => {
    const source = sources[0],
      url = `https://${source.host}/info/1043/345.htm`,
      fileUrl = `https://${source.host}/system/_content/download.jsp?id=7`;
    const article = extractArticle(informationArticle, url, source);
    article.attachments = [
      { url: fileUrl + "&utm_source=first", title: "报名名单.xlsx" },
      { url: fileUrl, title: "竞赛规则附件.pdf" },
    ];
    const saved = await persistArticle(
      db.pool,
      source,
      url,
      {
        status: 200,
        headers: {},
        body: Buffer.from(informationArticle),
        url,
        html: informationArticle,
      },
      article,
      parseCandidate(article, url, []),
    );
    let downloads = 0,
      time = 0;
    const fetcher = new BoundedFetcher(
      source,
      undefined,
      async (target) => {
        if (target.pathname !== "/robots.txt") downloads++;
        return {
          status: target.pathname === "/robots.txt" ? 404 : 200,
          headers: { "content-type": "application/pdf" },
          body: Buffer.from("%PDF-test"),
        };
      },
      () => time,
      async (ms) => {
        time += ms;
      },
    );
    await fetcher.checkRobots();
    await checkNoticeAttachments(
      db.pool,
      fetcher,
      saved.noticeId,
      async (_bytes, mediaType) => ({
        mediaType,
        extractorVersion: "test/1",
        status: "extracted",
        segments: [{ kind: "page", index: 1, text: "规则" }],
      }),
    );
    expect(downloads).toBe(0);
    expect((await listAttachments(db.pool, saved.noticeId))[0].state).toBe(
      "blocked",
    );
  });
  it("304仍获取附件同URL的新字节，保留旧版本并递增审核基线", async () => {
    const source = sources[0];
    const noticeUrl = `https://${source.host}/info/1043/100.htm`;
    let round = 0,
      time = 0;
    const requests: string[] = [];
    const runner = new IngestionRunner(
      db.pool,
      (s, l) =>
        new BoundedFetcher(
          s,
          l,
          async (url): Promise<HttpResponse> => {
            requests.push(url.pathname);
            if (url.pathname === "/robots.txt")
              return { status: 404, headers: {}, body: new Uint8Array() };
            if (url.pathname.endsWith("download.jsp"))
              return {
                status: 200,
                headers: { "content-type": "application/pdf" },
                body: Buffer.from(`%PDF-1.7\nfixture-${round}`),
              };
            return {
              status: round ? 304 : 200,
              headers: { etag: "same-html" },
              body: round
                ? new Uint8Array()
                : Buffer.from(
                    informationArticle.replace(
                      "owner=1",
                      "owner=1&utm_source=test",
                    ),
                  ),
            };
          },
          () => time,
          async (ms) => {
            time += ms;
          },
        ),
      () => new Date("2026-10-28T10:00:00Z"),
      async (_bytes, mediaType) => ({
        mediaType,
        extractorVersion: "test-process/1",
        status: "extracted",
        segments: [
          { kind: "page", index: 1, text: round ? "规则二" : "规则一" },
        ],
      }),
    );
    await runner.scan({ sourceId: source.id, url: noticeUrl });
    const notice = (
      await db.pool.query("SELECT id FROM ingestion_notices WHERE url=$1", [
        noticeUrl,
      ])
    ).rows[0];
    const attachment = (await listAttachments(db.pool, notice.id))[0];
    expect(await listAttachments(db.pool, notice.id)).toHaveLength(1);
    const candidate = (
      await db.pool.query(
        "SELECT id FROM ingestion_candidates WHERE notice_id=$1",
        [notice.id],
      )
    ).rows[0];
    const oldReview = await exportReview(db.pool, candidate.id);
    round++;
    await runner.scan({ sourceId: source.id, url: noticeUrl });
    const review = await exportReview(db.pool, candidate.id);
    expect(review.sourceVersion).toBe(oldReview.sourceVersion);
    expect(review.candidateRevision).toBeGreaterThan(
      oldReview.candidateRevision,
    );
    expect(await listAttachmentVersions(db.pool, attachment.id)).toHaveLength(
      2,
    );
    expect(
      requests.filter((path) => path.endsWith("download.jsp")),
    ).toHaveLength(2);
  });
});
