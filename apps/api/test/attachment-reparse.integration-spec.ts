import {
  extractArticle,
  parseCandidate,
  sources,
  type AttachmentMediaType,
  type HttpResponse,
} from "@hehuoda/sicau-connectors/notices";
import { AttachmentRunner } from "../src/ingestion/attachment-runner.js";
import {
  getAttachmentVersion,
  listAttachmentVersions,
  persistAttachment,
  readAttachmentBytesForReparse,
  readAttachmentEvidenceReferences,
} from "../src/ingestion/attachment-store.js";
import { initializeSources, persistArticle } from "../src/ingestion/store.js";
import { importBatch } from "../src/competitions/import.js";
import { directory, testDatabase } from "./competition-fixture.js";
import { informationArticle } from "./notice-fixtures.js";

const source = sources[0];
const noticeUrl = `https://${source.host}/info/1043/100.htm`;
const response = (html: string): HttpResponse => ({
  status: 200,
  headers: {},
  body: new TextEncoder().encode(html),
});
const parseExtracted = async (
  _bytes: Uint8Array,
  mediaType: AttachmentMediaType,
) => ({
  mediaType,
  extractorVersion: "test-parser/2",
  status: "extracted" as const,
  segments: [{ kind: "page" as const, index: 1, text: "重新提取规则" }],
});

