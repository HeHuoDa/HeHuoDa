import { randomUUID } from "node:crypto";
import { testDatabase } from "./competition-fixture.js";
import { directory } from "./competition-fixture.js";
import { importBatch } from "../src/competitions/import.js";
import { correctedReview } from "./ingestion-fixture.js";
import {
  approveReview,
  applyReview,
  exportReview,
} from "../src/ingestion/review.js";
import { initializeSources, persistArticle } from "../src/ingestion/store.js";
import {
  cleanupAttachmentBodies,
  getAttachmentVersion,
  listAttachments,
  listAttachmentVersions,
  markAttachmentNeedsReview,
  persistAttachment,
  registerAttachments,
  queueDueAttachments,
  reparseExistingAttachment,
  readAttachmentPlan,
} from "../src/ingestion/attachment-store.js";
import {
  extractArticle,
  parseCandidate,
  sources,
  type HttpResponse,
} from "@hehuoda/sicau-connectors/notices";
import { informationArticle } from "./notice-fixtures.js";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrate } from "../src/database/migrate.js";
import { reserveAttachmentNetworkRequest } from "../src/ingestion/attachment-budget.js";

const source = sources[0];
const noticeUrl = `https://${source.host}/info/1043/100.htm`;
const http = (html: string): HttpResponse => ({
  status: 200,
  headers: {},
  body: new TextEncoder().encode(html),
});

