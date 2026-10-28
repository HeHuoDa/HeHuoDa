import {
  BoundedFetcher,
  sources,
  type HttpResponse,
} from "@hehuoda/sicau-connectors/notices";
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
    process.env.INGESTION_ATTACHMENTS_ENABLED = "true";
  });
  afterAll(async () => {
    if (previous === undefined)
      delete process.env.INGESTION_ATTACHMENTS_ENABLED;
    else process.env.INGESTION_ATTACHMENTS_ENABLED = previous;
    await db?.close();
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
              body: round ? new Uint8Array() : Buffer.from(informationArticle),
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