describe("附件版本重解析 PostgreSQL 行为", () => {
  let db: Awaited<ReturnType<typeof testDatabase>>;
  let noticeId: string;
  let noticeVersion: string;

  beforeAll(async () => {
    db = await testDatabase();
  });

  afterAll(async () => db?.close());

  beforeEach(async () => {
    await db.pool.query(
      "TRUNCATE ingestion_sources,colleges,competitions CASCADE",
    );
    await initializeSources(db.pool);
    await importBatch(db.pool, { colleges: directory });
    const article = extractArticle(informationArticle, noticeUrl, source);
    const persisted = await persistArticle(
      db.pool,
      source,
      noticeUrl,
      {
        ...response(informationArticle),
        url: noticeUrl,
        html: informationArticle,
      },
      article,
      parseCandidate(article, noticeUrl, directory!),
    );
    noticeId = persisted.noticeId;
    noticeVersion = (
      await db.pool.query(
        "SELECT latest_version FROM ingestion_notices WHERE id=$1",
        [noticeId],
      )
    ).rows[0].latest_version;
  });

  async function addAttachment(bytes: string, sourceVersion = noticeVersion) {
    return persistAttachment(db.pool, {
      noticeId,
      noticeVersion: sourceVersion,
      url: `https://${source.host}/files/rules.pdf`,
      mediaType: "application/pdf",
      extractorVersion: "test-parser/1",
      status: "extracted",
      segments: [{ kind: "page", index: 1, text: `原文 ${bytes}` }],
      body: Buffer.from(`%PDF-1.7 ${bytes}`),
    });
  }

  async function advanceNoticeVersion() {
    const html = informationArticle.replace(
      "2026年测试竞赛报名通知",
      "2026年测试竞赛报名补充通知",
    );
    const article = extractArticle(html, noticeUrl, source);
    await persistArticle(
      db.pool,
      source,
      noticeUrl,
      { ...response(html), url: noticeUrl, html },
      article,
      parseCandidate(article, noticeUrl, directory!),
    );
    return (
      await db.pool.query(
        "SELECT latest_version FROM ingestion_notices WHERE id=$1",
        [noticeId],
      )
    ).rows[0].latest_version as string;
  }

  it("可重解析历史字节并只追加历史提取修订，不提升为当前证据", async () => {
    const original = await addAttachment("old");
    const originalNoticeVersion = noticeVersion;
    const newerNoticeVersion = await advanceNoticeVersion();
    const current = await addAttachment("current", newerNoticeVersion);
    const before = (
      await db.pool.query(
        `SELECT n.evidence_revision,n.latest_version AS notice_version,
                a.latest_version AS attachment_version,c.revision,c.status
           FROM ingestion_notices n
           JOIN ingestion_candidates c ON c.notice_id=n.id
           JOIN ingestion_attachments a ON a.notice_id=n.id
          WHERE n.id=$1`,
        [noticeId],
      )
    ).rows[0];
    await db.pool.query(
      "UPDATE ingestion_candidates SET status='approved',approved_file='{}' WHERE notice_id=$1",
      [noticeId],
    );

    const runner = new AttachmentRunner(db.pool, parseExtracted);
    const result = await runner.reparse(
      original.attachmentId,
      original.versionId,
      Number(before.evidence_revision),
    );

    expect(result).toMatchObject({
      historical: true,
      versionId: expect.any(String),
    });
    expect(result.versionId).not.toBe(original.versionId);
    const versions = await listAttachmentVersions(
      db.pool,
      original.attachmentId,
    );
    expect(versions).toHaveLength(3);
    expect(versions[0]).toMatchObject({
      id: result.versionId,
      previous_version: original.versionId,
      revision: 3,
      notice_version: originalNoticeVersion,
      extractor_version: "test-parser/2",
      status: "extracted",
    });
    expect(versions[0].sha256).toBe(versions[2].sha256);
    expect(versions[1].notice_version).toBe(newerNoticeVersion);
    expect(
      (
        await db.pool.query(
          "SELECT discovered_version FROM ingestion_attachments WHERE id=$1",
          [original.attachmentId],
        )
      ).rows[0].discovered_version,
    ).toBe(originalNoticeVersion);
    expect(
      (
        await db.pool.query(
          "SELECT latest_version,state FROM ingestion_attachments WHERE id=$1",
          [original.attachmentId],
        )
      ).rows[0],
    ).toMatchObject({ latest_version: current.versionId, state: "extracted" });
    expect(
      (
        await db.pool.query(
          `SELECT n.evidence_revision,c.revision,c.status,c.approved_file
             FROM ingestion_notices n JOIN ingestion_candidates c ON c.notice_id=n.id
            WHERE n.id=$1`,
          [noticeId],
        )
      ).rows[0],
    ).toMatchObject({
      evidence_revision: before.evidence_revision,
      revision: before.revision,
      status: "approved",
      approved_file: {},
    });
  });

  it("当前版本解析失败时保留失败原因并冻结旧批准", async () => {
    const current = await addAttachment("current");
    const before = (
      await db.pool.query(
        "SELECT evidence_revision FROM ingestion_notices WHERE id=$1",
        [noticeId],
      )
    ).rows[0].evidence_revision as number;
    await db.pool.query(
      "UPDATE ingestion_candidates SET status='approved',approved_file='{}' WHERE notice_id=$1",
      [noticeId],
    );
    const failure = Object.assign(new Error("解析超时"), {
      code: "parse-timeout",
    });
    const runner = new AttachmentRunner(db.pool, async () => {
      throw failure;
    });

    await expect(
      runner.reparse(current.attachmentId, current.versionId, before),
    ).rejects.toThrow("解析超时");

    expect(
      (
        await db.pool.query(
          `SELECT a.state,a.error_code,n.evidence_state,n.evidence_revision,
                  c.status,c.approved_file
             FROM ingestion_attachments a
             JOIN ingestion_notices n ON n.id=a.notice_id
             JOIN ingestion_candidates c ON c.notice_id=n.id
            WHERE a.id=$1`,
          [current.attachmentId],
        )
      ).rows[0],
    ).toMatchObject({
      state: "needs-review",
      error_code: "parse-timeout",
      evidence_state: "review-required",
      status: "pending",
      approved_file: null,
    });
    const afterRevision = (
      await db.pool.query(
        "SELECT evidence_revision FROM ingestion_notices WHERE id=$1",
        [noticeId],
      )
    ).rows[0].evidence_revision as number;
    expect(afterRevision).toBeGreaterThan(before);
  });

  it("敏感内容拦截不保存正文、摘要或文本", async () => {
    const saved = await persistAttachment(db.pool, {
      noticeId,
      noticeVersion,
      url: `https://${source.host}/files/applicants.pdf`,
      mediaType: "application/pdf",
      extractorVersion: "test-parser/1",
      status: "blocked",
      segments: [],
      body: Buffer.from("private applicant data"),
      persistContent: false,
    });

    const row = (
      await db.pool.query(
        "SELECT sha256,body,segments,error_code FROM ingestion_attachment_versions WHERE id=$1",
        [saved.versionId],
      )
    ).rows[0];
    expect(row).toMatchObject({
      sha256: null,
      body: null,
      segments: [],
      error_code: "sensitive-content-excluded",
    });
  });

  it("重解析识别名单后擦除已识别字节及相同内容版本，保留不同历史内容", async () => {
    const olderRules = await addAttachment("older-public-rules");
    const currentList = await addAttachment("sensitive-applicant-list");
    const baseline = (
      await db.pool.query(
        "SELECT evidence_revision FROM ingestion_notices WHERE id=$1",
        [noticeId],
      )
    ).rows[0].evidence_revision as number;
    const runner = new AttachmentRunner(db.pool, async (_bytes, mediaType) => ({
      mediaType,
      extractorVersion: "test-parser/blocked",
      status: "blocked" as const,
      errorCode: "applicant-list",
      segments: [],
      persistContent: false,
    }));

    await runner.reparse(
      currentList.attachmentId,
      currentList.versionId,
      baseline,
    );

    const versions = await listAttachmentVersions(
      db.pool,
      currentList.attachmentId,
    );
    expect(versions).toHaveLength(3);
    expect(versions[0]).toMatchObject({
      previous_version: currentList.versionId,
      status: "blocked",
      error_code: "applicant-list",
      sha256: null,
      segments: [],
    });
    expect(
      (
        await db.pool.query(
          "SELECT body FROM ingestion_attachment_versions WHERE id=$1",
          [versions[0].id],
        )
      ).rows[0].body,
    ).toBeNull();
    expect(
      await getAttachmentVersion(
        db.pool,
        currentList.attachmentId,
        currentList.versionId,
      ),
    ).toMatchObject({ sha256: null, segments: [], status: "blocked" });
    await expect(
      readAttachmentBytesForReparse(
        db.pool,
        currentList.attachmentId,
        currentList.versionId,
      ),
    ).rejects.toThrow("附件字节已清理");
    expect(versions[2]).toMatchObject({
      id: olderRules.versionId,
      status: "extracted",
      sha256: expect.any(String),
      segments: [{ kind: "page", index: 1, text: `原文 older-public-rules` }],
    });
    expect(
      (
        await db.pool.query(
          "SELECT body FROM ingestion_attachment_versions WHERE id=$1",
          [olderRules.versionId],
        )
      ).rows[0].body,
    ).toEqual(Buffer.from("%PDF-1.7 older-public-rules"));
    expect(
      (
        await db.pool.query(
          "SELECT reason FROM ingestion_attachment_events WHERE notice_id=$1 AND reason='privacy-redaction'",
          [noticeId],
        )
      ).rowCount,
    ).toBe(1);
  });

  it("历史敏感内容擦除不破坏当前合法批准的摘要", async () => {
    const old = await addAttachment("old-sensitive"),
      current = await addAttachment("current-public");
    const hash = (
      await db.pool.query(
        "SELECT sha256 FROM ingestion_attachment_versions WHERE id=$1",
        [current.versionId],
      )
    ).rows[0].sha256;
    const baseline = (
      await db.pool.query(
        "SELECT evidence_revision FROM ingestion_notices WHERE id=$1",
        [noticeId],
      )
    ).rows[0].evidence_revision;
    const snapshot = {
      evidence: [
        {
          attachmentId: current.attachmentId,
          versionId: current.versionId,
          sha256: hash,
        },
      ],
      evidenceReferences: [
        { attachmentVersion: current.versionId, excerpt: "当前公开规则" },
      ],
    };
    await db.pool.query(
      "UPDATE ingestion_candidates SET status='approved',approved_file=$2 WHERE notice_id=$1",
      [noticeId, JSON.stringify(snapshot)],
    );
    const runner = new AttachmentRunner(db.pool, async (_bytes, mediaType) => ({
      mediaType,
      extractorVersion: "test/blocked",
      status: "blocked",
      errorCode: "applicant-list",
      segments: [],
    }));
    await runner.reparse(old.attachmentId, old.versionId, baseline);
    const state = (
      await db.pool.query(
        "SELECT status,approved_file FROM ingestion_candidates WHERE notice_id=$1",
        [noticeId],
      )
    ).rows[0];
    expect(state).toMatchObject({
      status: "approved",
      approved_file: snapshot,
    });
  });
  it("审核定位摘录每附件最多保留100段", async () => {
    const saved = await persistAttachment(db.pool, {
      noticeId,
      noticeVersion,
      url: `https://${source.host}/files/rules.docx`,
      mediaType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      extractorVersion: "test-parser/1",
      status: "extracted",
      segments: Array.from({ length: 101 }, (_, index) => ({
        kind: "paragraph" as const,
        index: index + 1,
        text: `段落 ${index + 1}`,
      })),
      body: Buffer.from("docx-fixture"),
    });

    const refs = await readAttachmentEvidenceReferences(db.pool, noticeId);
    const attachmentRefs = refs.filter(
      (ref) => ref.attachmentVersion === saved.versionId,
    );
    expect(attachmentRefs).toHaveLength(100);
    expect(attachmentRefs.at(-1)).toMatchObject({ paragraph: 100 });
  });

  it("历史版本解析失败只记录历史安全状态，不冻结当前批准", async () => {
    const originalNoticeVersion = noticeVersion;
    const historical = await addAttachment("old");
    const sourceVersion = await advanceNoticeVersion();
    const current = await addAttachment("current", sourceVersion);
    const before = (
      await db.pool.query(
        "SELECT evidence_revision FROM ingestion_notices WHERE id=$1",
        [noticeId],
      )
    ).rows[0].evidence_revision as number;
    await db.pool.query(
      "UPDATE ingestion_candidates SET status='approved',approved_file='{}' WHERE notice_id=$1",
      [noticeId],
    );
    const failure = Object.assign(new Error("解析超时"), {
      code: "parse-timeout",
    });
    const runner = new AttachmentRunner(db.pool, async () => {
      throw failure;
    });

    await expect(
      runner.reparse(historical.attachmentId, historical.versionId, before),
    ).rejects.toThrow("解析超时");

    expect(
      (
        await db.pool.query(
          "SELECT latest_version,state FROM ingestion_attachments WHERE id=$1",
          [historical.attachmentId],
        )
      ).rows[0],
    ).toMatchObject({ latest_version: current.versionId, state: "extracted" });
    expect(
      (
        await db.pool.query(
          `SELECT n.evidence_revision,c.status,c.approved_file
             FROM ingestion_notices n JOIN ingestion_candidates c ON c.notice_id=n.id
            WHERE n.id=$1`,
          [noticeId],
        )
      ).rows[0],
    ).toMatchObject({
      evidence_revision: before,
      status: "approved",
      approved_file: {},
    });
    const versions = await listAttachmentVersions(
      db.pool,
      historical.attachmentId,
    );
    expect(versions).toHaveLength(3);
    expect(versions[0]).toMatchObject({
      revision: 3,
      notice_version: originalNoticeVersion,
      status: "needs-review",
      error_code: "parse-timeout",
      sha256: null,
      segments: [],
    });
    expect(
      (
        await db.pool.query(
          "SELECT body FROM ingestion_attachment_versions WHERE id=$1",
          [versions[0].id],
        )
      ).rows[0].body,
    ).toBeNull();
  });

  it("解析期间通知基线变化会拒绝旧解析结果", async () => {
    const current = await addAttachment("current");
    const before = (
      await db.pool.query(
        "SELECT evidence_revision FROM ingestion_notices WHERE id=$1",
        [noticeId],
      )
    ).rows[0].evidence_revision as number;
    let concurrent: Awaited<ReturnType<typeof addAttachment>> | undefined;
    const runner = new AttachmentRunner(db.pool, async () => {
      concurrent = await addAttachment("concurrent");
      return parseExtracted(new Uint8Array(), "application/pdf");
    });

    await expect(
      runner.reparse(current.attachmentId, current.versionId, before),
    ).rejects.toThrow("基线");
    expect(
      (
        await db.pool.query(
          "SELECT latest_version FROM ingestion_attachments WHERE id=$1",
          [current.attachmentId],
        )
      ).rows[0].latest_version,
    ).toBe(concurrent?.versionId);
  });
});
