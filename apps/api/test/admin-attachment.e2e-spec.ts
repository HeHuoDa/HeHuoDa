import { randomUUID } from "node:crypto";
import { passwordHash } from "../src/admin/admin-security.js";
import { authTestApp, type AuthTestApp } from "./auth-fixture.js";
import { initializeSources, persistArticle } from "../src/ingestion/store.js";
import {
  markAttachmentNeedsReview,
  persistAttachment,
} from "../src/ingestion/attachment-store.js";
import { AdminAttachmentService } from "../src/ingestion/admin-attachment.service.js";
import {
  extractArticle,
  parseCandidate,
  sources,
} from "@hehuoda/sicau-connectors/notices";
import { informationArticle } from "./notice-fixtures.js";
import { exportReview } from "../src/ingestion/review.js";
import { correctedReview } from "./ingestion-fixture.js";

describe("附件管理 HTTP 权限、分页与受理", () => {
  let test: AuthTestApp, cookie: string, csrf: string;
  let attachmentId: string,
    versionId: string,
    noticeId: string,
    baseline: number;
  const origin = "http://localhost:5173";
  beforeAll(async () => {
    test = await authTestApp();
    const salt = Buffer.alloc(16, 72);
    await test.pool.query(
      "INSERT INTO admin_accounts(username,display_name,password_salt,password_hash) VALUES($1,$2,$3,$4)",
      [
        "attachment-admin",
        "附件管理员",
        salt,
        await passwordHash("test-password", salt),
      ],
    );
    const login = await test.request(
      "POST",
      "admin/auth/login",
      { username: "attachment-admin", password: "test-password" },
      { origin },
    );
    cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    csrf = (
      await test.request("GET", "admin/auth/csrf", undefined, { cookie })
    ).json().csrfToken;
    await initializeSources(test.pool);
    const source = sources[0],
      url = `https://${source.host}/info/1043/345.htm`;
    const article = extractArticle(informationArticle, url, source);
    const persisted = await persistArticle(
      test.pool,
      source,
      url,
      {
        status: 200,
        headers: {},
        body: Buffer.from(informationArticle),
        html: informationArticle,
        url,
      },
      article,
      parseCandidate(article, url, []),
    );
    noticeId = persisted.noticeId;
    const current = (
      await test.pool.query(
        "SELECT latest_version FROM ingestion_notices WHERE id=$1",
        [noticeId],
      )
    ).rows[0];
    const saved = await persistAttachment(test.pool, {
      noticeId,
      noticeVersion: current.latest_version,
      url: `https://${source.host}/system/_content/download.jsp?id=9`,
      mediaType: "application/pdf",
      extractorVersion: "test/1",
      status: "extracted",
      segments: [{ kind: "page", index: 1, text: "规则纯文本" }],
      body: Buffer.from("%PDF-test"),
    });
    attachmentId = saved.attachmentId;
    versionId = saved.versionId;
    baseline = saved.evidenceRevision;
  });
  afterAll(async () => {
    await test?.close();
  });
  it("需登录且只返回纯文本分页，不泄露字节；写入校验CSRF和基线", async () => {
    const path = `admin/ingestion/attachments/${attachmentId}/versions/${versionId}`;
    expect((await test.request("GET", path)).statusCode).toBe(401);
    const read = await test.request("GET", path, undefined, { cookie });
    expect(read.statusCode).toBe(200);
    expect(read.json().segments).toEqual([
      { kind: "page", index: 1, text: "规则纯文本", truncated: false },
    ]);
    expect(read.json()).not.toHaveProperty("body");
    const target = `admin/ingestion/attachments/${attachmentId}/recheck`;
    expect(
      (
        await test.request(
          "POST",
          target,
          { operationId: randomUUID(), reason: "核对", baseline },
          { cookie, origin },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await test.request(
          "POST",
          target,
          { operationId: randomUUID(), reason: "核对", baseline: baseline - 1 },
          { cookie, origin, "x-csrf-token": csrf },
        )
      ).statusCode,
    ).toBe(409);

    await markAttachmentNeedsReview(
      test.pool,
      attachmentId,
      "applicant-list",
      "blocked",
    );
    const redacted = await test.request("GET", path, undefined, { cookie });
    expect(redacted.statusCode).toBe(200);
    expect(redacted.json()).toMatchObject({
      sha256: null,
      status: "blocked",
      errorCode: "applicant-list",
      segments: [],
      totalSegments: 0,
    });
    expect(JSON.stringify(redacted.json())).not.toContain("规则纯文本");
  });
  it("已启用附件的旧格式审核材料返回409并提示重新导出", async () => {
    const candidate = (
      await test.pool.query(
        "SELECT id FROM ingestion_candidates WHERE notice_id=$1",
        [noticeId],
      )
    ).rows[0];
    const file = correctedReview(await exportReview(test.pool, candidate.id));
    file.format = 1;
    delete file.evidence;
    delete file.evidenceRevision;
    delete file.evidenceReferences;
    const response = await test.request(
      "POST",
      `admin/ingestion/candidates/${candidate.id}/approve`,
      { operationId: randomUUID(), reason: "旧材料校验", review: file },
      { cookie, origin, "x-csrf-token": csrf },
    );
    expect(response.statusCode).toBe(409);
  });
  it("原字节清理后重解析409；空队列释放运行锁", async () => {
    await test.pool.query(
      "UPDATE ingestion_attachment_versions SET body=NULL WHERE id=$1",
      [versionId],
    );
    const result = await test.request(
      "POST",
      `admin/ingestion/attachments/${attachmentId}/reparse`,
      { operationId: randomUUID(), reason: "重解析", baseline, versionId },
      { cookie, origin, "x-csrf-token": csrf },
    );
    expect(result.statusCode).toBe(409);
    expect(await test.app.get(AdminAttachmentService).drainOne()).toBe(false);
    const client = await test.pool.connect();
    try {
      expect(
        (await client.query("SELECT pg_try_advisory_lock(23007) AS locked"))
          .rows[0].locked,
      ).toBe(true);
      await client.query("SELECT pg_advisory_unlock(23007)");
    } finally {
      client.release();
    }
  });
});
