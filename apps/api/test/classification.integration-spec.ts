import { testDatabase, directory } from "./competition-fixture.js";
import {
  initializeSources,
  persistArticle,
  transaction,
} from "../src/ingestion/store.js";
import { refreshExtraction } from "../src/ingestion/extraction-store.js";
import {
  parseCandidate,
  sources,
  type Article,
} from "@hehuoda/sicau-connectors/notices";
import { importBatch } from "../src/competitions/import.js";
import { approveReview, exportReview } from "../src/ingestion/review.js";
import { correctedReview } from "./ingestion-fixture.js";
import {
  persistAttachment,
  markAttachmentNeedsReview,
} from "../src/ingestion/attachment-store.js";

describe("分类提取修订使用已有快照", () => {
  let db: Awaited<ReturnType<typeof testDatabase>>;
  beforeAll(async () => {
    db = await testDatabase();
    await initializeSources(db.pool);
    await importBatch(db.pool, { colleges: directory });
  });
  afterAll(async () => {
    await db?.close();
  });
  it("同一规则重跑幂等，换规则保留旧提取和人工材料", async () => {
    const url = `https://${sources[0].host}/info/1043/176.htm`;
    const article: Article = {
      title: "2026年数学竞赛报名通知",
      publishedAt: null,
      text: "报名截止：2026年11月1日。",
      paragraphs: ["报名截止：2026年11月1日。"],
      attachments: [],
    };
    const saved = await persistArticle(
      db.pool,
      sources[0],
      url,
      { url, html: "", body: new Uint8Array(), status: 200, headers: {} },
      article,
      parseCandidate(article, url, directory!),
    );
    const first = (
      await db.pool.query(
        "SELECT revision FROM ingestion_candidates WHERE id=$1",
        [saved.candidateId],
      )
    ).rows[0];
    await transaction(db.pool, (c) => refreshExtraction(c, saved.noticeId));
    expect(
      (
        await db.pool.query(
          "SELECT revision FROM ingestion_candidates WHERE id=$1",
          [saved.candidateId],
        )
      ).rows[0],
    ).toEqual(first);
    const review = correctedReview(
      await exportReview(db.pool, saved.candidateId!),
    );
    await approveReview(db.pool, review, "maintainer");
    await transaction(db.pool, (c) =>
      refreshExtraction(c, saved.noticeId, "competition-rules-test-2"),
    );
    const revisions = (
      await db.pool.query(
        "SELECT rule_version,data FROM ingestion_extraction_revisions WHERE candidate_id=$1 ORDER BY created_at,id",
        [saved.candidateId],
      )
    ).rows;
    expect(revisions.map((r) => r.rule_version)).toEqual([
      "competition-rules-1",
      "competition-rules-test-2",
    ]);
    expect(revisions[0].data.fields.deadline.value).toBe("2026-11-01");
    expect(
      (
        await db.pool.query(
          "SELECT status,approved_file FROM ingestion_candidates WHERE id=$1",
          [saved.candidateId],
        )
      ).rows[0],
    ).toEqual({ status: "pending", approved_file: null });
    expect(
      (
        await db.pool.query(
          "SELECT result->'review' AS review FROM ingestion_operations WHERE candidate_id=$1 AND kind='approve'",
          [saved.candidateId],
        )
      ).rows[0].review,
    ).toEqual(review);
  });

  it("附件改动立刻提取两侧资格/截止冲突，旧材料拒绝，名单擦除涵盖提取历史", async () => {
    const url = `https://${sources[0].host}/info/1043/177.htm`;
    const paragraphs = ["参赛对象：全校学生。", "报名截止：2026年11月1日。"];
    const article: Article = {
      title: "2026年数学竞赛报名通知",
      publishedAt: null,
      text: paragraphs.join("\n"),
      paragraphs,
      attachments: [],
    };
    const saved = await persistArticle(
      db.pool,
      sources[0],
      url,
      { url, html: "", body: new Uint8Array(), status: 200, headers: {} },
      article,
      parseCandidate(article, url, directory!),
    );
    const oldReview = correctedReview(
      await exportReview(db.pool, saved.candidateId!),
    );
    const attachment = await persistAttachment(db.pool, {
      noticeId: saved.noticeId,
      noticeVersion: oldReview.sourceVersion,
      url: `https://${sources[0].host}/rules176.pdf`,
      mediaType: "application/pdf",
      extractorVersion: "test-1",
      status: "extracted",
      segments: [
        {
          kind: "page",
          index: 2,
          text: "参赛对象：仅限大三学生。报名截止：2026年11月8日。主办单位：隐私待擦除测试文本。",
        },
      ],
      body: Buffer.from("%PDF rules 176"),
    });
    const fresh = await exportReview(db.pool, saved.candidateId!);
    expect(fresh.candidate.fields).toMatchObject({
      deadline: { precision: "unknown", value: null },
      scope: { kind: "unknown" },
    });
    expect(
      fresh.candidate.fieldConflicts?.find((c) => c.field === "deadline")
        ?.values,
    ).toHaveLength(2);
    expect(fresh.evidenceReferences).toContainEqual(
      expect.objectContaining({
        field: "deadline",
        format: "pdf",
        page: 2,
        attachmentVersion: attachment.versionId,
      }),
    );
    await expect(
      approveReview(db.pool, oldReview, "maintainer"),
    ).rejects.toThrow(/过期|变化/);
    await markAttachmentNeedsReview(
      db.pool,
      attachment.attachmentId,
      "applicant-list",
      "blocked",
    );
    const history = (
      await db.pool.query(
        "SELECT data FROM ingestion_extraction_revisions WHERE candidate_id=$1",
        [saved.candidateId],
      )
    ).rows;
    expect(JSON.stringify(history)).not.toContain("隐私待擦除测试文本");
  });
});
