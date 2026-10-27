import { randomUUID } from "node:crypto";
import { jest } from "@jest/globals";
import { passwordHash } from "../src/admin/admin-security.js";
import {
  BoundedFetcher,
  sources,
  type HttpResponse,
  type Transport,
} from "@hehuoda/sicau-connectors/notices";
import { AdminIngestionService } from "../src/ingestion/admin-ingestion.service.js";
import { IngestionRunner } from "../src/ingestion/runner.js";
import { initializeSources } from "../src/ingestion/store.js";
import { authTestApp, type AuthTestApp } from "./auth-fixture.js";
import { informationArticle, informationList } from "./notice-fixtures.js";

jest.setTimeout(60_000);

const sourceId = sources[0]!.id;
const origin = "http://localhost:5173";
const informationLastPage = informationList
  .replace(
    "../info/1043/100.htm",
    "https://xxgc.sicau.edu.cn/info/1043/100.htm",
  )
  .replace(
    '<div class="p_pages"><a href="tz/3.htm">下页</a></div>',
    '<div class="p_pages"></div>',
  );

describe("管理员采集运行 API", () => {
  let test: AuthTestApp;
  let cookie: string;
  let csrf: string;
  let actorId: string;

  beforeAll(async () => {
    test = await authTestApp();
    const salt = Buffer.alloc(16, 39);
    await test.pool.query(
      "INSERT INTO admin_accounts (username, display_name, password_salt, password_hash) VALUES ($1,$2,$3,$4)",
      [
        "ingestion-admin",
        "采集管理员",
        salt,
        await passwordHash("test-password", salt),
      ],
    );
    await initializeSources(test.pool);
    const login = await test.request(
      "POST",
      "admin/auth/login",
      { username: "ingestion-admin", password: "test-password" },
      { origin },
    );
    actorId = login.json().id;
    cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    csrf = (
      await test.request("GET", "admin/auth/csrf", undefined, { cookie })
    ).json().csrfToken;
  });

  afterAll(async () => {
    await test?.close();
  });

  afterEach(async () => {
    if (!test) return;
    const response = await test.request(
      "GET",
      `admin/ingestion/sources/${sourceId}`,
      undefined,
      { cookie },
    );
    if (response.statusCode === 200) {
      const source = response.json();
      const defaults = {
        maxPages: 10,
        frequencyMinutes: 60,
        requests: 80,
        intervalMs: 2000,
        timeoutMs: 15000,
        durationMs: 600000,
        bytes: 2097152,
      };
      if (
        source.enabled !== true ||
        Object.entries(defaults).some(
          ([key, value]) => source.settings[key] !== value,
        )
      )
        await test.request(
          "PATCH",
          `admin/ingestion/sources/${sourceId}`,
          {
            enabled: true,
            settings: defaults,
            baseline: source.baseline,
            operationId: randomUUID(),
            reason: "恢复测试来源配置",
          },
          authHeaders(),
        );
    }
  });

  const authHeaders = () => ({
    cookie,
    origin,
    "x-csrf-token": csrf,
  });

  const sourceDetail = async () =>
    (
      await test.request(
        "GET",
        `admin/ingestion/sources/${sourceId}`,
        undefined,
        { cookie },
      )
    ).json();

  const configure = async (
    changes: Record<string, unknown>,
    operationId = randomUUID(),
  ) => {
    const current = await sourceDetail();
    return test.request(
      "PATCH",
      `admin/ingestion/sources/${sourceId}`,
      {
        ...changes,
        baseline: current.baseline,
        operationId,
        reason: "验证采集管理接口",
      },
      authHeaders(),
    );
  };

  const installTransport = (transport: Transport) => {
    let now = 0;
    test.app.get(AdminIngestionService).runner = new IngestionRunner(
      test.pool,
      (source, limits) =>
        new BoundedFetcher(
          source,
          limits,
          transport,
          () => now,
          async (ms) => {
            now += ms;
          },
        ),
    );
  };

  const submitScan = async (body: Record<string, unknown> = {}) =>
    test.request(
      "POST",
      "admin/ingestion/scans",
      {
        sourceId,
        from: "2026-10-01",
        to: "2026-10-31",
        operationId: randomUUID(),
        reason: "验证异步扫描接口",
        ...body,
      },
      authHeaders(),
    );

  const waitForRequest = async (requestId: string) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const response = await test.request(
        "GET",
        `admin/ingestion/requests/${requestId}`,
        undefined,
        { cookie },
      );
      expect(response.statusCode).toBe(200);
      const request = response.json();
      if (!(["accepted", "running"] as string[]).includes(request.status))
        return request;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("采集请求未在期限内结束");
  };

  const offlineNoticeTransport: Transport = async (
    url,
  ): Promise<HttpResponse> => {
    const path = url.pathname;
    if (path === "/robots.txt")
      return {
        status: 404,
        headers: {},
        body: new TextEncoder().encode(""),
      };
    const html =
      path === new URL(sources[0]!.listUrl).pathname
        ? informationList
        : path === "/xygl/tz/3.htm"
          ? informationLastPage
          : path === "/info/1043/100.htm"
            ? informationArticle
            : "<html><body></body></html>";
    return {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: new TextEncoder().encode(html),
    };
  };

  it("采集来源详情受管理员会话保护，并提供配置基线", async () => {
    const denied = await test.request(
      "GET",
      `admin/ingestion/sources/${sourceId}`,
    );
    expect(denied.statusCode).toBe(401);

    const response = await test.request(
      "GET",
      `admin/ingestion/sources/${sourceId}`,
      undefined,
      { cookie },
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: sourceId,
      enabled: expect.any(Boolean),
      settings: expect.any(Object),
      baseline: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(response.json().baseline.length).toBeGreaterThan(0);
  });

  it("来源配置用基线保护并按 operationId 幂等", async () => {
    const before = await test.request(
      "GET",
      `admin/ingestion/sources/${sourceId}`,
      undefined,
      { cookie },
    );
    const baseline = before.json().baseline as string;
    const operationId = randomUUID();
    const command = {
      enabled: false,
      settings: { maxPages: 4 },
      baseline,
      operationId,
      reason: "验证来源配置接口",
    };
    const first = await test.request(
      "PATCH",
      `admin/ingestion/sources/${sourceId}`,
      command,
      authHeaders(),
    );
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      id: sourceId,
      enabled: false,
      settings: { maxPages: 4 },
    });

    const retry = await test.request(
      "PATCH",
      `admin/ingestion/sources/${sourceId}`,
      command,
      authHeaders(),
    );
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(first.json());

    const reused = await test.request(
      "PATCH",
      `admin/ingestion/sources/${sourceId}`,
      { ...command, enabled: true },
      authHeaders(),
    );
    expect(reused.statusCode).toBe(409);

    const stale = await test.request(
      "PATCH",
      `admin/ingestion/sources/${sourceId}`,
      { ...command, operationId: randomUUID(), baseline: "0".repeat(64) },
      authHeaders(),
    );
    expect(stale.statusCode).toBe(409);

    const after = await test.request(
      "GET",
      `admin/ingestion/sources/${sourceId}`,
      undefined,
      { cookie },
    );
    expect(after.json()).toMatchObject({
      enabled: false,
      settings: { maxPages: 4 },
    });
  });

  it("工作台返回真实待审核与固定来源摘要", async () => {
    const response = await test.request("GET", "admin/dashboard", undefined, {
      cookie,
    });
    expect(response.statusCode).toBe(200);
    const modules = response.json().modules as {
      module: string;
      available: boolean;
      count: number | null;
      scope: string;
    }[];
    expect(modules.find((module) => module.module === "sources")).toMatchObject(
      {
        available: true,
        count: sources.length,
        scope: expect.stringContaining("包含停用来源"),
      },
    );
    expect(modules.find((module) => module.module === "pending")).toMatchObject(
      {
        available: true,
        count: expect.any(Number),
        scope: expect.stringContaining("pending"),
      },
    );
  });

  it("预览返回提取结果但不写采集或正式业务数据", async () => {
    installTransport(offlineNoticeTransport);
    const counts = async () =>
      (
        await test.pool.query(
          `SELECT
            (SELECT count(*)::int FROM ingestion_sources) AS sources,
            (SELECT count(*)::int FROM ingestion_runs) AS runs,
            (SELECT count(*)::int FROM ingestion_notices) AS notices,
            (SELECT count(*)::int FROM ingestion_versions) AS versions,
            (SELECT count(*)::int FROM ingestion_candidates) AS candidates,
            (SELECT count(*)::int FROM ingestion_mappings) AS mappings,
            (SELECT count(*)::int FROM competitions) AS competitions`,
        )
      ).rows[0];
    const before = await counts();

    const accepted = await submitScan({ preview: true });
    expect(accepted.statusCode).toBe(202);
    const request = await waitForRequest(accepted.json().requestId);
    expect(request.status).toBe("completed");
    expect(request.runId).toBeNull();
    if (request.result.status !== "succeeded")
      throw new Error(JSON.stringify(request.result));
    expect(request.result).toMatchObject({ status: "succeeded" });
    expect(request.result.previews).toHaveLength(1);
    expect(await counts()).toEqual(before);
  });

  it("异步失败可查询且请求完成状态与采集运行状态分开", async () => {
    let entered!: () => void;
    let release!: () => void;
    const atRobots = new Promise<void>((resolve) => (entered = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    installTransport(async (url) => {
      if (url.pathname === "/robots.txt") {
        entered();
        await gate;
        return {
          status: 404,
          headers: {},
          body: new TextEncoder().encode(""),
        };
      }
      return {
        status: 503,
        headers: {},
        body: new TextEncoder().encode("temporarily unavailable"),
      };
    });

    const accepted = await submitScan();
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toMatchObject({ status: "accepted" });
    const requestId = accepted.json().requestId as string;
    await atRobots;
    const running = await test.request(
      "GET",
      `admin/ingestion/requests/${requestId}`,
      undefined,
      { cookie },
    );
    expect(running.statusCode).toBe(200);
    expect(running.json().status).toBe("running");

    release();
    const request = await waitForRequest(requestId);
    expect(request.status).toBe("completed");
    expect(request.runId).toEqual(expect.any(String));
    expect(request.result).toMatchObject({ status: "failed" });
    const run = await test.request(
      "GET",
      `admin/ingestion/runs/${request.runId}`,
      undefined,
      { cookie },
    );
    expect(run.statusCode).toBe(200);
    expect(run.json()).toMatchObject({
      id: request.runId,
      status: "failed",
      errors: [expect.objectContaining({ message: "站点限流或临时服务错误" })],
    });
  });

  it("预算耗尽返回可续跑的部分结果，重试请求不重复续跑", async () => {
    const limited = await configure({ settings: { requests: 2 } });
    expect(limited.statusCode).toBe(200);
    installTransport(offlineNoticeTransport);

    const accepted = await submitScan();
    expect(accepted.statusCode).toBe(202);
    const partial = await waitForRequest(accepted.json().requestId);
    expect(partial.status).toBe("completed");
    expect(partial.result).toMatchObject({ status: "partial" });
    expect(partial.runId).toEqual(expect.any(String));
    const previousRun = await test.request(
      "GET",
      `admin/ingestion/runs/${partial.runId}`,
      undefined,
      { cookie },
    );
    expect(previousRun.json()).toMatchObject({
      status: "partial",
      cursor: { pages: expect.any(Array), pending: expect.any(Array) },
    });
    expect(
      previousRun.json().cursor.pages.length +
        previousRun.json().cursor.pending.length,
    ).toBeGreaterThan(0);

    const restored = await configure({ settings: { requests: 80 } });
    expect(restored.statusCode).toBe(200);
    const operationId = randomUUID();
    const resumeCommand = {
      operationId,
      reason: "恢复预算耗尽的采集运行",
    };
    const resumed = await test.request(
      "POST",
      `admin/ingestion/runs/${partial.runId}/resume`,
      resumeCommand,
      authHeaders(),
    );
    expect(resumed.statusCode).toBe(202);
    const resumedRequest = await waitForRequest(resumed.json().requestId);
    if (resumedRequest.result.status !== "succeeded")
      throw new Error(JSON.stringify(resumedRequest.result));
    expect(resumedRequest.result).toMatchObject({ status: "succeeded" });
    const retry = await test.request(
      "POST",
      `admin/ingestion/runs/${partial.runId}/resume`,
      resumeCommand,
      authHeaders(),
    );
    expect(retry.statusCode).toBe(202);
    expect(retry.json().requestId).toBe(resumed.json().requestId);
  });

  it("全局采集锁占用时拒绝受理，不留下执行请求", async () => {
    const client = await test.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(23000)");
      const before = Number(
        (
          await test.pool.query(
            "SELECT count(*)::int AS total FROM ingestion_requests",
          )
        ).rows[0].total,
      );
      const response = await submitScan();
      expect(response.statusCode).toBe(409);
      const after = Number(
        (
          await test.pool.query(
            "SELECT count(*)::int AS total FROM ingestion_requests",
          )
        ).rows[0].total,
      );
      expect(after).toBe(before);
    } finally {
      await client.query("SELECT pg_advisory_unlock(23000)");
      client.release();
    }
  });

  it("成功审计失败时来源配置回滚且只记录失败审计", async () => {
    const before = await sourceDetail();
    const operationId = randomUUID();
    await test.pool.query(
      `CREATE FUNCTION reject_ingestion_success() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.action='ingestion.configure' AND NEW.result='success' THEN
           RAISE EXCEPTION 'test audit unavailable';
         END IF;
         RETURN NEW;
       END $$`,
    );
    await test.pool.query(
      "CREATE TRIGGER reject_ingestion_success BEFORE INSERT ON admin_operations FOR EACH ROW EXECUTE FUNCTION reject_ingestion_success()",
    );
    try {
      const response = await test.request(
        "PATCH",
        `admin/ingestion/sources/${sourceId}`,
        {
          settings: { maxPages: 4 },
          baseline: before.baseline,
          operationId,
          reason: "验证审计失败回滚",
        },
        authHeaders(),
      );
      expect(response.statusCode).toBe(500);
      expect(await sourceDetail()).toMatchObject({
        enabled: before.enabled,
        settings: before.settings,
        baseline: before.baseline,
      });
      const operations = await test.request(
        "GET",
        "admin/operations?objectType=source&page=1&pageSize=50",
        undefined,
        { cookie },
      );
      const rows = operations.json().items as {
        commandOperationId: string | null;
        result: string;
      }[];
      expect(
        rows.filter((row) => row.commandOperationId === operationId),
      ).toEqual([expect.objectContaining({ result: "failure" })]);
    } finally {
      await test.pool.query(
        "DROP TRIGGER reject_ingestion_success ON admin_operations",
      );
      await test.pool.query("DROP FUNCTION reject_ingestion_success()");
    }
  });

  it("应用重启会把未完成的受理与运行明确标记为中断", async () => {
    const requestId = randomUUID();
    const runId = randomUUID();
    await test.pool.query(
      `INSERT INTO ingestion_runs(id,source_id,trigger,status,options,cursor,counts)
       VALUES($1,$2,'manual','running',$3,$4,$5)`,
      [
        runId,
        sourceId,
        JSON.stringify({ sourceId, from: "2026-10-01", to: "2026-10-31" }),
        JSON.stringify({ pages: [], pending: [], seen: [] }),
        JSON.stringify({
          discovered: 0,
          new: 0,
          changed: 0,
          unchanged: 0,
          ignored: 0,
          failed: 0,
        }),
      ],
    );
    await test.pool.query(
      `INSERT INTO ingestion_requests(id,actor_id,source_id,status,options,run_id,started_at)
       VALUES($1,$2,$3,'running',$4,$5,now())`,
      [
        requestId,
        actorId,
        sourceId,
        JSON.stringify({ sourceId, requestId }),
        runId,
      ],
    );

    await test.restart();
    const request = await test.request(
      "GET",
      `admin/ingestion/requests/${requestId}`,
      undefined,
      { cookie },
    );
    expect(request.statusCode).toBe(200);
    expect(request.json()).toMatchObject({
      status: "interrupted",
      runId,
      error: expect.any(String),
    });
    const run = await test.request(
      "GET",
      `admin/ingestion/runs/${runId}`,
      undefined,
      { cookie },
    );
    expect(run.json().status).toBe("interrupted");
  });
});