describe("附件版本与通知证据集合 PostgreSQL 行为", () => {
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
      { ...http(informationArticle), url: noticeUrl, html: informationArticle },
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

  it("关闭附件下载不能让正文新版绕过既有附件证据校验", async () => {
    await persistAttachment(db.pool, {
      noticeId,
      noticeVersion,
      url: `https://${source.host}/files/rules.pdf`,
      mediaType: "application/pdf",
      extractorVersion: "test/1",
      status: "extracted",
      segments: [{ kind: "page", index: 1, text: "规则" }],
      body: Buffer.from("%PDF-rules"),
    });
    const previous = process.env.INGESTION_ATTACHMENTS_ENABLED;
    process.env.INGESTION_ATTACHMENTS_ENABLED = "false";
    try {
      const html = informationArticle.replace(
        "2026年测试竞赛报名通知",
        "2026年测试竞赛报名补充通知",
      );
      const article = extractArticle(html, noticeUrl, source);
      const result = await persistArticle(
        db.pool,
        source,
        noticeUrl,
        { ...http(html), url: noticeUrl, html },
        article,
        parseCandidate(article, noticeUrl, directory!),
      );
      const file = correctedReview(
        await exportReview(db.pool, result.candidateId!),
      );
      await expect(approveReview(db.pool, file, "maintainer")).rejects.toThrow(
        "核对",
      );
    } finally {
      if (previous === undefined)
        delete process.env.INGESTION_ATTACHMENTS_ENABLED;
      else process.env.INGESTION_ATTACHMENTS_ENABLED = previous;
    }
  });
  it("手动和调度请求共用持久时段预算，重建进程不能重置额度", async () => {
    const at = new Date("2026-10-28T10:00:00Z");
    await db.pool.query(
      "INSERT INTO ingestion_network_windows(due_at,requests) VALUES($1,199)",
      [at],
    );
    await reserveAttachmentNetworkRequest(db.pool, at);
    await expect(reserveAttachmentNetworkRequest(db.pool, at)).rejects.toThrow(
      "共享请求预算",
    );
    await reserveAttachmentNetworkRequest(
      db.pool,
      new Date("2026-10-29T01:00:00Z"),
    );
  });
  it("相同内容幂等、内容变化追加版本并使旧批准失效", async () => {
    const first = await persistAttachment(db.pool, {
      noticeId,
      noticeVersion,
      url: `https://${source.host}/files/rules.pdf?doc=7`,
      mediaType: "application/pdf",
      extractorVersion: "pdf-1",
      status: "extracted",
      segments: [{ kind: "page", index: 1, text: "报名规则" }],
      body: Buffer.from("%PDF-1.7 rules"),
    });
    expect(first.changed).toBe(true);
    const same = await persistAttachment(db.pool, {
      noticeId,
      noticeVersion,
      url: `https://${source.host}/files/rules.pdf?doc=7`,
      mediaType: "application/pdf",
      extractorVersion: "pdf-1",
      status: "extracted",
      segments: [{ kind: "page", index: 1, text: "报名规则" }],
      body: Buffer.from("%PDF-1.7 rules"),
    });
    expect(same.versionId).toBe(first.versionId);
    expect(same.changed).toBe(false);
    await db.pool.query(
      "UPDATE ingestion_candidates SET status='approved',approved_file='{}' WHERE notice_id=$1",
      [noticeId],
    );
    const changed = await persistAttachment(db.pool, {
      noticeId,
      noticeVersion,
      url: `https://${source.host}/files/rules.pdf?doc=7`,
      mediaType: "application/pdf",
      extractorVersion: "pdf-1",
      status: "extracted",
      segments: [{ kind: "page", index: 1, text: "新规则" }],
      body: Buffer.from("%PDF-1.7 amended"),
    });
    expect(changed.versionId).not.toBe(first.versionId);
    expect(
      (
        await db.pool.query(
          "SELECT status,revision,approved_file FROM ingestion_candidates WHERE notice_id=$1",
          [noticeId],
        )
      ).rows[0],
    ).toMatchObject({ status: "pending", revision: 3, approved_file: null });
    expect(
      await listAttachmentVersions(db.pool, first.attachmentId),
    ).toHaveLength(2);
  });

  it("名单预筛会擦除该附件全部旧版本及只读审核副本，不影响其它附件", async () => {
    const first = await persistAttachment(db.pool, {
      noticeId,
      noticeVersion,
      url: `https://${source.host}/files/applicant-list.pdf`,
      mediaType: "application/pdf",
      extractorVersion: "test/1",
      status: "extracted",
      segments: [{ kind: "page", index: 1, text: "敏感名单旧版内容" }],
      body: Buffer.from("%PDF private list revision one"),
    });
    const second = await persistAttachment(db.pool, {
      noticeId,
      noticeVersion,
      url: `https://${source.host}/files/applicant-list.pdf`,
      mediaType: "application/pdf",
      extractorVersion: "test/1",
      status: "extracted",
      segments: [{ kind: "page", index: 1, text: "敏感名单当前内容" }],
      body: Buffer.from("%PDF private list revision two"),
    });
    const unrelated = await persistAttachment(db.pool, {
      noticeId,
      noticeVersion,
      url: `https://${source.host}/files/rules.pdf`,
      mediaType: "application/pdf",
      extractorVersion: "test/1",
      status: "extracted",
      segments: [{ kind: "page", index: 1, text: "公开竞赛规则" }],
      body: Buffer.from("%PDF public rules"),
    });
    const candidate = (
      await db.pool.query(
        "SELECT id FROM ingestion_candidates WHERE notice_id=$1",
        [noticeId],
      )
    ).rows[0];
    const file = await exportReview(db.pool, candidate.id);
    const adminId = randomUUID();
    const commandId = randomUUID();
    const previewId = randomUUID();
    await db.pool.query(
      "INSERT INTO admin_accounts(id,username,display_name,password_salt,password_hash) VALUES($1,$2,$3,$4,$5)",
      [
        adminId,
        `privacy-${adminId}`,
        "隐私回归测试",
        Buffer.alloc(16),
        Buffer.alloc(32),
      ],
    );
    await db.pool.query(
      "UPDATE ingestion_candidates SET status='approved',approved_file=$2::jsonb WHERE id=$1",
      [candidate.id, JSON.stringify(file)],
    );
    await db.pool.query(
      "INSERT INTO ingestion_review_revisions(candidate_id,candidate_revision,source_version,target_id,review,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        candidate.id,
        file.candidateRevision + 1,
        file.sourceVersion,
        file.targetId,
        JSON.stringify(file),
        adminId,
        "隐私擦除测试快照",
      ],
    );
    await db.pool.query(
      "INSERT INTO ingestion_operations(id,candidate_id,source_version,candidate_revision,kind,reviewer,input_hash,result) VALUES($1,$2,$3,$4,'approve',$5,$6,$7)",
      [
        `privacy-${commandId}`,
        candidate.id,
        file.sourceVersion,
        file.candidateRevision,
        adminId,
        "a".repeat(64),
        JSON.stringify({ summary: { status: "approved" }, review: file }),
      ],
    );
    await db.pool.query(
      "INSERT INTO admin_operations(actor_type,actor_id,action,object_type,object_id,reason,result,request_id,command_operation_id) VALUES('admin',$1,'candidate.review','candidate',$2,'隐私擦除测试','success',$3,$4)",
      [adminId, candidate.id, randomUUID(), commandId],
    );
    await db.pool.query(
      "INSERT INTO admin_ingestion_commands(actor_id,operation_id,action,input_hash,result) VALUES($1,$2,'candidate.review',$3,$4)",
      [adminId, commandId, "b".repeat(64), JSON.stringify({ review: file })],
    );
    await db.pool.query(
      "INSERT INTO ingestion_review_previews(id,actor_id,purpose,candidate_id,source_version,candidate_revision,target_id,baseline,review_hash,result) VALUES($1,$2,'import',$3,$4,$5,$6,$7,$8,$9)",
      [
        previewId,
        adminId,
        candidate.id,
        file.sourceVersion,
        file.candidateRevision,
        file.targetId,
        file.baseline,
        "c".repeat(64),
        JSON.stringify({ previewed: true }),
      ],
    );

    await markAttachmentNeedsReview(
      db.pool,
      first.attachmentId,
      "applicant-list",
      "blocked",
    );

    const redactedVersions = await db.pool.query(
      "SELECT id,sha256,body,segments,status,error_code FROM ingestion_attachment_versions WHERE attachment_id=$1 ORDER BY revision",
      [first.attachmentId],
    );
    expect(redactedVersions.rows).toHaveLength(2);
    for (const row of redactedVersions.rows)
      expect(row).toMatchObject({
        sha256: null,
        body: null,
        segments: [],
        status: "blocked",
        error_code: "applicant-list",
      });
    const preserved = (
      await db.pool.query(
        "SELECT sha256,body,segments,status FROM ingestion_attachment_versions WHERE id=$1",
        [unrelated.versionId],
      )
    ).rows[0];
    expect(preserved).toMatchObject({
      sha256: expect.any(String),
      body: Buffer.from("%PDF public rules"),
      segments: [{ kind: "page", index: 1, text: "公开竞赛规则" }],
      status: "extracted",
    });

    const saved = (
      await db.pool.query(
        "SELECT review FROM ingestion_review_revisions WHERE candidate_id=$1",
        [candidate.id],
      )
    ).rows[0].review;
    const operation = (
      await db.pool.query(
        "SELECT input_hash,result FROM ingestion_operations WHERE id=$1",
        [`privacy-${commandId}`],
      )
    ).rows[0];
    const command = (
      await db.pool.query(
        "SELECT input_hash,result FROM admin_ingestion_commands WHERE actor_id=$1 AND operation_id=$2",
        [adminId, commandId],
      )
    ).rows[0];
    for (const snapshot of [
      saved,
      operation.result.review,
      command.result.review,
    ]) {
      expect(
        snapshot.evidence.find(
          (item: { attachmentId: string }) =>
            item.attachmentId === first.attachmentId,
        ).sha256,
      ).toBeNull();
      expect(
        snapshot.evidence.find(
          (item: { attachmentId: string }) =>
            item.attachmentId === unrelated.attachmentId,
        ).sha256,
      ).toEqual(expect.any(String));
      expect(
        snapshot.evidenceReferences.find(
          (item: { attachmentVersion: string | null }) =>
            item.attachmentVersion === second.versionId,
        ).excerpt,
      ).toBe("");
    }
    expect(operation.input_hash).toBe("privacy-redacted");
    expect(command.input_hash).toBe("privacy-redacted");
    expect(
      (
        await db.pool.query(
          "SELECT review_hash FROM ingestion_review_previews WHERE id=$1",
          [previewId],
        )
      ).rows[0].review_hash,
    ).toBe("privacy-redacted");
    expect(
      (
        await db.pool.query(
          "SELECT approved_file FROM ingestion_candidates WHERE id=$1",
          [candidate.id],
        )
      ).rows[0].approved_file,
    ).toBeNull();
    expect(
      (
        await db.pool.query(
          "SELECT reason FROM ingestion_attachment_events WHERE notice_id=$1",
          [noticeId],
        )
      ).rows.map((row) => row.reason),
    ).toEqual(expect.arrayContaining(["applicant-list", "privacy-redaction"]));
  });

  it("format2 导出保留 HTML/PDF 的来源、版本和定位证据", async () => {
    const saved = await persistAttachment(db.pool, {
      noticeId,
      noticeVersion,
      url: `https://${source.host}/files/rules.pdf`,
      mediaType: "application/pdf",
      extractorVersion: "test/1",
      status: "extracted",
      segments: [{ kind: "page", index: 1, text: "报名规则" }],
      body: Buffer.from("%PDF-rules"),
    });
    const candidate = (
      await db.pool.query(
        "SELECT id FROM ingestion_candidates WHERE notice_id=$1",
        [noticeId],
      )
    ).rows[0];
    const file = await exportReview(db.pool, candidate.id);
    expect(file).toHaveProperty(
      "evidenceReferences",
      expect.arrayContaining([
        expect.objectContaining({
          format: "html",
          noticeVersion,
          attachmentVersion: null,
        }),
        {
          format: "pdf",
          url: `https://${source.host}/files/rules.pdf`,
          noticeVersion,
          attachmentVersion: saved.versionId,
          page: 1,
          field: "attachmentText",
          excerpt: "报名规则",
        },
      ]),
    );
  });

  it("调度复查按通知置陈旧一次；同哈希重新验证恢复证据但不恢复旧批准", async () => {
    const data = {
      noticeId,
      noticeVersion,
      url: `https://${source.host}/files/rules.pdf`,
      mediaType: "application/pdf",
      extractorVersion: "pdf-1",
      status: "extracted" as const,
      segments: [{ kind: "page" as const, index: 1, text: "规则" }],
      body: Buffer.from("same bytes"),
    };
    const original = await persistAttachment(db.pool, data);
    const future = new Date(Date.now() + 60_000);
    expect(await queueDueAttachments(db.pool, future)).toEqual({
      noticesQueued: 1,
    });
    expect(await queueDueAttachments(db.pool, future)).toEqual({
      noticesQueued: 0,
    });
    expect(
      (
        await db.pool.query(
          "SELECT evidence_state FROM ingestion_notices WHERE id=$1",
          [noticeId],
        )
      ).rows[0].evidence_state,
    ).toBe("review-required");
    const verified = await persistAttachment(db.pool, {
      ...data,
      fetchedAt: new Date(Date.now() + 60_001),
    });
    expect(verified).toMatchObject({
      versionId: original.versionId,
      changed: false,
      restored: true,
    });
    expect(
      (
        await db.pool.query(
          "SELECT evidence_state FROM ingestion_notices WHERE id=$1",
          [noticeId],
        )
      ).rows[0].evidence_state,
    ).toBe("current");
  });

  it("名单筛除时不写入字节或文本，且过期字节可清理", async () => {
    const result = await persistAttachment(db.pool, {
      noticeId,
      noticeVersion,
      url: `https://${source.host}/files/applicants.pdf`,
      mediaType: "application/pdf",
      extractorVersion: "pdf-1",
      status: "blocked",
      segments: [],
      body: Buffer.from("private list"),
      persistContent: false,
    });
    const version = await getAttachmentVersion(
      db.pool,
      result.attachmentId,
      result.versionId,
    );
    expect(version).toMatchObject({
      status: "blocked",
      segments: [],
      error_code: "sensitive-content-excluded",
    });
    const raw = await db.pool.query(
      "SELECT body FROM ingestion_attachment_versions WHERE id=$1",
      [result.versionId],
    );
    expect(raw.rows[0].body).toBeNull();
    const ordinary = await persistAttachment(db.pool, {
      noticeId,
      noticeVersion,
      url: `https://${source.host}/files/rules.pdf`,
      mediaType: "application/pdf",
      extractorVersion: "pdf-1",
      status: "extracted",
      segments: [{ kind: "page", index: 1, text: "规则" }],
      body: Buffer.from("%PDF rules"),
    });
    const rows = await readAttachmentPlan(db.pool, { noticeId });
    expect(rows).toHaveLength(1);
    expect(rows[0].attachmentId).toBe(ordinary.attachmentId);
    await db.pool.query(
      "UPDATE ingestion_attachment_versions SET fetched_at=now()-interval '31 days' WHERE id=$1",
      [result.versionId],
    );
    await db.pool.query(
      "UPDATE ingestion_attachment_versions SET fetched_at=now()-interval '31 days' WHERE id=$1",
      [ordinary.versionId],
    );
    expect(await cleanupAttachmentBodies(db.pool)).toEqual({ removed: 1 });
    await expect(
      reparseExistingAttachment(
        db.pool,
        ordinary.attachmentId,
        ordinary.versionId,
        {
          mediaType: "application/pdf",
          extractorVersion: "pdf-2",
          status: "extracted",
          segments: [{ kind: "page", index: 1, text: "重解析" }],
        },
      ),
    ).rejects.toThrow("字节已清理");
  });

  it("附件变化使旧审核材料失效且不得导入正式比赛", async () => {
    const file = correctedReview(
      await exportReview(
        db.pool,
        (
          await db.pool.query(
            "SELECT id FROM ingestion_candidates WHERE notice_id=$1",
            [noticeId],
          )
        ).rows[0].id,
      ),
    );
    await approveReview(db.pool, file, "maintainer");
    await persistAttachment(db.pool, {
      noticeId,
      noticeVersion,
      url: `https://${source.host}/files/rules.pdf`,
      mediaType: "application/pdf",
      extractorVersion: "pdf-1",
      status: "extracted",
      segments: [{ kind: "page", index: 1, text: "原始条件" }],
      body: Buffer.from("original"),
    });
    await expect(applyReview(db.pool, file, "maintainer")).rejects.toThrow(
      "候选修订已变化",
    );
    expect(
      (
        await db.pool.query(
          "SELECT status FROM ingestion_candidates WHERE notice_id=$1",
          [noticeId],
        )
      ).rows[0].status,
    ).toBe("pending");
    expect(
      (
        await db.pool.query("SELECT id FROM competitions WHERE id=$1", [
          file.targetId,
        ])
      ).rowCount,
    ).toBe(0);
  });

  it("拒绝不安全 URL、陈旧正文版本和超大文件", async () => {
    const base = {
      noticeId,
      noticeVersion,
      mediaType: "application/pdf",
      extractorVersion: "pdf-1",
      status: "extracted" as const,
      segments: [],
      body: Buffer.from("x"),
    };
    await expect(
      persistAttachment(db.pool, { ...base, url: "http://example.test/a.pdf" }),
    ).rejects.toThrow("HTTPS");
    await expect(
      persistAttachment(db.pool, {
        ...base,
        noticeVersion: "stale",
        url: `https://${source.host}/a.pdf`,
      }),
    ).rejects.toThrow("版本已变化");
    await expect(
      persistAttachment(db.pool, {
        ...base,
        url: `https://${source.host}/a.pdf`,
        body: Buffer.alloc(5 * 1024 * 1024 + 1),
      }),
    ).rejects.toThrow("5 MiB");
  });

  it("登记附件链接立即冻结旧审核；链接规范化并且重复登记幂等", async () => {
    const urls = [
      `https://${source.host}/files/rules.pdf#page=1`,
      `https://${source.host}/files/rules.pdf#page=2`,
    ];
    expect(
      await registerAttachments(db.pool, noticeId, noticeVersion, urls),
    ).toMatchObject({ added: 1, evidenceRevision: 2 });
    expect(
      await registerAttachments(db.pool, noticeId, noticeVersion, urls),
    ).toMatchObject({ added: 0, evidenceRevision: 2 });
    expect(
      (
        await db.pool.query(
          "SELECT evidence_state FROM ingestion_notices WHERE id=$1",
          [noticeId],
        )
      ).rows[0].evidence_state,
    ).toBe("review-required");
    expect(await readAttachmentPlan(db.pool, { noticeId })).toHaveLength(1);
  });

  it("旧 format=1 仅在没有任何附件证据时继续可审核", async () => {
    const candidateId = (
      await db.pool.query(
        "SELECT id FROM ingestion_candidates WHERE notice_id=$1",
        [noticeId],
      )
    ).rows[0].id as string;
    const v2 = correctedReview(await exportReview(db.pool, candidateId));
    const legacy = { ...v2, format: 1 as const };
    await approveReview(db.pool, legacy, "maintainer");
    await persistAttachment(db.pool, {
      noticeId,
      noticeVersion,
      url: `https://${source.host}/files/rules.pdf`,
      mediaType: "application/pdf",
      extractorVersion: "pdf-1",
      status: "extracted",
      segments: [],
      body: Buffer.from("rules"),
    });
    const current = {
      ...correctedReview(await exportReview(db.pool, candidateId)),
      format: 1 as const,
    };
    await expect(approveReview(db.pool, current, "maintainer")).rejects.toThrow(
      "旧格式审核材料已失效",
    );
  });
});

