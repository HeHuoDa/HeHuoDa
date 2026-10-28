import { randomUUID } from "node:crypto";
import {
  extractArticle,
  parseCandidate,
  sources,
  type FetchResult,
} from "@hehuoda/sicau-connectors/notices";
import { passwordHash } from "../src/admin/admin-security.js";
import { importBatch } from "../src/competitions/import.js";
import { initializeSources, persistArticle } from "../src/ingestion/store.js";
import { authTestApp, type AuthTestApp } from "./auth-fixture.js";
import { directory, edition } from "./competition-fixture.js";
import { correctedReview } from "./ingestion-fixture.js";
import { informationArticle } from "./notice-fixtures.js";

describe("管理员审核并发、发布保护与导入回滚 HTTP 验收", () => {
  let test: AuthTestApp;
  let headers: Record<string, string>;
  let cookie: string;
  const source = sources[0]!;
  const articleUrl = `https://${source.host}/info/1043/100.htm`;

  beforeAll(async () => {
    test = await authTestApp();
  }, 60000);

  afterAll(async () => {
    await test?.close();
  });

  beforeEach(async () => {
    await test.pool.query(
      "TRUNCATE ingestion_sources,colleges,competitions,admin_accounts CASCADE",
    );
    const salt = Buffer.alloc(16, 37);
    const password = await passwordHash("test-password", salt);
    await test.pool.query(
      "INSERT INTO admin_accounts(username,display_name,password_salt,password_hash) VALUES('review-concurrency-admin','并发验收管理员',$1,$2)",
      [salt, password],
    );
    await initializeSources(test.pool);
    await importBatch(test.pool, { colleges: directory });

    const login = await test.request(
      "POST",
      "admin/auth/login",
      { username: "review-concurrency-admin", password: "test-password" },
      { origin: "http://localhost:5173" },
    );
    expect(login.statusCode).toBe(200);
    cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const csrf = (
      await test.request("GET", "admin/auth/csrf", undefined, { cookie })
    ).json().csrfToken as string;
    headers = {
      cookie,
      origin: "http://localhost:5173",
      "x-csrf-token": csrf,
    };
  });

  async function createCandidate() {
    const article = extractArticle(informationArticle, articleUrl, source);
    const body = new TextEncoder().encode(informationArticle);
    const result: FetchResult = {
      url: articleUrl,
      status: 200,
      headers: {},
      body,
      html: informationArticle,
    };
    const saved = await persistArticle(
      test.pool,
      source,
      articleUrl,
      result,
      article,
      parseCandidate(article, articleUrl, directory!),
    );
    return saved.candidateId!;
  }

  async function exportReview(candidateId: string, targetId?: string) {
    const suffix = targetId ? `?targetId=${encodeURIComponent(targetId)}` : "";
    const response = await test.request(
      "GET",
      `admin/ingestion/candidates/${candidateId}/review${suffix}`,
      undefined,
      { cookie },
    );
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  it("候选被其他写入占锁并更新时，排队的旧拒绝请求返回409", async () => {
    const candidateId = await createCandidate();
    const snapshot = (
      await test.request(
        "GET",
        `admin/ingestion/candidates/${candidateId}`,
        undefined,
        { cookie },
      )
    ).json();
    const writer = await test.pool.connect();
    let pending: ReturnType<AuthTestApp["request"]> | undefined;
    try {
      await writer.query("BEGIN");
      const pid = (await writer.query("SELECT pg_backend_pid() AS id")).rows[0]
        .id;
      await writer.query(
        "SELECT n.id FROM ingestion_notices n JOIN ingestion_candidates c ON c.notice_id=n.id WHERE c.id=$1 FOR UPDATE OF n",
        [candidateId],
      );
      pending = test.request(
        "POST",
        `admin/ingestion/candidates/${candidateId}/reject`,
        {
          operationId: randomUUID(),
          reason: "核对原材料后拒绝",
          sourceVersion: snapshot.sourceVersion,
          candidateRevision: snapshot.candidateRevision,
          baseline: snapshot.baseline,
        },
        headers,
      );
      let blocked = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        blocked = (
          await test.pool.query(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked",
            [pid],
          )
        ).rows[0].blocked;
        if (blocked) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await writer.query(
        "UPDATE ingestion_candidates SET revision=revision+1 WHERE id=$1",
        [candidateId],
      );
      await writer.query("COMMIT");
      expect((await pending).statusCode).toBe(409);
      expect(
        (
          await test.request(
            "GET",
            `admin/ingestion/candidates/${candidateId}`,
            undefined,
            { cookie },
          )
        ).json(),
      ).toMatchObject({ status: "pending", candidateRevision: 2 });
    } finally {
      await writer.query("ROLLBACK");
      writer.release();
      await pending;
    }
  });

  it("预览后其他比赛占用新赛道ID时以409拒绝过期导入", async () => {
    const candidateId = await createCandidate();
    const review = correctedReview(await exportReview(candidateId));
    const approved = await test.request(
      "POST",
      `admin/ingestion/candidates/${candidateId}/approve`,
      { operationId: randomUUID(), reason: "核对新赛道", review },
      headers,
    );
    expect(approved.statusCode).toBe(200);
    const preview = await test.request(
      "POST",
      `admin/ingestion/candidates/${candidateId}/import-preview`,
      { operationId: randomUUID(), reason: "预览新赛道", review },
      headers,
    );
    expect(preview.statusCode).toBe(200);
    const occupiedTrack = {
      ...edition("occupying").tracks![0]!,
      id: review.batch.competitions![0].tracks![0]!.id,
    };
    await importBatch(test.pool, {
      competitions: [edition("occupying", { tracks: [occupiedTrack] })],
    });
    const result = await test.request(
      "POST",
      `admin/ingestion/candidates/${candidateId}/import`,
      {
        operationId: randomUUID(),
        reason: "提交原预览",
        review,
        previewId: preview.json().previewId,
      },
      headers,
    );
    expect(result.statusCode).toBe(409);
    expect(
      (
        await test.request(
          "GET",
          `admin/ingestion/candidates/${candidateId}`,
          undefined,
          { cookie },
        )
      ).json().status,
    ).toBe("approved");
  });

  it("导入已发布目标须对同一预览显式确认，且幂等重试不重复写入", async () => {
    const candidateId = await createCandidate();
    const targetId = "published-target";
    const previousName = "已发布的公开名称";
    await importBatch(test.pool, {
      competitions: [edition(targetId, { name: previousName })],
    });

    const exported = await exportReview(candidateId, targetId);
    expect(exported.formalBefore.publication).toBe("published");
    const review = correctedReview(exported, { name: "审核后更新的公开名称" });
    const saved = await test.request(
      "PUT",
      `admin/ingestion/candidates/${candidateId}/review`,
      {
        operationId: randomUUID(),
        reason: "核对已发布目标的更新材料",
        review,
      },
      headers,
    );
    expect(saved.statusCode).toBe(200);
    const approvedFile = saved.json().review;
    const approve = await test.request(
      "POST",
      `admin/ingestion/candidates/${candidateId}/approve`,
      {
        operationId: randomUUID(),
        reason: "批准已核对的发布更新材料",
        review: approvedFile,
      },
      headers,
    );
    expect(approve.statusCode).toBe(200);

    const preview = await test.request(
      "POST",
      `admin/ingestion/candidates/${candidateId}/import-preview`,
      {
        operationId: randomUUID(),
        reason: "预览已发布目标的更新",
        review: approvedFile,
      },
      headers,
    );
    expect(preview.statusCode).toBe(200);
    const previewId = preview.json().previewId as string;

    const publicBefore = await test.request("GET", `competitions/${targetId}`);
    expect(publicBefore.statusCode).toBe(200);
    expect(publicBefore.json().name).toBe(previousName);

    const operationId = randomUUID();
    const importPayload = {
      operationId,
      reason: "确认导入已发布目标的更新",
      previewId,
      review: approvedFile,
    };
    const unconfirmed = await test.request(
      "POST",
      `admin/ingestion/candidates/${candidateId}/import`,
      importPayload,
      headers,
    );
    expect(unconfirmed.statusCode).toBe(409);
    expect(
      (
        await test.pool.query(
          "SELECT consumed_at FROM ingestion_review_previews WHERE id=$1",
          [previewId],
        )
      ).rows[0].consumed_at,
    ).toBeNull();

    const confirmed = await test.request(
      "POST",
      `admin/ingestion/candidates/${candidateId}/import`,
      { ...importPayload, confirmPublished: true },
      headers,
    );
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().preview).toBe(false);
    const publicAfter = await test.request("GET", `competitions/${targetId}`);
    expect(publicAfter.statusCode).toBe(200);
    expect(publicAfter.json()).toMatchObject({
      id: targetId,
      name: "审核后更新的公开名称",
    });

    const retry = await test.request(
      "POST",
      `admin/ingestion/candidates/${candidateId}/import`,
      { ...importPayload, confirmPublished: true },
      headers,
    );
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(confirmed.json());
    expect(
      (
        await test.pool.query(
          "SELECT count(*)::int AS total FROM ingestion_mappings WHERE candidate_id=$1",
          [candidateId],
        )
      ).rows[0].total,
    ).toBe(1);
  });

  it("同基线并发修订只接受一个，之后的新修订会撤销旧批准", async () => {
    const candidateId = await createCandidate();
    const [firstSnapshot, secondSnapshot] = await Promise.all([
      exportReview(candidateId),
      exportReview(candidateId),
    ]);
    const first = correctedReview(firstSnapshot, { name: "并发修订甲" });
    const second = correctedReview(secondSnapshot, { name: "并发修订乙" });
    const responses = await Promise.all([
      test.request(
        "PUT",
        `admin/ingestion/candidates/${candidateId}/review`,
        {
          operationId: randomUUID(),
          reason: "并发提交修订甲",
          review: first,
        },
        headers,
      ),
      test.request(
        "PUT",
        `admin/ingestion/candidates/${candidateId}/review`,
        {
          operationId: randomUUID(),
          reason: "并发提交修订乙",
          review: second,
        },
        headers,
      ),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 409,
    ]);
    const winner = responses.find((response) => response.statusCode === 200)!;
    expect(winner.json().candidateRevision).toBe(2);
    const revisions = await test.pool.query<{
      revision: number;
      total: number;
    }>(
      "SELECT c.revision, count(r.candidate_revision)::int AS total FROM ingestion_candidates c LEFT JOIN ingestion_review_revisions r ON r.candidate_id=c.id WHERE c.id=$1 GROUP BY c.revision",
      [candidateId],
    );
    expect(revisions.rows[0]).toEqual({ revision: 2, total: 1 });

    const approvedFile = winner.json().review;
    const approved = await test.request(
      "POST",
      `admin/ingestion/candidates/${candidateId}/approve`,
      {
        operationId: randomUUID(),
        reason: "批准并发胜出的修订",
        review: approvedFile,
      },
      headers,
    );
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe("approved");

    const latest = await exportReview(candidateId);
    const revisedAgain = correctedReview(latest, { name: "批准后重新修订" });
    const revision = await test.request(
      "PUT",
      `admin/ingestion/candidates/${candidateId}/review`,
      {
        operationId: randomUUID(),
        reason: "批准后修改材料使旧批准失效",
        review: revisedAgain,
      },
      headers,
    );
    expect(revision.statusCode).toBe(200);
    expect(revision.json()).toMatchObject({
      status: "pending",
      candidateRevision: 3,
    });
    const candidate = await test.request(
      "GET",
      `admin/ingestion/candidates/${candidateId}`,
      undefined,
      { cookie },
    );
    expect(candidate.json()).toMatchObject({
      status: "pending",
      candidateRevision: 3,
    });
  });

  it("导入成功审计失败时业务写入与预览消费整体回滚，同命令可安全重试", async () => {
    const candidateId = await createCandidate();
    const targetId = "audit-rollback-target";
    const review = correctedReview(await exportReview(candidateId, targetId));
    const approve = await test.request(
      "POST",
      `admin/ingestion/candidates/${candidateId}/approve`,
      {
        operationId: randomUUID(),
        reason: "批准事务回滚验收材料",
        review,
      },
      headers,
    );
    expect(approve.statusCode).toBe(200);
    const preview = await test.request(
      "POST",
      `admin/ingestion/candidates/${candidateId}/import-preview`,
      {
        operationId: randomUUID(),
        reason: "预览事务回滚验收材料",
        review,
      },
      headers,
    );
    expect(preview.statusCode).toBe(200);
    const previewId = preview.json().previewId as string;
    const operationId = randomUUID();
    const command = {
      operationId,
      reason: "验证导入成功审计失败回滚",
      previewId,
      review,
    };

    await test.pool.query(
      `CREATE FUNCTION reject_candidate_import_success() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.action='candidate.import' AND NEW.result='success' THEN
           RAISE EXCEPTION 'test candidate import audit failure';
         END IF;
         RETURN NEW;
       END $$`,
    );
    await test.pool.query(
      "CREATE TRIGGER reject_candidate_import_success BEFORE INSERT ON admin_operations FOR EACH ROW EXECUTE FUNCTION reject_candidate_import_success()",
    );
    try {
      const failed = await test.request(
        "POST",
        `admin/ingestion/candidates/${candidateId}/import`,
        command,
        headers,
      );
      expect(failed.statusCode).toBe(500);
      expect(JSON.stringify(failed.json())).not.toContain(
        "test candidate import audit failure",
      );
      expect(
        (
          await test.pool.query(
            "SELECT count(*)::int AS total FROM competitions WHERE id=$1",
            [targetId],
          )
        ).rows[0].total,
      ).toBe(0);
      expect(
        (
          await test.pool.query(
            "SELECT count(*)::int AS total FROM ingestion_mappings WHERE candidate_id=$1",
            [candidateId],
          )
        ).rows[0].total,
      ).toBe(0);
      expect(
        (
          await test.pool.query(
            "SELECT status FROM ingestion_candidates WHERE id=$1",
            [candidateId],
          )
        ).rows[0].status,
      ).toBe("approved");
      expect(
        (
          await test.pool.query(
            "SELECT consumed_at FROM ingestion_review_previews WHERE id=$1",
            [previewId],
          )
        ).rows[0].consumed_at,
      ).toBeNull();
      expect(
        (
          await test.pool.query(
            "SELECT count(*)::int AS total FROM admin_ingestion_commands WHERE operation_id=$1",
            [operationId],
          )
        ).rows[0].total,
      ).toBe(0);
    } finally {
      await test.pool.query(
        "DROP TRIGGER reject_candidate_import_success ON admin_operations",
      );
      await test.pool.query("DROP FUNCTION reject_candidate_import_success()");
    }

    const imported = await test.request(
      "POST",
      `admin/ingestion/candidates/${candidateId}/import`,
      command,
      headers,
    );
    expect(imported.statusCode).toBe(200);
    const candidate = await test.request(
      "GET",
      `admin/ingestion/candidates/${candidateId}`,
      undefined,
      { cookie },
    );
    expect(candidate.json().status).toBe("imported");
    expect(
      (
        await test.pool.query(
          "SELECT consumed_at FROM ingestion_review_previews WHERE id=$1",
          [previewId],
        )
      ).rows[0].consumed_at,
    ).not.toBeNull();
    const countsBeforeRetry = await test.pool.query(
      `SELECT
         (SELECT count(*)::int FROM competitions WHERE id=$1) AS competitions,
         (SELECT count(*)::int FROM ingestion_mappings WHERE candidate_id=$2) AS mappings,
         (SELECT count(*)::int FROM ingestion_operations WHERE candidate_id=$2 AND kind='import') AS imports,
         (SELECT count(*)::int FROM admin_ingestion_commands WHERE operation_id=$3) AS commands`,
      [targetId, candidateId, operationId],
    );
    expect(countsBeforeRetry.rows[0]).toEqual({
      competitions: 1,
      mappings: 1,
      imports: 1,
      commands: 1,
    });

    const retry = await test.request(
      "POST",
      `admin/ingestion/candidates/${candidateId}/import`,
      command,
      headers,
    );
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(imported.json());
    const countsAfterRetry = await test.pool.query(
      `SELECT
         (SELECT count(*)::int FROM competitions WHERE id=$1) AS competitions,
         (SELECT count(*)::int FROM ingestion_mappings WHERE candidate_id=$2) AS mappings,
         (SELECT count(*)::int FROM ingestion_operations WHERE candidate_id=$2 AND kind='import') AS imports,
         (SELECT count(*)::int FROM admin_ingestion_commands WHERE operation_id=$3) AS commands`,
      [targetId, candidateId, operationId],
    );
    expect(countsAfterRetry.rows).toEqual(countsBeforeRetry.rows);
  });
});
