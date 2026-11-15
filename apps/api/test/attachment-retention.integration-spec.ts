import { directory, testDatabase } from "./competition-fixture.js";
import { importBatch } from "../src/competitions/import.js";
import { correctedReview } from "./ingestion-fixture.js";
import {
  approveReview,
  applyReview,
  exportReview,
  publishImported,
} from "../src/ingestion/review.js";
import {
  cleanupResponses,
  initializeSources,
  persistArticle,
} from "../src/ingestion/store.js";
import {
  cleanupAttachmentBodies,
  getAttachmentVersion,
  listAttachmentVersions,
  persistAttachment,
  reparseExistingAttachment,
} from "../src/ingestion/attachment-store.js";
import {
  extractArticle,
  parseCandidate,
  sources,
  type HttpResponse,
} from "@hehuoda/sicau-connectors/notices";
import { informationArticle } from "./notice-fixtures.js";

const source = sources[0];
const noticeUrl = `https://${source.host}/info/1043/100.htm`;
const http = (html: string): HttpResponse => ({
  status: 200,
  headers: {},
  body: new TextEncoder().encode(html),
});
const noticeBytes = new TextEncoder().encode(informationArticle);
const DAY = 86_400_000;

/**
 * 30 天清理边界的行为验证。
 * 到期判据 = fetched_at < 参照时间 - days，参照时间由用例显式给定（受控时钟）；
 * 时间字段用明确的 fetched_at 回写构造「期限前 / 正好到期 / 期限后」，
 * 不依赖用例执行速度，也不改动生产调度器的默认行为。
 */
