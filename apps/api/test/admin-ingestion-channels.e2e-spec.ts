import { randomUUID } from "node:crypto";
import { jest } from "@jest/globals";
import { passwordHash } from "../src/admin/admin-security.js";
import { sources, type Source } from "@hehuoda/sicau-connectors/notices";
import { AdminIngestionService } from "../src/ingestion/admin-ingestion.service.js";
import { initializeChannels } from "../src/ingestion/channel-store.js";
import { initializeSources } from "../src/ingestion/store.js";
import type { IngestionRunner, ScanOptions } from "../src/ingestion/runner.js";
import { authTestApp, type AuthTestApp } from "./auth-fixture.js";

jest.setTimeout(60_000);

const fixtureSource: Source = {
  id: "issue-174-channel-fixture",
  collegeId: "issue-174-channel-fixture",
  publisher: "Issue 174 测试来源",
  host: "fixture.sicau.edu.cn",
  listUrl: "https://fixture.sicau.edu.cn/notices/list.htm",
  version: "fixture-1",
  defaultChannelId: "competition",
  channels: [
    {
      id: "competition",
      listUrl: "https://fixture.sicau.edu.cn/notices/list.htm",
      adapterId: "vsb-selectors",
      version: "fixture-1",
      noticePath: "^/info/\\d+/\\d+\\.htm$",
      listPath: "^/notices/(?:list\\.htm|page/\\d+\\.htm)$",
      selectors: {
        rows: ".notice-row",
        link: ".notice-row a",
        date: ".notice-date",
        pagination: ".pagination",
        nextText: "^(Next|>)$",
        title: "h1",
        content: ".content",
        meta: ".meta",
        attachments: ".attachments",
      },
    },
  ],
};

const origin = "http://localhost:5173";
const sourceId = fixtureSource.id;
const channelId = fixtureSource.defaultChannelId;
const sampleUrl = "https://fixture.sicau.edu.cn/info/101/2026.htm";

