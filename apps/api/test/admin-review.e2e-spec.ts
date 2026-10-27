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
    ).toEqual(["approve", "preview", "import", "publish"]);
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
