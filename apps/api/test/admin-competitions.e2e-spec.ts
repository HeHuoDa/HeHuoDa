import { jest } from "@jest/globals";
import { authTestApp, type AuthTestApp } from "./auth-fixture.js";
import { passwordHash } from "../src/admin/admin-security.js";
import { importBatch } from "../src/competitions/import.js";
import { directory, edition } from "./competition-fixture.js";
import { randomUUID } from "node:crypto";

const ORIGIN = "http://localhost:5173";

// 密码哈希与建库较慢，与既有管理端套件保持一致量级。
jest.setTimeout(120000);

describe("管理端正式比赛接口", () => {
  let test: AuthTestApp;
  let cookie: string;
  let csrf: string;
  let baselineAudits = "0";

  beforeAll(async () => {
    test = await authTestApp();
    const salt = Buffer.alloc(16, 2);
    await test.pool.query(
      "INSERT INTO admin_accounts (username, display_name, password_salt, password_hash) VALUES ($1,$2,$3,$4)",
      [
        "competition-admin",
        "比赛管理员",
        salt,
        await passwordHash("competition-password", salt),
      ],
    );
    const login = await test.request(
      "POST",
      "admin/auth/login",
      { username: "competition-admin", password: "competition-password" },
      { origin: ORIGIN },
    );
    cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    csrf = (
      await test.request("GET", "admin/auth/csrf", undefined, { cookie })
    ).json().csrfToken;
  });

  afterAll(async () => {
    await test?.close();
  });

  beforeEach(async () => {
    await test.pool.query(
      "TRUNCATE colleges,competitions,stages,tracks,notices,stage_hosts,stage_eligibility,stage_sources CASCADE",
    );
    await test.pool.query("DELETE FROM admin_operations");
    await test.pool.query("DELETE FROM admin_competition_commands");
    await test.pool.query("DELETE FROM admin_competition_previews");
    // 登录本身写一条成功审计；以清除后的计数作基线断言“写请求未产生审计”。
    baselineAudits = (
      await test.pool.query("SELECT count(*) FROM admin_operations")
    ).rows[0].count;
  });

  const write = (
    action: "POST" | "PUT",
    url: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    test.request(action, url, body, {
      cookie,
      origin: ORIGIN,
      "x-csrf-token": csrf,
      ...headers,
    });

  async function seed() {
    await importBatch(test.pool, {
      colleges: directory,
      competitions: [
        edition("alpha"),
        edition("draft-one", { publication: "draft" }),
        edition("hidden-one", { publication: "hidden" }),
      ],
    });
  }

  async function baselineOf(id: string) {
    const response = await test.request(
      "GET",
      `admin/competitions/baseline/${id}`,
      undefined,
      { cookie },
    );
    expect(response.statusCode).toBe(200);
    return response.json().baseline as string;
  }

  it("未认证请求不能读写管理端比赛接口", async () => {
    expect((await test.request("GET", "admin/competitions")).statusCode).toBe(
      401,
    );
    // 写请求先校验 Origin，缺少或错误的来源在认证之前就被拒绝。
    const body = {
      operationId: randomUUID(),
      reason: "越权",
      action: "hide",
      baseline: "a".repeat(64),
    };
    expect(
      (await test.request("POST", "admin/competitions/alpha/commands", body))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await test.request("POST", "admin/competitions/alpha/commands", body, {
          origin: ORIGIN,
        })
      ).statusCode,
    ).toBe(401);
  });

  it("缺少 CSRF 或 Origin 不符时写请求被拒绝且不产生审计", async () => {
    const body = {
      operationId: randomUUID(),
      reason: "无 CSRF",
      action: "save",
      baseline: await baselineOf("alpha"),
      patch: { id: "alpha", name: "越权改名" },
    };
    expect(
      (
        await test.request("POST", "admin/competitions/alpha/commands", body, {
          cookie,
          origin: ORIGIN,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await test.request("POST", "admin/competitions/alpha/commands", body, {
          cookie,
          origin: "https://evil.invalid",
          "x-csrf-token": csrf,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await test.pool.query("SELECT count(*) FROM admin_operations")).rows[0]
        .count,
    ).toBe(baselineAudits);
  });

  it("列表分页、状态筛选与检索覆盖全部发布状态", async () => {
    await seed();
    const all = (
      await test.request("GET", "admin/competitions?pageSize=2", undefined, {
        cookie,
      })
    ).json();
    expect(all).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(all.items).toHaveLength(2);
    expect(all.items[0].baseline).toMatch(/^[a-f0-9]{64}$/);

    const second = (
      await test.request(
        "GET",
        "admin/competitions?pageSize=2&page=2",
        undefined,
        {
          cookie,
        },
      )
    ).json();
    expect(
      [...all.items, ...second.items]
        .map((item: { id: string }) => item.id)
        .sort(),
    ).toEqual(["alpha", "draft-one", "hidden-one"]);

    for (const status of ["draft", "published", "hidden"] as const) {
      const page = (
        await test.request(
          `GET`,
          `admin/competitions?status=${status}`,
          undefined,
          {
            cookie,
          },
        )
      ).json();
      expect(page.total).toBe(1);
      expect(page.items[0].publication).toBe(status);
    }

    const search = (
      await test.request(
        "GET",
        "admin/competitions?q=测试比赛 alpha",
        undefined,
        {
          cookie,
        },
      )
    ).json();
    expect(search.total).toBe(1);
    expect(search.items[0].id).toBe("alpha");

    expect(
      (
        await test.request("GET", "admin/competitions?q=%25_", undefined, {
          cookie,
        })
      ).json().total,
    ).toBe(0);
    expect(
      (
        await test.request(
          "GET",
          "admin/competitions?status=deleted",
          undefined,
          {
            cookie,
          },
        )
      ).statusCode,
    ).toBe(400);
    const empty = (
      await test.request("GET", "admin/competitions?page=9", undefined, {
        cookie,
      })
    ).json();
    expect(empty.items).toEqual([]);
    expect(empty.total).toBe(3);
  });

  it("详情可读草稿与隐藏记录，公开接口只返回已发布", async () => {
    await seed();
    for (const id of ["alpha", "draft-one", "hidden-one"]) {
      const detail = await test.request(
        "GET",
        `admin/competitions/${id}`,
        undefined,
        {
          cookie,
        },
      );
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({ id, baseline: expect.any(String) });
    }
    expect(
      (
        await test.request("GET", "admin/competitions/missing", undefined, {
          cookie,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await test.request("GET", "competitions/draft-one")).statusCode,
    ).toBe(404);
    expect(
      (await test.request("GET", "competitions/hidden-one")).statusCode,
    ).toBe(404);
    expect((await test.request("GET", "competitions/alpha")).statusCode).toBe(
      200,
    );
  });

  it("草案可保存未知时间与手工外链，且不改变发布状态", async () => {
    await seed();
    const created = await write(
      "POST",
      "admin/competitions/new-contest/commands",
      {
        operationId: randomUUID(),
        reason: "新建草稿",
        action: "save",
        baseline: await baselineOf("new-contest"),
        patch: {
          id: "new-contest",
          name: "全国大学生创新竞赛",
          edition: "2026",
          category: "创新创业",
          organizer: "教育部",
          publication: "draft",
          notices: [
            {
              id: "new-contest-notice",
              title: "报名通知",
              publisher: "教育部",
              url: "https://www.moe.gov.cn/s78/A08/tongzhi/2026/1.html",
              publishedAt: "2026-09-01",
              checkedAt: null,
              kind: "registration",
            },
          ],
          stages: [
            {
              id: "new-contest-stage",
              name: "全国赛",
              organizer: "教育部",
              scope: { kind: "unknown", colleges: [], note: "范围待核对" },
              startsAt: { precision: "unknown", value: null },
              deadline: { precision: "unknown", value: null },
              registration: "以原通知为准",
              sourceIds: ["new-contest-notice"],
            },
          ],
        },
      },
    );
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      targetId: "new-contest",
      publication: "draft",
      auditOperationId: expect.any(String),
    });
    expect(
      created.json().changes.map((c: { field: string }) => c.field),
    ).toEqual(expect.arrayContaining(["name", "publication"]));
    const stored = await test.pool.query(
      "SELECT data->>'url' AS url FROM notices WHERE id='new-contest-notice'",
    );
    expect(stored.rows[0].url).toBe(
      "https://www.moe.gov.cn/s78/A08/tongzhi/2026/1.html",
    );
  });

  it.each([
    ["HTTP 明文", "http://www.moe.gov.cn/a"],
    ["账号信息", "https://user@www.moe.gov.cn/a"],
    ["非默认端口", "https://www.moe.gov.cn:8443/a"],
    ["IP 字面量", "https://202.115.1.1/a"],
  ])("拒绝不合法手工外链 %s", async (_label, url) => {
    await seed();
    const response = await write("POST", "admin/competitions/alpha/commands", {
      operationId: randomUUID(),
      reason: "写入非法外链",
      action: "save",
      baseline: await baselineOf("alpha"),
      patch: {
        id: "alpha",
        notices: [{ id: "alpha-notice", url }],
      },
      confirmPublished: true,
    });
    expect(response.statusCode).toBe(422);
    expect(
      (
        await test.pool.query(
          "SELECT data->>'url' AS url FROM notices WHERE id='alpha-notice'",
        )
      ).rows[0].url,
    ).toBe("https://sicau.edu.cn/info/1.htm");
  });

  it("发布缺少赛段、赛道、来源或核对日期时按项拒绝并保持原状态", async () => {
    await importBatch(test.pool, {
      colleges: directory,
      competitions: [edition("incomplete", { publication: "draft" })],
    });
    await test.pool.query(
      "DELETE FROM stage_hosts WHERE stage_id='incomplete-stage'",
    );
    await test.pool.query(
      "DELETE FROM stage_sources WHERE stage_id='incomplete-stage'",
    );
    await test.pool.query(
      "DELETE FROM stages WHERE competition_id='incomplete'",
    );
    await test.pool.query(
      "DELETE FROM tracks WHERE competition_id='incomplete'",
    );
    const response = await write(
      "POST",
      "admin/competitions/incomplete/commands",
      {
        operationId: randomUUID(),
        reason: "尝试发布",
        action: "publish",
        baseline: await baselineOf("incomplete"),
      },
    );
    expect(response.statusCode).toBe(422);
    const detail = (
      await test.request("GET", "admin/competitions/incomplete", undefined, {
        cookie,
      })
    ).json();
    expect(detail.publication).toBe("draft");
    expect(
      (
        await test.pool.query(
          "SELECT count(*) FROM admin_operations WHERE result='failure' AND action='competition.publish'",
        )
      ).rows[0].count,
    ).toBe("1");
  });

  it("预览不落库但返回缺口，发布在有缺口时被拒绝", async () => {
    await importBatch(test.pool, {
      colleges: directory,
      competitions: [edition("alpha", { publication: "draft" })],
    });
    await test.pool.query(
      "DELETE FROM stage_hosts WHERE stage_id='alpha-stage'",
    );
    await test.pool.query(
      "DELETE FROM stage_sources WHERE stage_id='alpha-stage'",
    );
    await test.pool.query("DELETE FROM tracks WHERE competition_id='alpha'");
    const preview = await write("POST", "admin/competitions/alpha/preview", {
      operationId: randomUUID(),
      reason: "预览发布",
      action: "publish",
      baseline: await baselineOf("alpha"),
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().blocks.map((b: { code: string }) => b.code)).toEqual([
      "TRACK_MISSING",
      "SOURCE_UNLINKED",
    ]);
    expect(
      (await test.pool.query("SELECT count(*) FROM tracks")).rows[0].count,
    ).toBe("0");
    const publish = await write("POST", "admin/competitions/alpha/commands", {
      operationId: randomUUID(),
      reason: "发布",
      action: "publish",
      baseline: await baselineOf("alpha"),
    });
    expect(publish.statusCode).toBe(422);
  });

  it("发布成功后公开端可见；隐藏后公开列表与详情均不可见但后台保留", async () => {
    await seed();
    const published = await write(
      "POST",
      "admin/competitions/draft-one/commands",
      {
        operationId: randomUUID(),
        reason: "发布",
        action: "publish",
        baseline: await baselineOf("draft-one"),
      },
    );
    expect(published.statusCode).toBe(200);
    expect(published.json().publication).toBe("published");
    expect(
      (await test.request("GET", "competitions/draft-one")).statusCode,
    ).toBe(200);

    const hidden = await write(
      "POST",
      "admin/competitions/draft-one/commands",
      {
        operationId: randomUUID(),
        reason: "下架",
        action: "hide",
        baseline: published.json().baseline,
      },
    );
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json().publication).toBe("hidden");
    expect(
      (await test.request("GET", "competitions/draft-one")).statusCode,
    ).toBe(404);
    const adminDetail = await test.request(
      "GET",
      "admin/competitions/draft-one",
      undefined,
      { cookie },
    );
    expect(adminDetail.statusCode).toBe(200);
    expect(adminDetail.json().publication).toBe("hidden");
    expect(
      (await test.request("GET", "competitions"))
        .json()
        .items.map(
          (item: { competition: { id: string } }) => item.competition.id,
        ),
    ).not.toContain("draft-one");
  });

  it("修改已发布记录须 confirmPublished，旧基线返回 409", async () => {
    await seed();
    const stale = await baselineOf("alpha");
    const noConfirm = await write("POST", "admin/competitions/alpha/commands", {
      operationId: randomUUID(),
      reason: "改已发布",
      action: "save",
      baseline: stale,
      patch: { id: "alpha", name: "改名" },
    });
    expect(noConfirm.statusCode).toBe(409);
    expect(
      (
        await test.pool.query(
          "SELECT data->>'name' AS name FROM competitions WHERE id='alpha'",
        )
      ).rows[0].name,
    ).toBe("测试比赛 alpha");

    const confirmed = await write("POST", "admin/competitions/alpha/commands", {
      operationId: randomUUID(),
      reason: "确认改名",
      action: "save",
      baseline: stale,
      patch: { id: "alpha", name: "改名" },
      confirmPublished: true,
    });
    expect(confirmed.statusCode).toBe(200);
    const another = await write("POST", "admin/competitions/alpha/commands", {
      operationId: randomUUID(),
      reason: "旧基线",
      action: "save",
      baseline: stale,
      patch: { id: "alpha", name: "又一次" },
      confirmPublished: true,
    });
    expect(another.statusCode).toBe(409);
    expect(another.json().message).toContain("基线");
  });

  it("同一 operationId 重试返回原结果；异载荷返回 409 且不重复写入", async () => {
    await seed();
    const baseline = await baselineOf("alpha");
    const operationId = randomUUID();
    const command = {
      operationId,
      reason: "改名",
      action: "save",
      baseline,
      patch: { id: "alpha", name: "首次结果" },
      confirmPublished: true,
    };
    const first = await write(
      "POST",
      "admin/competitions/alpha/commands",
      command,
    );
    expect(first.statusCode).toBe(200);
    const retry = await write(
      "POST",
      "admin/competitions/alpha/commands",
      command,
    );
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(first.json());
    expect(
      (
        await test.pool.query(
          "SELECT count(*) FROM admin_operations WHERE result='success' AND action='competition.update'",
        )
      ).rows[0].count,
    ).toBe("1");
    const conflict = await write("POST", "admin/competitions/alpha/commands", {
      ...command,
      patch: { id: "alpha", name: "另一载荷" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(
      (
        await test.pool.query(
          "SELECT data->>'name' AS name FROM competitions WHERE id='alpha'",
        )
      ).rows[0].name,
    ).toBe("首次结果");
  });

  it("并发修改同一基线最多一个成功，另一个得到 409", async () => {
    await seed();
    const baseline = await baselineOf("alpha");
    const results = await Promise.all(
      ["并发甲", "并发乙"].map((name) =>
        write("POST", "admin/competitions/alpha/commands", {
          operationId: randomUUID(),
          reason: name,
          action: "save",
          baseline,
          patch: { id: "alpha", name },
          confirmPublished: true,
        }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const winner = results.find((r) => r.statusCode === 200)!.json();
    expect(
      (
        await test.pool.query(
          "SELECT data->>'name' AS name FROM competitions WHERE id='alpha'",
        )
      ).rows[0].name,
    ).toBe(
      winner.changes.find((c: { field: string }) => c.field === "name")!
        .current,
    );
  });

  it("预览回执过期或不匹配时拒绝提交", async () => {
    await seed();
    const baseline = await baselineOf("alpha");
    const preview = await write("POST", "admin/competitions/alpha/preview", {
      operationId: randomUUID(),
      reason: "预览改名",
      action: "save",
      baseline,
      patch: { id: "alpha", name: "预览后的名字" },
    });
    expect(preview.statusCode).toBe(200);
    const mismatched = await write(
      "POST",
      "admin/competitions/alpha/commands",
      {
        operationId: randomUUID(),
        reason: "不匹配",
        action: "save",
        baseline,
        patch: { id: "alpha", name: "另一个名字" },
        previewId: preview.json().previewId,
        confirmPublished: true,
      },
    );
    expect(mismatched.statusCode).toBe(409);
    const applied = await write("POST", "admin/competitions/alpha/commands", {
      operationId: randomUUID(),
      reason: "按预览提交",
      action: "save",
      baseline,
      patch: { id: "alpha", name: "预览后的名字" },
      previewId: preview.json().previewId,
      confirmPublished: true,
    });
    expect(applied.statusCode).toBe(200);
    expect(
      (
        await test.pool.query(
          "SELECT data->>'name' AS name FROM competitions WHERE id='alpha'",
        )
      ).rows[0].name,
    ).toBe("预览后的名字");
    const reused = await write("POST", "admin/competitions/alpha/commands", {
      operationId: randomUUID(),
      reason: "复用回执",
      action: "save",
      baseline: applied.json().baseline,
      patch: { id: "alpha", name: "预览后的名字" },
      previewId: preview.json().previewId,
      confirmPublished: true,
    });
    expect(reused.statusCode).toBe(409);
  });

  it("save 不能靠 patch.publication 绕过发布底线", async () => {
    await importBatch(test.pool, {
      colleges: directory,
      competitions: [edition("alpha", { publication: "draft" })],
    });
    const response = await write("POST", "admin/competitions/alpha/commands", {
      operationId: randomUUID(),
      reason: "想靠保存发布",
      action: "save",
      baseline: await baselineOf("alpha"),
      patch: { id: "alpha", name: "改名", publication: "published" },
    });
    expect(response.statusCode).toBe(400);
    const row = (
      await test.pool.query(
        "SELECT publication FROM competitions WHERE id='alpha'",
      )
    ).rows[0];
    expect(row.publication).toBe("draft");
  });

  it("并发新建同一届次最多一个成功，另一个得到 409 而非 500", async () => {
    await importBatch(test.pool, { colleges: directory, competitions: [] });
    const baseline = await baselineOf("brand-new");
    const results = await Promise.all(
      ["新建甲", "新建乙"].map((name) =>
        write("POST", "admin/competitions/brand-new/commands", {
          operationId: randomUUID(),
          reason: name,
          action: "save",
          baseline,
          patch: {
            id: "brand-new",
            name,
            edition: "2026",
            category: "测试",
            organizer: "学校",
          },
        }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(
      (
        await test.pool.query(
          "SELECT count(*) FROM competitions WHERE id='brand-new'",
        )
      ).rows[0].count,
    ).toBe("1");
  });

  it("审计 ID 始终是真实存在的记录", async () => {
    await seed();
    const response = await write("POST", "admin/competitions/alpha/commands", {
      operationId: randomUUID(),
      reason: "隐藏",
      action: "hide",
      baseline: await baselineOf("alpha"),
    });
    const auditOperationId = response.json().auditOperationId;
    expect(auditOperationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(
      (
        await test.pool.query(
          "SELECT count(*) FROM admin_operations WHERE operation_id=$1",
          [auditOperationId],
        )
      ).rows[0].count,
    ).toBe("1");
  });

  it.each([
    ["HTML 注入", "https://www.moe.gov.cn/<script>alert(1)</script>"],
    ["路径含尖括号", "https://www.moe.gov.cn/a<b>"],
  ])("拒绝%s的外链", async (_label, url) => {
    await seed();
    const response = await write("POST", "admin/competitions/alpha/commands", {
      operationId: randomUUID(),
      reason: "写入含标记的外链",
      action: "save",
      baseline: await baselineOf("alpha"),
      patch: { id: "alpha", notices: [{ id: "alpha-notice", url }] },
      confirmPublished: true,
    });
    expect(response.statusCode).toBe(422);
  });

  it("允许路径或查询串里含 @ 的公开外链", async () => {
    await seed();
    const response = await write("POST", "admin/competitions/alpha/commands", {
      operationId: randomUUID(),
      reason: "合法 @ 路径",
      action: "save",
      baseline: await baselineOf("alpha"),
      patch: {
        id: "alpha",
        notices: [
          {
            id: "alpha-notice",
            url: "https://www.moe.gov.cn/notice/@2026/index.html",
          },
        ],
      },
      confirmPublished: true,
    });
    expect(response.statusCode).toBe(200);
    expect(
      (
        await test.pool.query(
          "SELECT data->>'url' AS url FROM notices WHERE id='alpha-notice'",
        )
      ).rows[0].url,
    ).toBe("https://www.moe.gov.cn/notice/@2026/index.html");
  });

  it("请求体伪造 actor 字段被拒绝", async () => {
    await seed();
    const response = await write("POST", "admin/competitions/alpha/commands", {
      operationId: randomUUID(),
      reason: "伪造",
      action: "hide",
      baseline: await baselineOf("alpha"),
      actorId: randomUUID(),
    });
    expect(response.statusCode).toBe(400);
  });
});