describe("管理采集栏目核验与调度 API", () => {
  let test: AuthTestApp;
  let cookie: string;
  let csrf: string;

  beforeAll(async () => {
    sources.push(fixtureSource);
    test = await authTestApp();
    const salt = Buffer.alloc(16, 52);
    await test.pool.query(
      "INSERT INTO admin_accounts (username, display_name, password_salt, password_hash) VALUES ($1,$2,$3,$4)",
      [
        "ingestion-channel-admin",
        "栏目核验管理员",
        salt,
        await passwordHash("test-password", salt),
      ],
    );
    await initializeSources(test.pool);
    await initializeChannels(test.pool);
    const login = await test.request(
      "POST",
      "admin/auth/login",
      { username: "ingestion-channel-admin", password: "test-password" },
      { origin },
    );
    cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    csrf = (
      await test.request("GET", "admin/auth/csrf", undefined, { cookie })
    ).json().csrfToken;
  });

  afterAll(async () => {
    await test?.close();
    const index = sources.findIndex((source) => source.id === sourceId);
    if (index >= 0) sources.splice(index, 1);
  });

  beforeEach(async () => {
    await test.pool.query(
      `UPDATE ingestion_channels SET enabled=false,settings='{}'::jsonb,
        verification_status='pending',verification='[]'::jsonb,
        verified_at=NULL,verified_by=NULL,activated_on=NULL
       WHERE source_id=$1 AND id=$2`,
      [sourceId, channelId],
    );
    await test.pool.query(
      "UPDATE ingestion_sources SET enabled=true,settings='{}'::jsonb WHERE id=$1",
      [sourceId],
    );
  });

  const authHeaders = () => ({ cookie, origin, "x-csrf-token": csrf });
  const sourceDetail = async () =>
    (
      await test.request(
        "GET",
        `admin/ingestion/sources/${sourceId}`,
        undefined,
        { cookie },
      )
    ).json();
  const channelState = async () =>
    (await sourceDetail()).channelStates.find(
      (state: { id: string }) => state.id === channelId,
    );
  const verify = (overrides: Record<string, unknown> = {}) =>
    test.request(
      "PUT",
      `admin/ingestion/sources/${sourceId}/channels/${channelId}/verification`,
      {
        status: "verified",
        checkedAt: new Date().toISOString().slice(0, 10),
        sampleUrls: [sampleUrl],
        paginationResult: "success",
        operationId: randomUUID(),
        reason: "完成公开通知与分页人工核验",
        ...overrides,
      },
      authHeaders(),
    );

  it("来源详情显示栏目核验状态，27 院目录只读且未混入可执行来源", async () => {
    expect(
      (await test.request("GET", `admin/ingestion/sources/${sourceId}`))
        .statusCode,
    ).toBe(401);
    await test.pool.query(
      'UPDATE ingestion_sources SET data=data || \'{"readProbe":"preserve"}\'::jsonb WHERE id=$1',
      [sourceId],
    );
    const detail = await sourceDetail();
    expect(
      (
        await test.pool.query(
          "SELECT data->>'readProbe' AS probe FROM ingestion_sources WHERE id=$1",
          [sourceId],
        )
      ).rows[0].probe,
    ).toBe("preserve");
    expect(detail.channelStates).toEqual([
      expect.objectContaining({
        id: channelId,
        enabled: false,
        verificationStatus: "pending",
        baseline: expect.stringMatching(/^[a-f0-9]{64}$/),
        coverage: expect.any(Object),
        pendingCount: 0,
      }),
    ]);
    const candidates = await test.request(
      "GET",
      "admin/ingestion/coverage-candidates",
      undefined,
      { cookie },
    );
    expect(candidates.statusCode).toBe(200);
    expect(candidates.json()).toHaveLength(27);
    expect(
      candidates
        .json()
        .every(
          (candidate: {
            status: string;
            candidateChannels: { enabled: boolean }[];
          }) =>
            candidate.status === "pending" &&
            candidate.candidateChannels.every(
              (channel) => channel.enabled === false,
            ),
        ),
    ).toBe(true);
    const executableSources = await test.request(
      "GET",
      "admin/ingestion/sources",
      undefined,
      { cookie },
    );
    const registeredChannelIds = executableSources
      .json()
      .flatMap((source: { channels: { id: string }[] }) =>
        source.channels.map((channel) => channel.id),
      );
    expect(
      candidates
        .json()
        .flatMap((candidate: { candidateChannels: { channelId: string }[] }) =>
          candidate.candidateChannels.map((channel) => channel.channelId),
        )
        .some((id: string) => registeredChannelIds.includes(id)),
    ).toBe(false);
    expect(
      (await test.request("GET", "admin/ingestion/coverage-candidates"))
        .statusCode,
    ).toBe(401);
  });

  it("栏目配置拒绝未核验启用、未知对象和过期基线，并支持 operationId 幂等", async () => {
    const initial = await channelState();
    const url = `admin/ingestion/sources/${sourceId}/channels/${channelId}`;
    const command = {
      enabled: true,
      baseline: initial.baseline,
      operationId: randomUUID(),
      reason: "启用未核验栏目应失败",
    };
    expect(
      (await test.request("PATCH", url, command, authHeaders())).statusCode,
    ).toBe(409);
    expect(
      (
        await test.request(
          "PATCH",
          `admin/ingestion/sources/${sourceId}/channels/missing`,
          command,
          authHeaders(),
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (await test.request("PATCH", url, command, { cookie, origin }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await test.request("PATCH", url, command, {
          ...authHeaders(),
          origin: "https://untrusted.invalid",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await test.request(
          "PATCH",
          `admin/ingestion/sources/missing/channels/${channelId}`,
          command,
          authHeaders(),
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await test.request(
          "PATCH",
          url,
          { ...command, host: "evil.invalid" },
          authHeaders(),
        )
      ).statusCode,
    ).toBe(400);

    const verified = await verify();
    expect(verified.statusCode).toBe(200);
    const ready = await channelState();
    const configureUrl = `admin/ingestion/sources/${sourceId}/channels/${channelId}`;
    const update = {
      enabled: true,
      settings: { maxPages: 4 },
      baseline: ready.baseline,
      operationId: randomUUID(),
      reason: "启用已核验的栏目并调小抓取页数",
    };
    const first = await test.request(
      "PATCH",
      configureUrl,
      update,
      authHeaders(),
    );
    expect(first.statusCode).toBe(200);
    const retry = await test.request(
      "PATCH",
      configureUrl,
      update,
      authHeaders(),
    );
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(first.json());
    const stale = await test.request(
      "PATCH",
      configureUrl,
      { ...update, operationId: randomUUID() },
      authHeaders(),
    );
    expect(stale.statusCode).toBe(409);
  });

  it("核验 URL 限定当前栏目通知路径，分页成功才通过，并追加保留核验历史", async () => {
    const foreignHost = await verify({
      sampleUrls: ["https://other.sicau.edu.cn/info/101/2026.htm"],
    });
    expect(foreignHost.statusCode).toBe(400);
    const wrongPath = await verify({
      sampleUrls: ["https://fixture.sicau.edu.cn/notices/list.htm"],
    });
    expect(wrongPath.statusCode).toBe(400);
    const incomplete = await verify({ paginationResult: "inconclusive" });
    expect(incomplete.statusCode).toBe(400);
    const future = await verify({ checkedAt: "2999-01-01" });
    expect(future.statusCode).toBe(400);

    expect((await verify()).statusCode).toBe(200);
    const pending = await test.request(
      "PUT",
      `admin/ingestion/sources/${sourceId}/channels/${channelId}/verification`,
      {
        status: "pending",
        checkedAt: new Date().toISOString().slice(0, 10),
        sampleUrls: [],
        paginationResult: "inconclusive",
        operationId: randomUUID(),
        reason: "等待补充分页和日期证据",
      },
      authHeaders(),
    );
    expect(pending.statusCode).toBe(200);
    const history = (
      await test.pool.query(
        "SELECT verification,verification_status,enabled FROM ingestion_channels WHERE source_id=$1 AND id=$2",
        [sourceId, channelId],
      )
    ).rows[0];
    expect(history.verification_status).toBe("pending");
    expect(history.enabled).toBe(false);
    expect(history.verification).toHaveLength(2);
    expect(
      history.verification.map((entry: { status: string }) => entry.status),
    ).toEqual(["verified", "pending"]);
  });

  it("旧来源 PATCH 不能替未核验栏目绕过核验", async () => {
    const disabled = await test.request(
      "PATCH",
      `admin/ingestion/sources/${sourceId}`,
      {
        enabled: false,
        baseline: (await sourceDetail()).baseline,
        operationId: randomUUID(),
        reason: "测试来源级开关",
      },
      authHeaders(),
    );
    expect(disabled.statusCode).toBe(200);
    const enabled = await test.request(
      "PATCH",
      `admin/ingestion/sources/${sourceId}`,
      {
        enabled: true,
        baseline: disabled.json().baseline,
        operationId: randomUUID(),
        reason: "尝试绕过栏目核验",
      },
      authHeaders(),
    );
    expect(enabled.statusCode).toBe(409);
  });

  it("续跑拒绝已停用栏目及不匹配当前静态定义的 config_hash", async () => {
    const runId = randomUUID();
    await test.pool.query(
      `INSERT INTO ingestion_runs(
         id,source_id,channel_id,phase,config_hash,trigger,status,options,cursor,counts
       ) VALUES($1,$2,$3,'fresh',$4,'manual','partial',$5,$6,$7)`,
      [
        runId,
        sourceId,
        channelId,
        "0".repeat(64),
        JSON.stringify({
          sourceId,
          channelId,
          phase: "fresh",
          from: "2026-10-01",
          to: "2026-10-28",
        }),
        JSON.stringify({
          pages: [],
          seen: [],
          pending: [{ url: sampleUrl, title: "竞赛通知", publishedAt: null }],
        }),
        JSON.stringify({
          discovered: 1,
          new: 0,
          changed: 0,
          unchanged: 0,
          ignored: 0,
          failed: 0,
        }),
      ],
    );
    const resumeUrl = `admin/ingestion/runs/${runId}/resume`;
    const command = {
      operationId: randomUUID(),
      reason: "检查栏目状态与静态定义指纹",
    };
    expect(
      (await test.request("POST", resumeUrl, command, authHeaders()))
        .statusCode,
    ).toBe(409);

    expect((await verify()).statusCode).toBe(200);
    const ready = await channelState();
    expect(
      (
        await test.request(
          "PATCH",
          `admin/ingestion/sources/${sourceId}/channels/${channelId}`,
          {
            enabled: true,
            baseline: ready.baseline,
            operationId: randomUUID(),
            reason: "启用核验通过的栏目",
          },
          authHeaders(),
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await test.request(
          "POST",
          resumeUrl,
          { ...command, operationId: randomUUID() },
          authHeaders(),
        )
      ).statusCode,
    ).toBe(409);
  });

  it("自定义日期不能绕过backfill的启用日期固定范围", async () => {
    expect((await verify()).statusCode).toBe(200);
    const current = await channelState();
    expect(
      (
        await test.request(
          "PATCH",
          `admin/ingestion/sources/${sourceId}/channels/${channelId}`,
          {
            enabled: true,
            baseline: current.baseline,
            operationId: randomUUID(),
            reason: "测试固定补抓范围",
          },
          authHeaders(),
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await test.request(
          "POST",
          "admin/ingestion/scans",
          {
            sourceId,
            channelId,
            phase: "backfill",
            from: "2026-01-01",
            to: "2026-01-02",
            operationId: randomUUID(),
            reason: "不允许改写固定补抓范围",
          },
          authHeaders(),
        )
      ).statusCode,
    ).toBe(400);
  });
  it("调度轮协调锁占用时HTTP扫描受理返回409，不另取一份网络预算", async () => {
    expect((await verify()).statusCode).toBe(200);
    const current = await channelState();
    expect(
      (
        await test.request(
          "PATCH",
          `admin/ingestion/sources/${sourceId}/channels/${channelId}`,
          {
            enabled: true,
            baseline: current.baseline,
            operationId: randomUUID(),
            reason: "验证共享协调锁",
          },
          authHeaders(),
        )
      ).statusCode,
    ).toBe(200);
    const coordinator = await test.pool.connect();
    await coordinator.query("SELECT pg_advisory_lock(23006)");
    try {
      expect(
        (
          await test.request(
            "POST",
            "admin/ingestion/scans",
            {
              sourceId,
              channelId,
              phase: "fresh",
              operationId: randomUUID(),
              reason: "调度轮中不得插入独立扫描",
            },
            authHeaders(),
          )
        ).statusCode,
      ).toBe(409);
    } finally {
      await coordinator.query("SELECT pg_advisory_unlock(23006)");
      coordinator.release(true);
    }
  });
  it("扫描阶段和固定栏目范围传给runner，preview不写运行或任务", async () => {
    expect((await verify()).statusCode).toBe(200);
    const current = await channelState();
    const configured = await test.request(
      "PATCH",
      `admin/ingestion/sources/${sourceId}/channels/${channelId}`,
      {
        enabled: true,
        baseline: current.baseline,
        operationId: randomUUID(),
        reason: "启用人工核验通过的测试栏目",
      },
      authHeaders(),
    );
    expect(configured.statusCode).toBe(200);

    const calls: ScanOptions[] = [];
    test.app.get(AdminIngestionService).runner = {
      scan: async (options: ScanOptions) => {
        calls.push(options);
        return {
          status: "succeeded",
          source: options.sourceId,
          counts: {
            discovered: 0,
            new: 0,
            changed: 0,
            unchanged: 0,
            ignored: 0,
            failed: 0,
          },
          errors: [],
          cursor: { pages: [], pending: [], seen: [] },
          previews: [],
        } as unknown as Awaited<ReturnType<IngestionRunner["scan"]>>;
      },
    } as unknown as IngestionRunner;
    const before = (
      await test.pool.query(
        `SELECT (SELECT count(*)::int FROM ingestion_runs) AS runs,
                (SELECT count(*)::int FROM ingestion_scan_tasks) AS tasks`,
      )
    ).rows[0];
    const accepted = await test.request(
      "POST",
      "admin/ingestion/scans",
      {
        sourceId,
        channelId,
        phase: "backfill",
        preview: true,
        operationId: randomUUID(),
        reason: "验证按栏目执行的只读预览",
      },
      authHeaders(),
    );
    expect(accepted.statusCode).toBe(202);
    let request = {} as Record<string, unknown>;
    for (let attempt = 0; attempt < 200; attempt++) {
      const response = await test.request(
        "GET",
        `admin/ingestion/requests/${accepted.json().requestId}`,
        undefined,
        { cookie },
      );
      request = response.json();
      if (!["accepted", "running"].includes(request.status as string)) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(request).toMatchObject({
      status: "completed",
      channelId,
      phase: "backfill",
      taskProgress: null,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      sourceId,
      channelId,
      phase: "backfill",
      preview: true,
    });
    const activationDate = (await channelState()).activatedOn;
    expect(calls[0]?.from).toBe(
      new Date(Date.parse(activationDate) - 365 * 86400000)
        .toISOString()
        .slice(0, 10),
    );
    expect(calls[0]?.to).toBe(activationDate);
    const after = (
      await test.pool.query(
        `SELECT (SELECT count(*)::int FROM ingestion_runs) AS runs,
                (SELECT count(*)::int FROM ingestion_scan_tasks) AS tasks`,
      )
    ).rows[0];
    expect(after).toEqual(before);
  });
});
