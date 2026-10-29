import { randomUUID } from "node:crypto";
import type { AuthTestApp } from "./auth-fixture.js";
import { authTestApp } from "./auth-fixture.js";
import { passwordHash } from "../src/admin/admin-security.js";
import { correctedReview } from "./ingestion-fixture.js";
import { informationArticle } from "./notice-fixtures.js";
import { directory, edition } from "./competition-fixture.js";
import { importBatch } from "../src/competitions/import.js";
import {
  extractArticle,
  parseCandidate,
  sources,
  type FetchResult,
} from "@hehuoda/sicau-connectors/notices";
import { initializeSources, persistArticle } from "../src/ingestion/store.js";
import { persistAttachment } from "../src/ingestion/attachment-store.js";

describe("管理员采集审核 HTTP 与 PostgreSQL 事务", () => {
  let test: AuthTestApp;
  const source = sources[0]!;
  const url = `https://${source.host}/info/1043/100.htm`;
  let adminId: string;

  beforeAll(async () => {
    test = await authTestApp();
  });

  afterAll(async () => {
    await test?.close();
  });

  beforeEach(async () => {
    await test.pool.query(
      "TRUNCATE ingestion_sources,colleges,competitions,admin_accounts CASCADE",
    );
    const salt = Buffer.alloc(16, 7);
    const password = await passwordHash("test-password", salt);
    const account = await test.pool.query<{ id: string }>(
      "INSERT INTO admin_accounts(username,display_name,password_salt,password_hash) VALUES('review-admin','审核管理员',$1,$2) RETURNING id",
      [salt, password],
    );
    adminId = account.rows[0]!.id;
    await initializeSources(test.pool);
    await importBatch(test.pool, { colleges: directory });
  });

  async function candidateId() {
    const article = extractArticle(informationArticle, url, source);
    const body = new TextEncoder().encode(informationArticle);
    const result: FetchResult = {
      url,
      status: 200,
      headers: {},
      body,
      html: informationArticle,
    };
    const saved = await persistArticle(
      test.pool,
      source,
      url,
      result,
      article,
      parseCandidate(article, url, directory!),
    );
    return saved.candidateId!;
  }

  async function session() {
    const login = await test.request(
      "POST",
      "admin/auth/login",
      { username: "review-admin", password: "test-password" },
      { origin: "http://localhost:5173" },
    );
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const csrf = (
      await test.request("GET", "admin/auth/csrf", undefined, { cookie })
    ).json().csrfToken as string;
    return {
      cookie,
      csrf,
      headers: {
        cookie,
        origin: "http://localhost:5173",
        "x-csrf-token": csrf,
      },
    };
  }

  it("队列按报名、其他明确、疑似、非赛事排序，学院/栏目/附件筛选可组合", async () => {
    const auth = await session();
    const ids: string[] = [];
    for (const [index, title] of [
      "数学竞赛报名通知",
      "数学竞赛新闻回顾",
      "作品征集",
      "图书馆开放通知",
    ].entries()) {
      const targetUrl = `https://${source.host}/info/1043/${index + 200}.htm`;
      const article = {
        title,
        publishedAt: null,
        text: "请核对本次通知的具体安排和规则。",
        paragraphs: ["请核对本次通知的具体安排和规则。"],
        attachments: [],
      };
      const saved = await persistArticle(
        test.pool,
        source,
        targetUrl,
        {
          url: targetUrl,
          body: new Uint8Array(),
          html: "",
          status: 200,
          headers: {},
        },
        article,
        parseCandidate(article, targetUrl, directory!),
        source.defaultChannelId,
      );
      ids.push(saved.candidateId!);
    }
    const list = async (query = "") =>
      test.request("GET", "admin/ingestion/candidates" + query, undefined, {
        cookie: auth.cookie,
      });
    expect(
      (await list())
        .json()
        .items.map((item: { candidateId: string }) => item.candidateId),
    ).toEqual(ids);
    expect((await list()).json().counts).toEqual({
      definite: 2,
      suspected: 1,
      non_competition: 1,
    });
    expect(
      (
        await list(
          `?collegeId=${source.collegeId}&channelId=${source.defaultChannelId}&status=pending`,
        )
      ).json().total,
    ).toBe(4);
    expect((await list("?collegeId=missing")).json().total).toBe(0);
    const original = (
      await test.request(
        "GET",
        `admin/ingestion/candidates/${ids[0]}`,
        undefined,
        { cookie: auth.cookie },
      )
    ).json();
    await persistAttachment(test.pool, {
      noticeId: original.noticeId,
      noticeVersion: original.sourceVersion,
      url: `https://${source.host}/r.pdf`,
      mediaType: "application/pdf",
      extractorVersion: "test",
      status: "extracted",
      segments: [{ kind: "page", index: 1, text: "报名截止：2026年11月1日。" }],
      body: Buffer.from("rules"),
    });
    expect(
      (
        await list(
          "?attachmentStatus=extracted&classification=definite&needsReview=true",
        )
      )
        .json()
        .items.map((item: { candidateId: string }) => item.candidateId),
    ).toEqual([ids[0]]);
    expect((await list("?pageSize=51")).statusCode).toBe(400);
  });

  it("分类独立于审核状态，权限、幂等、旧基线、筛选与数量均有契约", async () => {
    const id = await candidateId();
    const auth = await session();
    const path = `admin/ingestion/candidates/${id}`;
    const get = async () =>
      (
        await test.request("GET", path, undefined, { cookie: auth.cookie })
      ).json();
    const original = await get();
    const command = {
      operationId: randomUUID(),
      baseline: original.baseline,
      reason: "核对原文后判为非赛事",
      classification: "non_competition",
    };
    expect(
      (await test.request("POST", path + "/classification", command))
        .statusCode,
    ).toBe(403);
    const changed = await test.request(
      "POST",
      path + "/classification",
      command,
      auth.headers,
    );
    expect(changed.statusCode).toBe(200);
    expect(await get()).toMatchObject({
      classification: "non_competition",
      status: "pending",
      candidateRevision: original.candidateRevision + 1,
    });
    const nonCompetitionReview = correctedReview(
      (
        await test.request("GET", path + "/review", undefined, {
          cookie: auth.cookie,
        })
      ).json(),
    );
    expect(
      (
        await test.request(
          "POST",
          path + "/approve",
          {
            operationId: randomUUID(),
            reason: "非赛事需先修改分类",
            review: nonCompetitionReview,
          },
          auth.headers,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await test.request(
          "POST",
          path + "/classification",
          command,
          auth.headers,
        )
      ).json(),
    ).toEqual(changed.json());
    expect(
      (
        await test.request(
          "POST",
          path + "/classification",
          { ...command, classification: "suspected" },
          auth.headers,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await test.request(
          "POST",
          path + "/classification",
          { ...command, operationId: randomUUID() },
          auth.headers,
        )
      ).statusCode,
    ).toBe(409);
    const filtered = await test.request(
      "GET",
      "admin/ingestion/candidates?classification=non_competition&needsReview=false&kind=registration",
      undefined,
      { cookie: auth.cookie },
    );
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json()).toMatchObject({
      total: 1,
      counts: { non_competition: 1 },
    });
    expect(filtered.json().items[0]).toMatchObject({
      candidateId: id,
      priority: 3,
      ruleVersion: "competition-rules-1",
    });
    expect(
      (
        await test.request(
          "GET",
          "admin/ingestion/candidates?needsReview=garbage",
          undefined,
          { cookie: auth.cookie },
        )
      ).statusCode,
    ).toBe(400);
    const current = await get();
    expect(
      (
        await test.request(
          "POST",
          path + "/classification",
          {
            ...command,
            operationId: randomUUID(),
            baseline: current.baseline,
            classification: "suspected",
          },
          auth.headers,
        )
      ).statusCode,
    ).toBe(200);
    expect(await get()).toMatchObject({
      classification: "suspected",
      status: "pending",
    });
  });

  it("保存审核修订、批准、预览、导入和发布按同一材料逐步完成", async () => {
    const id = await candidateId();
    const auth = await session();
    const exported = (
      await test.request(
        "GET",
        `admin/ingestion/candidates/${id}/review`,
        undefined,
        {
          cookie: auth.cookie,
        },
      )
    ).json();
    const review = correctedReview(exported);
    const saveCommand = {
      operationId: randomUUID(),
      reason: "根据来源原文完成字段核对",
      review,
    };
    const save = await test.request(
      "PUT",
      `admin/ingestion/candidates/${id}/review`,
      saveCommand,
      auth.headers,
    );
    expect(save.statusCode).toBe(200);
    expect(save.json()).toMatchObject({
      status: "pending",
      candidateRevision: 2,
    });
    expect(save.json().review.resolution).toBe(review.resolution);
    expect(
      (
        await test.request(
          "GET",
          `admin/ingestion/candidates/${id}/review`,
          undefined,
          {
            cookie: auth.cookie,
          },
        )
      ).json().batch,
    ).toEqual(review.batch);

    const reusedAcrossActions = await test.request(
      "POST",
      `admin/ingestion/candidates/${id}/approve`,
      { ...saveCommand, review: save.json().review },
      auth.headers,
    );
    expect(reusedAcrossActions.statusCode).toBe(409);

    const approvedFile = save.json().review;
    const approveCommand = {
      operationId: randomUUID(),
      reason: "复核字段、证据与目标记录基线",
      review: approvedFile,
    };
    const approve = await test.request(
      "POST",
      `admin/ingestion/candidates/${id}/approve`,
      approveCommand,
      auth.headers,
    );
    expect(approve.statusCode).toBe(200);
    expect(approve.json().status).toBe("approved");

    const reloaded = (
      await test.request(
        "GET",
        `admin/ingestion/candidates/${id}/review`,
        undefined,
        {
          cookie: auth.cookie,
        },
      )
    ).json();
    expect(reloaded.operationId).toBe(approvedFile.operationId);
    const preview = await test.request(
      "POST",
      `admin/ingestion/candidates/${id}/import-preview`,
      {
        operationId: randomUUID(),
        reason: "检查导入差异",
        review: approvedFile,
      },
      auth.headers,
    );
    expect(preview.statusCode).toBe(200);
    expect(preview.json().previewId).toBeDefined();
    const alteredReview = {
      ...approvedFile,
      resolution: "预览后被改写的审核结论",
    };
    const alteredImport = await test.request(
      "POST",
      `admin/ingestion/candidates/${id}/import`,
      {
        operationId: randomUUID(),
        reason: "验证预览材料绑定",
        previewId: preview.json().previewId,
        review: alteredReview,
      },
      auth.headers,
    );
    expect(alteredImport.statusCode).toBe(409);
    expect(
      (
        await test.request(
          "GET",
          `admin/ingestion/candidates/${id}`,
          undefined,
          {
            cookie: auth.cookie,
          },
        )
      ).json().status,
    ).toBe("approved");

    const imported = await test.request(
      "POST",
      `admin/ingestion/candidates/${id}/import`,
      {
        operationId: randomUUID(),
        reason: "按已核对预览写入正式草稿",
        previewId: preview.json().previewId,
        review: approvedFile,
      },
      auth.headers,
    );
    expect(imported.statusCode).toBe(200);
    expect(imported.json().preview).toBe(false);
    const reusedPreview = await test.request(
      "POST",
      `admin/ingestion/candidates/${id}/import`,
      {
        operationId: randomUUID(),
        reason: "验证预览回执只能使用一次",
        previewId: preview.json().previewId,
        review: approvedFile,
      },
      auth.headers,
    );
    expect(reusedPreview.statusCode).toBe(409);

    const publishReview = (
      await test.request(
        "GET",
        `admin/ingestion/candidates/${id}/review`,
        undefined,
        {
          cookie: auth.cookie,
        },
      )
    ).json();
    const reapproval = await test.request(
      "POST",
      `admin/ingestion/candidates/${id}/approve`,
      {
        operationId: randomUUID(),
        reason: "已导入候选不能借重新批准绕过拒绝限制",
        review: correctedReview(publishReview),
      },
      auth.headers,
    );
    expect(reapproval.statusCode).toBe(409);
    const publishCommand = {
      operationId: randomUUID(),
      reason: "核对发布目标及正式数据基线",
      sourceVersion: publishReview.sourceVersion,
      candidateRevision: publishReview.candidateRevision,
      baseline: publishReview.baseline,
    };
    const publishPreview = await test.request(
      "POST",
      `admin/ingestion/candidates/${id}/publish-preview`,
      publishCommand,
      auth.headers,
    );
    expect(publishPreview.statusCode).toBe(200);
    const published = await test.request(
      "POST",
      `admin/ingestion/candidates/${id}/publish`,
      {
        ...publishCommand,
        operationId: randomUUID(),
        previewId: publishPreview.json().previewId,
        confirm: true,
      },
      auth.headers,
    );
    expect(published.statusCode).toBe(200);
    const publicRecord = await test.request(
      "GET",
      `competitions/${approvedFile.targetId}`,
    );
    expect(publicRecord.statusCode).toBe(200);
    expect(publicRecord.json()).toMatchObject({ id: approvedFile.targetId });
    expect(publicRecord.json().name).toBeTruthy();

    const history = await test.request(
      "GET",
      `admin/ingestion/candidates/${id}/operations?page=1&pageSize=10`,
      undefined,
      { cookie: auth.cookie },
    );
    expect(history.statusCode).toBe(200);
    expect(
      history.json().items.map((item: { kind: string }) => item.kind),
    ).toEqual(["revise", "approve", "preview", "import", "publish"]);
    const adminAudit = await test.request(
      "GET",
      "admin/operations?action=competition.publish",
      undefined,
      { cookie: auth.cookie },
    );
    expect(adminAudit.statusCode).toBe(200);
    expect(
      adminAudit
        .json()
        .items.some((item: { actorId: string }) => item.actorId === adminId),
    ).toBe(true);
  });

  it("拒绝伪造证据和过期修订，并以显式重开恢复待审核状态", async () => {
    const id = await candidateId();
    const auth = await session();
    const review = correctedReview(
      (
        await test.request(
          "GET",
          `admin/ingestion/candidates/${id}/review`,
          undefined,
          {
            cookie: auth.cookie,
          },
        )
      ).json(),
    );
    const forged = structuredClone(review) as typeof review & {
      source: { injected?: string };
    };
    forged.source.injected = "伪造来源元数据";
    const rejected = await test.request(
      "PUT",
      `admin/ingestion/candidates/${id}/review`,
      { operationId: randomUUID(), reason: "测试只读证据保护", review: forged },
      auth.headers,
    );
    expect(rejected.statusCode).toBe(422);

    const saveCommand = {
      operationId: randomUUID(),
      reason: "保存人工修订",
      review,
    };
    const saved = await test.request(
      "PUT",
      `admin/ingestion/candidates/${id}/review`,
      saveCommand,
      auth.headers,
    );
    expect(saved.statusCode).toBe(200);
    const stale = await test.request(
      "PUT",
      `admin/ingestion/candidates/${id}/review`,
      { operationId: randomUUID(), reason: "提交旧材料", review },
      auth.headers,
    );
    expect(stale.statusCode).toBe(409);

    const candidate = (
      await test.request("GET", `admin/ingestion/candidates/${id}`, undefined, {
        cookie: auth.cookie,
      })
    ).json();
    const decision = {
      operationId: randomUUID(),
      reason: "确认候选不适合导入",
      sourceVersion: candidate.sourceVersion,
      candidateRevision: candidate.candidateRevision,
      baseline: candidate.baseline,
    };
    const rejectedCandidate = await test.request(
      "POST",
      `admin/ingestion/candidates/${id}/reject`,
      decision,
      auth.headers,
    );
    expect(rejectedCandidate.statusCode).toBe(200);
    expect(rejectedCandidate.json().status).toBe("rejected");
    const afterReject = (
      await test.request("GET", `admin/ingestion/candidates/${id}`, undefined, {
        cookie: auth.cookie,
      })
    ).json();
    const reopened = await test.request(
      "POST",
      `admin/ingestion/candidates/${id}/reopen`,
      {
        operationId: randomUUID(),
        reason: "收到补充证据后重新核对",
        sourceVersion: afterReject.sourceVersion,
        candidateRevision: afterReject.candidateRevision,
        baseline: afterReject.baseline,
      },
      auth.headers,
    );
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json().status).toBe("pending");
  });

  it("人工修订历史按分页返回原材料、可信操作者与理由，后续修订不覆盖历史", async () => {
    const id = await candidateId();
    const auth = await session();
    const file = correctedReview(
      (
        await test.request(
          "GET",
          `admin/ingestion/candidates/${id}/review`,
          undefined,
          { cookie: auth.cookie },
        )
      ).json(),
    );
    const first = await test.request(
      "PUT",
      `admin/ingestion/candidates/${id}/review`,
      { operationId: randomUUID(), reason: "第一次核对", review: file },
      auth.headers,
    );
    expect(first.statusCode).toBe(200);
    const changed = structuredClone(first.json().review);
    changed.batch.competitions[0].name = "复核后的比赛名称";
    const next = await test.request(
      "PUT",
      `admin/ingestion/candidates/${id}/review`,
      { operationId: randomUUID(), reason: "纠正比赛名称", review: changed },
      auth.headers,
    );
    expect(next.statusCode).toBe(200);
    const history = await test.request(
      "GET",
      `admin/ingestion/candidates/${id}/operations?page=1&pageSize=1`,
      undefined,
      { cookie: auth.cookie },
    );
    expect(history.json()).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(history.json().items[0]).toMatchObject({
      kind: "revise",
      reviewer: adminId,
      candidateRevision: 2,
      result: {
        reason: "第一次核对",
        batch: file.batch,
        checkedAt: file.checkedAt,
        resolution: file.resolution,
      },
    });
    expect(history.json().items[0].result).not.toHaveProperty("article");
    const second = await test.request(
      "GET",
      `admin/ingestion/candidates/${id}/operations?page=2&pageSize=1`,
      undefined,
      { cookie: auth.cookie },
    );
    expect(second.json().items[0]).toMatchObject({
      kind: "revise",
      reviewer: adminId,
      candidateRevision: 3,
      result: { reason: "纠正比赛名称" },
    });
    expect(second.json().items[0].result.batch.competitions[0].name).toBe(
      "复核后的比赛名称",
    );
  });

  it("已批准后来源元信息变化时重读提供新证据，不永久返回过期批准材料", async () => {
    const id = await candidateId();
    const auth = await session();
    const file = correctedReview(
      (
        await test.request(
          "GET",
          `admin/ingestion/candidates/${id}/review`,
          undefined,
          { cookie: auth.cookie },
        )
      ).json(),
    );
    expect(
      (
        await test.request(
          "POST",
          `admin/ingestion/candidates/${id}/approve`,
          { operationId: randomUUID(), reason: "核对原来源证据", review: file },
          auth.headers,
        )
      ).statusCode,
    ).toBe(200);
    await test.pool.query(
      "UPDATE ingestion_notices SET health='unavailable' WHERE id=(SELECT notice_id FROM ingestion_candidates WHERE id=$1)",
      [id],
    );
    const refreshed = await test.request(
      "GET",
      `admin/ingestion/candidates/${id}/review`,
      undefined,
      { cookie: auth.cookie },
    );
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().source.health).toBe("unavailable");
    expect(refreshed.json().operationId).not.toBe(file.operationId);
  });

  it("正式映射关系在导出后变化时拒绝旧审核材料", async () => {
    const id = await candidateId();
    const auth = await session();
    await importBatch(test.pool, { competitions: [edition("mapped-target")] });
    await test.pool.query(
      "INSERT INTO ingestion_mappings(candidate_id,competition_id,stage_ids,notice_ids,track_ids) VALUES($1,'mapped-target','[\"mapped-target-stage\"]'::jsonb,'[\"mapped-target-notice\"]'::jsonb,'[\"mapped-target-track\"]'::jsonb)",
      [id],
    );
    const exported = await test.request(
      "GET",
      `admin/ingestion/candidates/${id}/review?targetId=mapped-target`,
      undefined,
      { cookie: auth.cookie },
    );
    expect(exported.statusCode).toBe(200);
    const review = correctedReview(exported.json());
    await test.pool.query(
      "UPDATE ingestion_mappings SET stage_ids='[\"changed-stage\"]'::jsonb WHERE candidate_id=$1",
      [id],
    );
    const saved = await test.request(
      "PUT",
      `admin/ingestion/candidates/${id}/review`,
      { operationId: randomUUID(), reason: "验证正式映射过期保护", review },
      auth.headers,
    );
    expect(saved.statusCode).toBe(409);
  });

  it("通知版本分页与差异只返回解析后的纯文本，不暴露原始响应", async () => {
    const id = await candidateId();
    const auth = await session();
    const notice = (
      await test.request("GET", `admin/ingestion/candidates/${id}`, undefined, {
        cookie: auth.cookie,
      })
    ).json().noticeId as string;
    const versions = await test.request(
      "GET",
      `admin/ingestion/notices/${notice}/versions?page=1&pageSize=1`,
      undefined,
      { cookie: auth.cookie },
    );
    expect(versions.statusCode).toBe(200);
    expect(versions.json()).toMatchObject({ total: 1, page: 1, pageSize: 1 });
    const versionId = versions.json().items[0].versionId as string;
    const detail = await test.request(
      "GET",
      `admin/ingestion/notices/${notice}/versions/${versionId}`,
      undefined,
      { cookie: auth.cookie },
    );
    expect(detail.statusCode).toBe(200);
    expect(detail.json().article.text).not.toContain("危险脚本");
    expect(detail.json()).not.toHaveProperty("rawResponse");
    expect(detail.json()).not.toHaveProperty("html");
  });
});
