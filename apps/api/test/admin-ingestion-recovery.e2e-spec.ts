import { randomUUID } from "node:crypto";
import {
  BoundedFetcher,
  sources,
  type Transport,
} from "@hehuoda/sicau-connectors/notices";
import { AdminIngestionService } from "../src/ingestion/admin-ingestion.service.js";
import { IngestionRunner } from "../src/ingestion/runner.js";
import { informationArticle } from "./notice-fixtures.js";
import { passwordHash } from "../src/admin/admin-security.js";
import { authTestApp, type AuthTestApp } from "./auth-fixture.js";

describe("异步采集受理与中断恢复", () => {
  let test: AuthTestApp;
  let actorId: string;
  let headers: Record<string, string>;
  const source = sources[0]!;
  beforeAll(async () => {
    test = await authTestApp();
    const salt = Buffer.alloc(16, 41);
    actorId = (
      await test.pool.query(
        "INSERT INTO admin_accounts(username,display_name,password_salt,password_hash) VALUES('recovery-admin','恢复管理员',$1,$2) RETURNING id",
        [salt, await passwordHash("test-password", salt)],
      )
    ).rows[0].id;
    const login = await test.request(
      "POST",
      "admin/auth/login",
      { username: "recovery-admin", password: "test-password" },
      { origin: "http://localhost:5173" },
    );
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const csrf = (
      await test.request("GET", "admin/auth/csrf", undefined, { cookie })
    ).json().csrfToken;
    headers = { cookie, origin: "http://localhost:5173", "x-csrf-token": csrf };
  }, 60000);
  afterAll(async () => {
    await test?.close();
  });

  it("重启后未开始的受理明确中断，预览请求不创建任何采集业务数据", async () => {
    const id = randomUUID();
    await test.pool.query(
      "INSERT INTO ingestion_requests(id,actor_id,source_id,status,options) VALUES($1,$2,$3,'accepted',$4)",
      [
        id,
        actorId,
        source.id,
        {
          sourceId: source.id,
          preview: true,
          from: "2026-01-01",
          to: "2026-10-27",
          url: `https://${source.host}/info/1043/100.htm`,
        },
      ],
    );
    await test.restart();
    const response = await test.request(
      "GET",
      `admin/ingestion/requests/${id}`,
      undefined,
      headers,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      requestId: id,
      status: "interrupted",
      runId: null,
      result: null,
    });
    for (const table of [
      "ingestion_sources",
      "ingestion_runs",
      "ingestion_notices",
      "ingestion_candidates",
      "competitions",
    ])
      expect(
        (await test.pool.query(`SELECT count(*)::int AS total FROM ${table}`))
          .rows[0].total,
      ).toBe(0);
    let clock = 0;
    const transport: Transport = async (url) => ({
      status: url.pathname === "/robots.txt" ? 404 : 200,
      headers: {},
      body: new TextEncoder().encode(
        url.pathname === "/robots.txt" ? "" : informationArticle,
      ),
    });
    test.app.get(AdminIngestionService).runner = new IngestionRunner(
      test.pool,
      (configured, limits) =>
        new BoundedFetcher(
          configured,
          limits,
          transport,
          () => clock,
          async (ms) => {
            clock += ms;
          },
        ),
    );
    const command = {
      operationId: randomUUID(),
      reason: "显式恢复未创建运行的原预览",
    };
    const retry = await test.request(
      "POST",
      `admin/ingestion/requests/${id}/retry`,
      command,
      headers,
    );
    expect(retry.statusCode).toBe(202);
    expect(
      (
        await test.request(
          "POST",
          `admin/ingestion/requests/${id}/retry`,
          command,
          headers,
        )
      ).json(),
    ).toEqual(retry.json());
    let completed;
    for (let attempt = 0; attempt < 200; attempt++) {
      completed = (
        await test.request(
          "GET",
          `admin/ingestion/requests/${retry.json().requestId}`,
          undefined,
          headers,
        )
      ).json();
      if (completed.status === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(completed).toMatchObject({
      status: "completed",
      runId: null,
      options: { from: "2026-01-01", to: "2026-10-27", preview: true },
      result: { status: "succeeded" },
    });
    expect(completed.result.previews).toHaveLength(1);
    expect(
      (
        await test.pool.query(
          "SELECT count(*)::int AS total FROM ingestion_sources",
        )
      ).rows[0].total,
    ).toBe(0);
  }, 60000);

  it("扫描进程丢失后运行与请求都标记中断，并保留同一runId和游标", async () => {
    const id = randomUUID(),
      runId = randomUUID();
    await test.pool.query(
      "INSERT INTO ingestion_sources(id,data) VALUES($1,$2)",
      [source.id, source],
    );
    const cursor = { pages: [source.listUrl], pending: [], seen: [] };
    await test.pool.query(
      "INSERT INTO ingestion_runs(id,source_id,trigger,status,options,cursor,counts) VALUES($1,$2,'manual','running',$3,$4,'{}')",
      [
        runId,
        source.id,
        {
          requestId: id,
          sourceId: source.id,
          from: "2026-01-01",
          to: "2026-10-27",
        },
        cursor,
      ],
    );
    await test.pool.query(
      "INSERT INTO ingestion_requests(id,actor_id,source_id,status,options) VALUES($1,$2,$3,'running',$4)",
      [id, actorId, source.id, { sourceId: source.id }],
    );
    await test.restart();
    const response = await test.request(
      "GET",
      `admin/ingestion/requests/${id}`,
      undefined,
      headers,
    );
    expect(response.json()).toMatchObject({
      requestId: id,
      status: "interrupted",
      runId,
    });
    const run = await test.request(
      "GET",
      `admin/ingestion/runs/${runId}`,
      undefined,
      headers,
    );
    expect(run.json()).toMatchObject({
      id: runId,
      status: "interrupted",
      cursor,
    });
  }, 60000);

  it("CLI或调度占用全局锁时HTTP返回409，不留下受理记录", async () => {
    const lock = await test.pool.connect();
    await lock.query("SELECT pg_advisory_lock(23000)");
    try {
      const before = (
        await test.pool.query(
          "SELECT count(*)::int AS total FROM ingestion_requests",
        )
      ).rows[0].total;
      const response = await test.request(
        "POST",
        "admin/ingestion/scans",
        {
          sourceId: source.id,
          operationId: randomUUID(),
          reason: "验证锁占用",
        },
        headers,
      );
      expect(response.statusCode).toBe(409);
      expect(
        (
          await test.pool.query(
            "SELECT count(*)::int AS total FROM ingestion_requests",
          )
        ).rows[0].total,
      ).toBe(before);
    } finally {
      await lock.query("SELECT pg_advisory_unlock(23000)");
      lock.release(true);
    }
  });

  it("成功审计故障时受理和幂等记录回滚，不返回虚假的202", async () => {
    await test.pool.query(
      "CREATE FUNCTION reject_scan_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ingestion.scan' AND NEW.result='success' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$",
    );
    await test.pool.query(
      "CREATE TRIGGER reject_scan_audit BEFORE INSERT ON admin_operations FOR EACH ROW EXECUTE FUNCTION reject_scan_audit()",
    );
    const operationId = randomUUID();
    const before = (
      await test.pool.query(
        "SELECT count(*)::int AS total FROM ingestion_requests",
      )
    ).rows[0].total;
    try {
      const response = await test.request(
        "POST",
        "admin/ingestion/scans",
        { sourceId: source.id, operationId, reason: "验证审计故障回滚" },
        headers,
      );
      expect(response.statusCode).toBe(500);
      expect(JSON.stringify(response.json())).not.toContain(
        "test audit failure",
      );
      expect(
        (
          await test.pool.query(
            "SELECT count(*)::int AS total FROM ingestion_requests",
          )
        ).rows[0].total,
      ).toBe(before);
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
        "DROP TRIGGER reject_scan_audit ON admin_operations",
      );
    }
  });
});