describe("附件迁移兼容旧通知", () => {
  it("为旧版数据库添加空附件集合而保留通知与候选状态", async () => {
    const sourceDirectory = resolve("migrations");
    const legacyDirectory = await mkdtemp(
      join(tmpdir(), "issue175-migrations-"),
    );
    const names = (await readdir(sourceDirectory)).filter(
      (name) => name < "0010_ingestion_attachments.sql",
    );
    for (const name of names)
      await copyFile(join(sourceDirectory, name), join(legacyDirectory, name));
    const legacyDb = await testDatabase(legacyDirectory);
    try {
      await initializeSources(legacyDb.pool);
      await importBatch(legacyDb.pool, { colleges: directory });
      const article = extractArticle(informationArticle, noticeUrl, source);
      const saved = await persistArticle(
        legacyDb.pool,
        source,
        noticeUrl,
        {
          ...http(informationArticle),
          url: noticeUrl,
          html: informationArticle,
        },
        article,
        parseCandidate(article, noticeUrl, directory!),
      );
      await legacyDb.pool.query(
        "UPDATE ingestion_candidates SET status='approved',revision=4 WHERE id=$1",
        [saved.candidateId],
      );
      await migrate(legacyDb.pool, sourceDirectory);
      expect(
        (
          await legacyDb.pool.query(
            "SELECT evidence_revision,evidence_state FROM ingestion_notices WHERE id=$1",
            [saved.noticeId],
          )
        ).rows[0],
      ).toMatchObject({ evidence_revision: 1, evidence_state: "current" });
      expect(
        (
          await legacyDb.pool.query(
            "SELECT status,revision FROM ingestion_candidates WHERE id=$1",
            [saved.candidateId],
          )
        ).rows[0],
      ).toMatchObject({ status: "approved", revision: 4 });
      expect(await listAttachments(legacyDb.pool, saved.noticeId)).toEqual([]);
    } finally {
      await legacyDb.close();
      await rm(legacyDirectory, { recursive: true, force: true });
    }
  });
});