describe("30 天清理边界与被引用版本保留", () => {
  let db: Awaited<ReturnType<typeof testDatabase>>;
  let noticeId: string;
  let noticeVersion: string;
  let clock: Date;

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
    // 清理按全库判据执行；每个用例的 removed 计数必须只含本用例的行，
    // 因此先清掉上一用例留下的原始字节（TRUNCATE 只覆盖目录与采集来源链）。
    await db.pool.query("UPDATE ingestion_versions SET raw_response=NULL");
    await db.pool.query("UPDATE ingestion_attachment_versions SET body=NULL");
    const article = extractArticle(informationArticle, noticeUrl, source);
    const persisted = await persistArticle(
      db.pool,
      source,
      noticeUrl,
      {
        ...http(informationArticle),
        url: noticeUrl,
        html: informationArticle,
        body: noticeBytes,
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
    // 固定参照时刻；fetched_at 一律写绝对时间，避免与数据库 now() 漂移。
    clock = new Date("2026-11-20T00:00:00Z");
  });

  async function count(sql: string) {
    return (await db.pool.query<{ total: number }>(sql)).rows[0].total;
  }
  async function candidateId() {
    return (
      await db.pool.query<{ id: string }>(
        "SELECT id FROM ingestion_candidates WHERE notice_id=$1",
        [noticeId],
      )
    ).rows[0].id;
  }
  const daysAgo = (days: number) => new Date(clock.getTime() - days * DAY);

  it("原始响应只在严格超过期限后清理，期限前与正好到期均保留", async () => {
    // 先确认本节验证的链路真的存在原始字节，否则断言会空转通过。
    expect(
      await count(
        "SELECT count(*)::int AS total FROM ingestion_versions WHERE raw_response IS NOT NULL",
      ),
    ).toBe(1);
    const setFetchedAt = (value: Date) =>
      db.pool.query(
        "UPDATE ingestion_versions SET fetched_at=$2 WHERE notice_id=$1",
        [noticeId, value],
      );

    await setFetchedAt(daysAgo(29.5));
    expect(await cleanupResponses(db.pool, 30, clock)).toEqual({ removed: 0 });

    // 正好 30 天：判据是严格小于，因此仍保留。
    await setFetchedAt(new Date(clock.getTime() - 30 * DAY));
    expect(await cleanupResponses(db.pool, 30, clock)).toEqual({ removed: 0 });
    expect(
      await count(
        "SELECT count(*)::int AS total FROM ingestion_versions WHERE raw_response IS NOT NULL",
      ),
    ).toBe(1);

    // 超出 1 毫秒即到期。
    await setFetchedAt(new Date(clock.getTime() - 30 * DAY - 1));
    expect(await cleanupResponses(db.pool, 30, clock)).toEqual({ removed: 1 });

    const version = (
      await db.pool.query<{
        raw_response: Buffer | null;
        article: { text: string };
        extracted: { evidence: unknown[] };
      }>(
        "SELECT raw_response,article,extracted FROM ingestion_versions WHERE notice_id=$1",
        [noticeId],
      )
    ).rows[0];
    // body=NULL 只是逻辑清理：长期文本、字段证据与版本记录必须保留。
    expect(version.raw_response).toBeNull();
    expect(version.article.text).toContain("报名截止");
    expect(version.extracted.evidence.length).toBeGreaterThan(0);
    // 重复清理幂等，不产生第二次删除计数。
    expect(await cleanupResponses(db.pool, 30, clock)).toEqual({ removed: 0 });
  });

  it("附件字节清理保留版本、文本与人工结果，并阻止清理后重新解析", async () => {
    const expired = await persistAttachment(db.pool, {
      noticeId,
      noticeVersion,
      url: `https://${source.host}/files/rules.pdf`,
      mediaType: "application/pdf",
      extractorVersion: "pdf-1",
      status: "extracted",
      segments: [{ kind: "page", index: 1, text: "规则正文" }],
      body: Buffer.from("%PDF rules"),
    });
    const retained = await persistAttachment(db.pool, {
      noticeId,
      noticeVersion,
      url: `https://${source.host}/files/form.docx`,
      mediaType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      extractorVersion: "docx-1",
      status: "extracted",
      segments: [{ kind: "paragraph", index: 1, text: "报名表" }],
      body: Buffer.from("docx body"),
    });
    const setFetchedAt = (id: string, value: Date) =>
      db.pool.query(
        "UPDATE ingestion_attachment_versions SET fetched_at=$2 WHERE id=$1",
        [id, value],
      );

    await setFetchedAt(
      expired.versionId,
      new Date(clock.getTime() - 30 * DAY - 1),
    );
    // 正好到期（30 天）必须保留，只有严格超期的一条被清理。
    await setFetchedAt(
      retained.versionId,
      new Date(clock.getTime() - 30 * DAY),
    );
    expect(await cleanupAttachmentBodies(db.pool, 30, clock)).toEqual({
      removed: 1,
    });

    const cleaned = await getAttachmentVersion(
      db.pool,
      expired.attachmentId,
      expired.versionId,
    );
    // 版本元数据、sha256 与已提取文本继续可读。
    expect(cleaned).toMatchObject({
      status: "extracted",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(cleaned?.segments).toEqual([
      { kind: "page", index: 1, text: "规则正文" },
    ]);
    expect(
      (
        await db.pool.query<{ cleaned: boolean }>(
          "SELECT body IS NULL AS cleaned FROM ingestion_attachment_versions WHERE id=$1",
          [expired.versionId],
        )
      ).rows[0].cleaned,
    ).toBe(true);
    expect(
      await listAttachmentVersions(db.pool, expired.attachmentId),
    ).toHaveLength(1);
    expect(
      await listAttachmentVersions(db.pool, retained.attachmentId),
    ).toHaveLength(1);
    expect(
      (
        await db.pool.query<{ kept: boolean }>(
          "SELECT body IS NOT NULL AS kept FROM ingestion_attachment_versions WHERE id=$1",
          [retained.versionId],
        )
      ).rows[0].kept,
    ).toBe(true);

    // 清理后不能用旧字节重新解析，错误信息指向受控重新获取。
    await expect(
      reparseExistingAttachment(
        db.pool,
        expired.attachmentId,
        expired.versionId,
        {
          mediaType: "application/pdf",
          extractorVersion: "pdf-2",
          status: "extracted",
          segments: [{ kind: "page", index: 1, text: "重解析" }],
        },
      ),
    ).rejects.toThrow("字节已清理");
    // 重复清理幂等。
    expect(await cleanupAttachmentBodies(db.pool, 30, clock)).toEqual({
      removed: 0,
    });
  });

  it("清理不影响已批准材料、映射与正式比赛", async () => {
    const id = await candidateId();
    // 先写入附件（含已超期的一条），再完成审核与导入：附件写入会推进证据修订，
    // 放在审批之后会按规定使旧批准失效，那是正确行为，但不属于本用例要验证的清理边界。
    await persistAttachment(db.pool, {
      noticeId,
      noticeVersion,
      url: `https://${source.host}/files/history.pdf`,
      mediaType: "application/pdf",
      extractorVersion: "pdf-1",
      status: "extracted",
      segments: [{ kind: "page", index: 1, text: "历史规则" }],
      body: Buffer.from("%PDF history"),
    });
    const file = correctedReview(await exportReview(db.pool, id));
    await approveReview(db.pool, file, "maintainer");
    await applyReview(db.pool, file, "maintainer");
    // 发布基线必须从导入之后重新导出；导出会重算正式目录的基线哈希。
    const publication = await exportReview(db.pool, id);
    await publishImported(db.pool, id, "maintainer", publication.baseline);
    expect(
      (
        await db.pool.query<{ status: string }>(
          "SELECT status FROM ingestion_candidates WHERE id=$1",
          [id],
        )
      ).rows[0].status,
    ).toBe("imported");
    expect(
      (
        await db.pool.query<{ publication: string }>(
          "SELECT publication FROM competitions WHERE id=$1",
          [file.targetId],
        )
      ).rows[0].publication,
    ).toBe("published");

    await db.pool.query(
      "UPDATE ingestion_attachment_versions SET fetched_at=$1 WHERE body IS NOT NULL",
      [new Date(clock.getTime() - 31 * DAY)],
    );
    await db.pool.query("UPDATE ingestion_versions SET fetched_at=$1", [
      new Date(clock.getTime() - 31 * DAY),
    ]);
    expect(await cleanupAttachmentBodies(db.pool, 30, clock)).toEqual({
      removed: 1,
    });
    expect(await cleanupResponses(db.pool, 30, clock)).toEqual({ removed: 1 });

    // 人工结果、映射、审核历史与正式发布状态全部保留。
    expect(
      (
        await db.pool.query<{ status: string }>(
          "SELECT status FROM ingestion_candidates WHERE id=$1",
          [id],
        )
      ).rows[0].status,
    ).toBe("imported");
    expect(
      await count("SELECT count(*)::int AS total FROM ingestion_mappings"),
    ).toBe(1);
    expect(
      (
        await db.pool.query<{ publication: string }>(
          "SELECT publication FROM competitions WHERE id=$1",
          [file.targetId],
        )
      ).rows[0].publication,
    ).toBe("published");
    // 审核与操作的审计记录同样保留（批准/导入/发布均写入 ingestion_operations）。
    expect(
      (
        await db.pool.query<{ kinds: string }>(
          "SELECT string_agg(kind, ',' ORDER BY kind) AS kinds FROM ingestion_operations WHERE candidate_id=$1",
          [id],
        )
      ).rows[0].kinds,
    ).toBe("approve,import,publish");
  });

  it("清理参数越界与数据库失败不产生虚假成功", async () => {
    for (const days of [0, 366, 1.5, -1]) {
      await expect(cleanupResponses(db.pool, days, clock)).rejects.toThrow(
        "1–365",
      );
      await expect(
        cleanupAttachmentBodies(db.pool, days, clock),
      ).rejects.toThrow("1–365");
    }
    // 无效参照时间不能退化成「用数据库 now() 照常清理」。
    await expect(
      cleanupResponses(db.pool, 30, new Date("invalid")),
    ).rejects.toThrow("清理参照时间无效");
    await expect(
      cleanupAttachmentBodies(db.pool, 30, new Date("invalid")),
    ).rejects.toThrow("清理参照时间无效");
    // 权限/数据库失败必须抛出，而不是返回 removed=0 的虚假成功。
    const failing = {
      query: () =>
        Promise.reject(
          Object.assign(
            new Error("permission denied for table ingestion_versions"),
            {
              code: "42501",
            },
          ),
        ),
    };
    await expect(cleanupResponses(failing as never, 30, clock)).rejects.toThrow(
      "permission denied",
    );
    await expect(
      cleanupAttachmentBodies(failing as never, 30, clock),
    ).rejects.toThrow("permission denied");
  });
});
