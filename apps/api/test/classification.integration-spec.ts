import { testDatabase, directory } from "./competition-fixture.js";
import {
  initializeSources,
  persistArticle,
  transaction,
  hash,
} from "../src/ingestion/store.js";
import { refreshExtraction } from "../src/ingestion/extraction-store.js";
import {
  parseCandidate,
  sources,
  noticeRuleVersion,
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
  it("v6 已批准候选使用当前规则重提取，保留旧结果并撤销批准", async () => {
    const url = `https://${sources[0].host}/info/1043/203.htm`;
    const text = "个人或团队均可，不得跨学院组队。";
    const article: Article = {
      title: "2026年数学竞赛报名通知",
      publishedAt: null,
      text,
      paragraphs: [text, "报名截止：2026年11月1日。"],
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
    const stored = (
      await db.pool.query(
        `SELECT c.data,n.latest_version,n.evidence_revision
       FROM ingestion_candidates c JOIN ingestion_notices n ON n.id=c.notice_id WHERE c.id=$1`,
        [saved.candidateId],
      )
    ).rows[0];
    // 固定历史 v6 的错误输出，不调用新解析器冒充旧实现。
    stored.data.fields.modeKind = "individual";
    stored.data.classification.ruleVersion = "competition-rules-6";
    const oldKey = hash({
      sourceVersion: stored.latest_version,
      evidenceRevision: stored.evidence_revision,
      ruleVersion: "competition-rules-6",
    });
    await db.pool.query(
      "UPDATE ingestion_candidates SET data=$2,rule_version=$3,extraction_key=$4 WHERE id=$1",
      [saved.candidateId, stored.data, "competition-rules-6", oldKey],
    );
    await db.pool.query(
      "UPDATE ingestion_extraction_revisions SET data=$2,rule_version=$3,extraction_key=$4 WHERE candidate_id=$1",
      [saved.candidateId, stored.data, "competition-rules-6", oldKey],
    );
    const review = correctedReview(
      await exportReview(db.pool, saved.candidateId!),
    );
    await approveReview(db.pool, review, "maintainer");
    await transaction(db.pool, (client) =>
      refreshExtraction(client, saved.noticeId),
    );
    const current = (
      await db.pool.query(
        "SELECT data,status,approved_file,rule_version FROM ingestion_candidates WHERE id=$1",
        [saved.candidateId],
      )
    ).rows[0];
    expect(current.data.fields.modeKind).toBe("mixed");
    expect(current).toMatchObject({
      status: "pending",
      approved_file: null,
      rule_version: noticeRuleVersion,
    });
    const history = (
      await db.pool.query(
        "SELECT data FROM ingestion_extraction_revisions WHERE candidate_id=$1 AND rule_version='competition-rules-6'",
        [saved.candidateId],
      )
    ).rows;
    expect(history).toHaveLength(1);
    expect(history[0].data.fields.modeKind).toBe("individual");
    const approval = (
      await db.pool.query(
        "SELECT result->'review' AS review FROM ingestion_operations WHERE candidate_id=$1 AND kind='approve'",
        [saved.candidateId],
      )
    ).rows[0].review;
    expect(approval).toEqual(review);
  });
  it("v8 判疑似的执裁回顾按当前规则重算为非赛事，旧批准失效且历史保留", async () => {
    // #205：v8 把「执裁回顾」这类通知判为 suspected/registration 并进入队列；
    // 生产候选是按旧规则落库的完整正文，重算只能依赖已有快照，不能重新抓取。
    const url = `https://${sources[0].host}/info/1043/205.htm`;
    const paragraphs = [
      "2026年10月18日，第四届川东北武术套路公开赛在南充市体育中心举行。",
      "体育学院武术队受邀承担本次比赛裁判工作，圆满完成执裁任务。",
      "比赛设男子长拳、女子南拳等12个项目，共有9支代表队参赛。",
    ];
    const article: Article = {
      title: "体育学院武术队受邀执裁第四届川东北武术套路公开赛",
      publishedAt: "2026-10-20",
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
    // 恢复被裁掉的正文，模拟 v8 时期落库的完整快照。
    await db.pool.query(
      "UPDATE ingestion_versions SET article=$2 WHERE notice_id=$1",
      [saved.noticeId, article],
    );
    const stored = (
      await db.pool.query("SELECT data FROM ingestion_candidates WHERE id=$1", [
        saved.candidateId,
      ])
    ).rows[0].data;
    // 固定 v8 的历史输出，不调用新解析器冒充旧实现。
    stored.classification = {
      ...stored.classification,
      classification: "suspected",
      notificationKind: "registration",
      ruleVersion: "competition-rules-8",
      reasons: ["原文含赛事标识"],
      exclusions: [],
      needsReview: true,
      priority: 2,
    };
    const oldKey = hash({
      sourceVersion: (
        await db.pool.query(
          "SELECT latest_version FROM ingestion_notices WHERE id=$1",
          [saved.noticeId],
        )
      ).rows[0].latest_version,
      evidenceRevision: (
        await db.pool.query(
          "SELECT evidence_revision FROM ingestion_notices WHERE id=$1",
          [saved.noticeId],
        )
      ).rows[0].evidence_revision,
      ruleVersion: "competition-rules-8",
    });
    await db.pool.query(
      "UPDATE ingestion_candidates SET data=$2,classification='suspected',priority=2,needs_review=true,rule_version='competition-rules-8',extraction_key=$3 WHERE id=$1",
      [saved.candidateId, stored, oldKey],
    );
    await db.pool.query(
      "UPDATE ingestion_extraction_revisions SET data=$2,rule_version='competition-rules-8',extraction_key=$3 WHERE candidate_id=$1",
      [saved.candidateId, stored, oldKey],
    );
    const review = correctedReview(
      await exportReview(db.pool, saved.candidateId!),
    );
    await approveReview(db.pool, review, "maintainer");
    expect(
      (
        await db.pool.query(
          "SELECT status,approved_file IS NOT NULL AS approved FROM ingestion_candidates WHERE id=$1",
          [saved.candidateId],
        )
      ).rows[0],
    ).toEqual({ status: "approved", approved: true });
    await transaction(db.pool, (client) =>
      refreshExtraction(client, saved.noticeId),
    );
    const current = (
      await db.pool.query(
        "SELECT classification,priority,needs_review,status,approved_file,rule_version,data FROM ingestion_candidates WHERE id=$1",
        [saved.candidateId],
      )
    ).rows[0];
    expect(current).toMatchObject({
      classification: "non_competition",
      priority: 3,
      needs_review: false,
      status: "pending",
      approved_file: null,
      rule_version: noticeRuleVersion,
    });
    // 排除理由随候选一起保存，审核人员能看到为什么被判非赛事。
    expect(current.data.classification.exclusions).toContainEqual(
      expect.stringContaining("执裁实践"),
    );
    // v8 的提取历史与已批准材料都保留，只撤销当前批准。
    const history = (
      await db.pool.query(
        "SELECT rule_version,data FROM ingestion_extraction_revisions WHERE candidate_id=$1 ORDER BY created_at",
        [saved.candidateId],
      )
    ).rows;
    expect(history.map((row) => row.rule_version)).toContain(
      "competition-rules-8",
    );
    expect(
      (
        await db.pool.query(
          "SELECT result->'review' AS review FROM ingestion_operations WHERE candidate_id=$1 AND kind='approve'",
          [saved.candidateId],
        )
      ).rows[0].review,
    ).toEqual(review);
  });
  it("含执裁措辞的真实参赛通知按赛事保留正文，不被非赛事裁剪", async () => {
    // 回归：v9 早期把「执裁及竞赛规程」判成实践回顾并清空正文与附件；
    // 这类通知正文有参赛对象与报名截止，是真实参赛通知，必须按赛事持久化。
    const url = `https://${sources[0].host}/info/1043/205b.htm`;
    const paragraphs = ["参赛对象：全校本科生。", "报名截止：2026年11月15日。"];
    const article: Article = {
      title: "2026年校园武术套路公开赛执裁及竞赛规程",
      publishedAt: "2026-10-25",
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
    const row = (
      await db.pool.query(
        "SELECT classification,priority,needs_review,rule_version FROM ingestion_candidates WHERE id=$1",
        [saved.candidateId],
      )
    ).rows[0];
    expect(row).toMatchObject({
      classification: "definite",
      priority: 0,
      needs_review: true,
      rule_version: noticeRuleVersion,
    });
    // 正文没有被非赛事分支裁剪，报名截止仍可提取。
    const snapshot = (
      await db.pool.query(
        "SELECT article FROM ingestion_versions WHERE notice_id=$1",
        [saved.noticeId],
      )
    ).rows[0].article;
    expect(snapshot.paragraphs).toEqual(paragraphs);
    const review = await exportReview(db.pool, saved.candidateId!);
    expect(review.candidate.fieldsV2.deadline).toEqual({
      precision: "date",
      value: "2026-11-15",
    });
  });
  it.each([
    {
      suffix: "205c",
      title: "2026年校园武术公开赛执裁工作安排",
      paragraphs: [
        "我院受邀担任本次比赛裁判。比赛时间：2026年11月20日；各学院请于11月15日前报名。",
      ],
      classification: "definite",
      priority: 0,
    },
    {
      suffix: "205d",
      title: "关于招募2026年院级篮球赛队员的通知",
      paragraphs: ["本次篮球比赛面向全院本科生，报名截止：2026年11月15日。"],
      classification: "suspected",
      priority: 2,
    },
  ])("$title 入库后保留复核通道与正文附件", async (item) => {
    const url = `https://${sources[0].host}/info/1043/${item.suffix}.htm`;
    const article: Article = {
      title: item.title,
      publishedAt: "2026-10-25",
      text: item.paragraphs.join("\n"),
      paragraphs: item.paragraphs,
      attachments: [
        {
          title: "报名表.docx",
          url: `https://${sources[0].host}/forms/${item.suffix}.docx`,
        },
      ],
    };
    const saved = await persistArticle(
      db.pool,
      sources[0],
      url,
      { url, html: "", body: new Uint8Array(), status: 200, headers: {} },
      article,
      parseCandidate(article, url, directory!),
    );
    const review = await exportReview(db.pool, saved.candidateId!);
    expect(review.candidate.classification).toMatchObject({
      classification: item.classification,
      notificationKind: "registration",
      needsReview: true,
      priority: item.priority,
    });
    const snapshot = (
      await db.pool.query(
        "SELECT article FROM ingestion_versions WHERE notice_id=$1",
        [saved.noticeId],
      )
    ).rows[0].article;
    expect(snapshot.paragraphs).toEqual(article.paragraphs);
    expect(snapshot.attachments).toEqual(article.attachments);
  });
  it("执裁回顾裁剪正文后仍保留同版本分类，重复提取不抬回疑似", async () => {
    const url = `https://${sources[0].host}/info/1043/205e.htm`;
    const article: Article = {
      title: "体育学院武术队受邀执裁第四届川东北武术套路公开赛",
      publishedAt: "2026-10-20",
      text: "体育学院武术队圆满完成执裁任务。",
      paragraphs: ["体育学院武术队圆满完成执裁任务。"],
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
    const assertRecap = async () => {
      const review = await exportReview(db.pool, saved.candidateId!);
      expect(review.candidate.classification).toMatchObject({
        classification: "non_competition",
        notificationKind: "news",
        needsReview: false,
        priority: 3,
        ruleVersion: noticeRuleVersion,
      });
      expect(review.candidate.classification!.exclusions).toContainEqual(
        expect.stringContaining("执裁实践"),
      );
    };
    await assertRecap();
    const snapshot = (
      await db.pool.query(
        "SELECT article FROM ingestion_versions WHERE notice_id=$1",
        [saved.noticeId],
      )
    ).rows[0].article;
    expect(snapshot).toMatchObject({
      text: "",
      paragraphs: [],
      attachments: [],
    });
    // 不新增来源正文，只改变证据修订号，强制走同版本的再次重提取。
    await db.pool.query(
      "UPDATE ingestion_notices SET evidence_revision=evidence_revision+1 WHERE id=$1",
      [saved.noticeId],
    );
    await transaction(db.pool, (client) =>
      refreshExtraction(client, saved.noticeId),
    );
    await assertRecap();
    // 规则发生变化时不能沿用旧版本的排除结论，缺少正文则重新进入复核。
    await transaction(db.pool, (client) =>
      refreshExtraction(client, saved.noticeId, "competition-rules-next"),
    );
    expect(
      (await exportReview(db.pool, saved.candidateId!)).candidate
        .classification,
    ).toMatchObject({
      classification: "suspected",
      needsReview: true,
      ruleVersion: "competition-rules-next",
    });
  });
  it("附件是唯一赛事线索时仍登记附件并沿同一候选链提取", async () => {
    const previous = process.env.INGESTION_ATTACHMENTS_ENABLED;
    process.env.INGESTION_ATTACHMENTS_ENABLED = "true";
    try {
      const url = `https://${sources[0].host}/info/1043/178.htm`;
      const attachmentUrl = `https://${sources[0].host}/system/_content/download.jsp?owner=176`;
      const article: Article = {
        title: "补充说明",
        publishedAt: null,
        text: "详细办理事项及相关要求请查阅本通知附件。",
        paragraphs: ["详细办理事项及相关要求请查阅本通知附件。"],
        attachments: [{ title: "数学竞赛延期通知.pdf", url: attachmentUrl }],
      };
      const saved = await persistArticle(
        db.pool,
        sources[0],
        url,
        { url, html: "", body: new Uint8Array(), status: 200, headers: {} },
        article,
        parseCandidate(article, url, directory!),
      );
      const snapshot = (
        await db.pool.query(
          "SELECT article FROM ingestion_versions WHERE notice_id=$1",
          [saved.noticeId],
        )
      ).rows[0].article;
      expect(snapshot.attachments).toHaveLength(1);
      expect(
        (
          await db.pool.query(
            "SELECT classification FROM ingestion_candidates WHERE id=$1",
            [saved.candidateId],
          )
        ).rows[0].classification,
      ).toBe("definite");
      await persistAttachment(db.pool, {
        noticeId: saved.noticeId,
        noticeVersion: (await exportReview(db.pool, saved.candidateId!))
          .sourceVersion,
        url: attachmentUrl,
        mediaType: "application/pdf",
        extractorVersion: "test",
        status: "extracted",
        segments: [
          {
            kind: "page",
            index: 1,
            text: "数学竞赛报名延期，报名截止：2026年11月8日。",
          },
        ],
        body: Buffer.from("rules178"),
      });
      const review = await exportReview(db.pool, saved.candidateId!);
      // 通知种类唯一来源是 classification；旧形状投影的 kind 也从这里取。
      expect(review.candidate.classification?.notificationKind).toBe(
        "supplement",
      );
      expect(review.candidate.fieldsV2).not.toHaveProperty("kind");
      // 旧形状投影的 kind 取通知种类。
      expect(
        (review.candidate.fields as unknown as { kind: string }).kind,
      ).toBe("supplement");
      expect(review.candidate.fieldsV2.deadline).toEqual({
        precision: "date",
        value: "2026-11-08",
      });
      expect(review.candidate.fieldsV2.modeKind).toBeNull();
      expect(review.evidenceReferences).toContainEqual(
        expect.objectContaining({ format: "pdf", page: 1, field: "deadline" }),
      );
    } finally {
      if (previous === undefined)
        delete process.env.INGESTION_ATTACHMENTS_ENABLED;
      else process.env.INGESTION_ATTACHMENTS_ENABLED = previous;
    }
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
      noticeRuleVersion,
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
    const checked = correctedReview(fresh);
    checked.batch.competitions![0].organizer = "隐私待擦除测试文本";
    await approveReview(db.pool, checked, "maintainer");
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
    const operations = (
      await db.pool.query(
        "SELECT result FROM ingestion_operations WHERE candidate_id=$1",
        [saved.candidateId],
      )
    ).rows;
    expect(JSON.stringify(operations)).not.toContain("隐私待擦除测试文本");
    // 候选当前数据与提取历史都不能留下原文（擦除后再提取会写回新的 v2 数据）。
    const redacted = (
      await db.pool.query("SELECT data FROM ingestion_candidates WHERE id=$1", [
        saved.candidateId,
      ])
    ).rows[0].data;
    expect(JSON.stringify(redacted)).not.toContain("隐私待擦除测试文本");
  });
});
