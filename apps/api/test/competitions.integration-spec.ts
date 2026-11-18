import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { CompetitionRepository } from "../src/competitions/competition.repository.js";
import { DatabaseService } from "../src/database/database.service.js";
import {
  CompetitionClock,
  CompetitionService,
} from "../src/competitions/competition.service.js";
import { importBatch, validateInput } from "../src/competitions/import.js";
import { directory, edition, testDatabase } from "./competition-fixture.js";
import { readCatalog } from "../src/competitions/catalog.js";

describe("PostgreSQL 导入与查询", () => {
  let isolated: Awaited<ReturnType<typeof testDatabase>>;
  let database: DatabaseService;
  let service: CompetitionService;
  const clock = new CompetitionClock();
  beforeAll(async () => {
    isolated = await testDatabase();
    database = new DatabaseService(
      new ConfigService({ DATABASE_URL: isolated.url }),
    );
    service = new CompetitionService(
      new CompetitionRepository(database),
      clock,
    );
    jest
      .spyOn(clock, "now")
      .mockReturnValue(new Date("2026-10-10T12:00:00+08:00"));
  });
  afterAll(async () => {
    await database?.onApplicationShutdown();
    await isolated?.close();
  });
  beforeEach(async () => {
    await isolated.pool.query(
      "TRUNCATE colleges,competitions,stages,tracks,notices,stage_hosts,stage_eligibility,stage_sources CASCADE",
    );
  });
  async function seed() {
    await importBatch(isolated.pool, {
      colleges: directory,
      competitions: [edition()],
    });
  }
  async function record() {
    const c = await isolated.pool.connect();
    try {
      return (await readCatalog(c)).competitions[0]!;
    } finally {
      c.release();
    }
  }
  it("迁移、目录、重复导入、持久化与预览", async () => {
    await seed();
    expect(await service.colleges()).toEqual(directory);
    expect(
      (
        await importBatch(isolated.pool, {
          colleges: directory,
          competitions: [edition()],
        })
      ).changes,
    ).toEqual([]);
    expect(
      (await isolated.pool.query("SELECT count(*) FROM stages")).rows[0].count,
    ).toBe("1");
    const preview = await importBatch(
      isolated.pool,
      { competitions: [{ id: "alpha", name: "更新" }] },
      { preview: true },
    );
    expect(preview.changes).toMatchObject([{ action: "update", id: "alpha" }]);
    expect((await service.detail("alpha")).name).toBe("测试比赛 alpha");
    const reopened = new DatabaseService(
      new ConfigService({ DATABASE_URL: isolated.url }),
    );
    expect(
      (
        await new CompetitionService(
          new CompetitionRepository(reopened),
          clock,
        ).detail("alpha")
      ).id,
    ).toBe("alpha");
    await reopened.onApplicationShutdown();
  });
  it("关系缺省保留、集合替换、显式空清空，实体不删除，预览列出解除关系", async () => {
    await seed();
    await importBatch(
      isolated.pool,
      {
        competitions: [
          { id: "alpha", stages: [{ id: "alpha-stage", name: "更名" }] },
        ],
      },
      { confirmPublished: true },
    );
    expect((await record()).stages[0].hosts.sort()).toEqual(["law", "science"]);
    const patch = {
      competitions: [
        {
          id: "alpha",
          stages: [
            { id: "alpha-stage", hosts: ["science"], scope: { colleges: [] } },
          ],
        },
      ],
    };
    const preview = await importBatch(isolated.pool, patch, {
      preview: true,
      confirmPublished: true,
    });
    expect(preview.changes[0].removed).toContain("alpha-stage.hosts:law");
    await importBatch(isolated.pool, patch, { confirmPublished: true });
    expect((await record()).stages[0].hosts).toEqual(["science"]);
    await importBatch(
      isolated.pool,
      {
        competitions: [
          {
            id: "alpha",
            publication: "hidden",
            stages: [{ id: "alpha-stage", hosts: [], sourceIds: [] }],
          },
        ],
      },
      { confirmPublished: true },
    );
    expect((await record()).stages[0]).toMatchObject({
      hosts: [],
      sourceIds: [],
    });
    expect((await record()).notices).toHaveLength(1);
    expect(await service.colleges()).toHaveLength(2);
  });
  it("已发布内容未经确认不改，失败整批回滚，缺失记录不删除", async () => {
    await seed();
    await expect(
      importBatch(isolated.pool, {
        competitions: [
          { id: "alpha", stages: [{ id: "alpha-stage", hosts: [] }] },
        ],
      }),
    ).rejects.toThrow("confirm-published");
    await expect(
      importBatch(
        isolated.pool,
        {
          colleges: [{ id: "new", name: "新", order: 3 }],
          competitions: [
            { id: "alpha", stages: [{ id: "alpha-stage", hosts: ["bad"] }] },
          ],
        },
        { confirmPublished: true },
      ),
    ).rejects.toThrow();
    expect(await service.colleges()).toHaveLength(2);
    await importBatch(isolated.pool, { competitions: [edition("beta")] });
    expect(
      (await isolated.pool.query("SELECT count(*) FROM competitions")).rows[0]
        .count,
    ).toBe("2");
  });
  it("数据库写入失败亦整批回滚", async () => {
    await seed();
    await expect(
      importBatch(isolated.pool, {
        colleges: [
          { id: "new", name: "新", order: 3 },
          { id: "duplicate-order", name: "重复", order: 0 },
        ],
      }),
    ).rejects.toThrow();
    expect(await service.colleges()).toHaveLength(2);
  });
  it("草稿缺省、隐藏与不存在都404；公开读不暴露发布状态", async () => {
    await importBatch(isolated.pool, {
      colleges: directory,
      competitions: [
        edition("draft", { publication: undefined }),
        edition("hidden", { publication: "hidden" }),
        edition(),
      ],
    });
    expect((await service.list("/competitions")).totalCompetitions).toBe(1);
    for (const id of ["draft", "hidden", "missing"])
      await expect(service.detail(id)).rejects.toThrow();
    expect(await service.detail("alpha")).not.toHaveProperty("publication");
  });
  it.each([
    "javascript:alert(1)",
    "https://sicau.edu.cn.evil.com/a",
    "https://evil-sicau.edu.cn/a",
    "https://user@sicau.edu.cn/a",
  ])("拒绝危险来源 %s", async (url) => {
    const r = edition();
    r.notices![0].url = url;
    await expect(
      importBatch(isolated.pool, { colleges: directory, competitions: [r] }),
    ).rejects.toThrow("URL");
  });
  it("手工通道接受公开HTTPS外域，采集通道仍只认学校域名", async () => {
    const manual = edition("manual");
    manual.notices![0].url =
      "https://www.moe.gov.cn/s78/A08/tongzhi/2026/1.html";
    await expect(
      importBatch(isolated.pool, {
        colleges: directory,
        competitions: [manual],
      }),
    ).rejects.toThrow("学校");
    await importBatch(
      isolated.pool,
      { colleges: directory, competitions: [manual] },
      { mode: "manual" },
    );
    expect(
      (
        await isolated.pool.query(
          "SELECT data->>'url' AS url FROM notices WHERE id=$1",
          ["manual-notice"],
        )
      ).rows[0].url,
    ).toBe("https://www.moe.gov.cn/s78/A08/tongzhi/2026/1.html");
  });
  it("库中已有手工外链不阻断无关的采集导入，采集通道改它仍被拒绝", async () => {
    const manual = edition("manual");
    manual.notices![0].url = "https://www.gov.cn/zhengce/2026/contest.htm";
    await importBatch(
      isolated.pool,
      { colleges: directory, competitions: [manual] },
      { mode: "manual" },
    );
    await importBatch(isolated.pool, {
      colleges: directory,
      competitions: [edition("beta")],
    });
    expect(
      (await isolated.pool.query("SELECT count(*) FROM competitions")).rows[0]
        .count,
    ).toBe("2");
    await expect(
      importBatch(
        isolated.pool,
        { competitions: [{ id: "manual", name: "采集试图改名" }] },
        { confirmPublished: true },
      ),
    ).rejects.toThrow("学校");
    expect(
      (
        await isolated.pool.query(
          "SELECT data->>'name' AS name FROM competitions WHERE id='manual'",
        )
      ).rows[0].name,
    ).toBe("测试比赛 manual");
  });
  it("拒绝坏ID、非法日期、原始HTML、跨届来源和生产demo", async () => {
    expect(() => validateInput({ competitions: [{ id: "../bad" }] })).toThrow();
    expect(() =>
      validateInput({ competitions: [{ id: "alpha", name: "<script>" }] }),
    ).toThrow();
    expect(() =>
      validateInput({
        competitions: [
          {
            id: "alpha",
            notices: [{ id: "source", publishedAt: "2026-02-30" }],
          },
        ],
      }),
    ).toThrow();
    const r = edition("beta");
    r.stages![0].sourceIds = ["alpha-notice"];
    await expect(
      importBatch(isolated.pool, {
        colleges: directory,
        competitions: [edition(), r],
      }),
    ).rejects.toThrow("跨届");
    await expect(
      importBatch(
        isolated.pool,
        {
          colleges: directory,
          competitions: [edition("demo", { origin: "demo" })],
        },
        { production: true },
      ),
    ).rejects.toThrow("demo");
  });
  it("开始晚于截止默认拒绝发布；确认来源冲突可公开为 conflict", async () => {
    const r = edition();
    r.stages![0].startsAt = {
      precision: "instant",
      value: "2026-10-14T00:00:00+08:00",
    };
    await expect(
      importBatch(isolated.pool, { colleges: directory, competitions: [r] }),
    ).rejects.toThrow("开始晚于");
    r.stages![0].conflict = true;
    r.stages![0].timeNote = "官方报名通知时间冲突，需核对";
    await importBatch(isolated.pool, {
      colleges: directory,
      competitions: [r],
    });
    expect(
      (await service.list("/competitions?status=conflict")).totalStages,
    ).toBe(1);
    expect((await service.detail("alpha")).stages[0].status).toBe("conflict");
  });
  it("EXISTS避免多关系重复，先全量过滤、总数去重、超页与空页", async () => {
    const r = edition();
    r.stages!.push({ ...r.stages![0], id: "alpha-stage-two", order: 1 });
    await importBatch(isolated.pool, {
      colleges: directory,
      competitions: [r, edition("beta")],
    });
    const page = await service.list(
      "/competitions?hosts=all&hosts=law,science&pageSize=1&page=99",
    );
    expect(page).toMatchObject({
      page: 3,
      totalStages: 3,
      totalCompetitions: 2,
      totalPages: 3,
      hasMore: false,
    });
    const first = await service.list("/competitions?pageSize=2");
    expect(first.items.map((e) => e.stage.id)).toEqual([
      "alpha-stage",
      "alpha-stage-two",
    ]);
    const empty = await service.list("/competitions?hosts=&page=99");
    expect(empty).toMatchObject({
      page: 1,
      totalPages: 1,
      totalStages: 0,
      totalCompetitions: 0,
      items: [],
    });
    expect((await service.detail("alpha")).stages).toHaveLength(2);
  });
  it("承办、关键词、状态取交集；字面%_；全选含无承办赛段", async () => {
    const r = edition();
    r.name = "比赛%_";
    r.stages!.push({ ...r.stages![0], id: "unhosted", hosts: [], order: 1 });
    await importBatch(isolated.pool, {
      colleges: directory,
      competitions: [r],
    });
    expect(
      (await service.list("/competitions?q=%25_&status=open&hosts=law"))
        .totalStages,
    ).toBe(1);
    expect((await service.list("/competitions?hosts=all")).totalStages).toBe(2);
    expect(
      (await service.list("/competitions?hosts=law,science")).totalStages,
    ).toBe(1);
    expect((await service.list("/competitions?hosts=bad")).totalStages).toBe(0);
    expect(
      (await service.list("/competitions?status=closed")).totalStages,
    ).toBe(0);
  });
  it.each(["registration", "supplement", "award", "news"] as const)(
    "全部通知类型 %s 参与最大日期；checkedAt不排序",
    async (kind) => {
      const a = edition("alpha");
      const b = edition("beta");
      const c = edition("gamma");
      b.notices!.push({
        ...b.notices![0],
        id: "beta-second",
        kind,
        publishedAt: "2026-09-02",
        checkedAt: "2026-01-01",
      });
      a.notices![0].checkedAt = "2026-12-01";
      c.notices![0].publishedAt = null;
      await importBatch(isolated.pool, {
        colleges: directory,
        competitions: [a, b, c],
      });
      expect(
        (await service.list("/competitions")).items.map(
          (e) => e.competition.id,
        ),
      ).toEqual(["beta", "alpha", "gamma"]);
    },
  );
  it("各级并列稳定排序与分页无漏项", async () => {
    const r = edition();
    r.stages!.push(
      { ...r.stages![0], id: "alpha-stage-b", order: 0 },
      { ...r.stages![0], id: "alpha-stage-a", order: 0 },
    );
    await importBatch(isolated.pool, {
      colleges: directory,
      competitions: [edition("beta"), r],
    });
    const ids = [];
    for (let page = 1; page <= 4; page++)
      ids.push(
        (await service.list("/competitions?pageSize=1&page=" + page)).items[0]
          .stage.id,
      );
    expect(ids).toEqual([
      "alpha-stage",
      "alpha-stage-a",
      "alpha-stage-b",
      "beta-stage",
    ]);
  });
  it("三个关系集合均完整替换，移除不删除来源实体", async () => {
    const r = edition();
    r.notices!.push({
      ...r.notices![0],
      id: "alpha-other",
      kind: "supplement",
    });
    r.stages![0].scope = {
      kind: "colleges",
      colleges: ["law"],
      note: "仅指定学院",
    };
    await importBatch(isolated.pool, {
      colleges: directory,
      competitions: [r],
    });
    await importBatch(
      isolated.pool,
      {
        competitions: [
          { id: "alpha", stages: [{ id: "alpha-stage", name: "更名" }] },
        ],
      },
      { confirmPublished: true },
    );
    expect((await record()).stages[0].scope.colleges).toEqual(["law"]);
    expect((await record()).stages[0].sourceIds).toEqual(["alpha-notice"]);
    const patch = {
      competitions: [
        {
          id: "alpha",
          stages: [
            {
              id: "alpha-stage",
              hosts: ["science"],
              scope: { colleges: ["science"] },
              sourceIds: ["alpha-other"],
            },
          ],
        },
      ],
    };
    const preview = await importBatch(isolated.pool, patch, { preview: true });
    expect(preview.changes[0].removed).toEqual(
      expect.arrayContaining([
        "alpha-stage.eligibility:law",
        "alpha-stage.sources:alpha-notice",
      ]),
    );
    await importBatch(isolated.pool, patch, { confirmPublished: true });
    expect((await record()).stages[0]).toMatchObject({
      hosts: ["science"],
      scope: { colleges: ["science"] },
      sourceIds: ["alpha-other"],
    });
    await importBatch(
      isolated.pool,
      {
        competitions: [
          {
            id: "alpha",
            publication: "hidden",
            stages: [
              {
                id: "alpha-stage",
                scope: { kind: "unknown", colleges: [] },
                hosts: [],
                sourceIds: [],
              },
            ],
          },
        ],
      },
      { confirmPublished: true },
    );
    expect((await record()).stages[0].scope.colleges).toEqual([]);
    expect((await record()).notices).toHaveLength(2);
  });
  it("新闻与获奖不能单独证明精确报名窗口", async () => {
    for (const kind of ["news", "award"] as const) {
      const r = edition();
      r.notices![0].kind = kind;
      await expect(
        importBatch(isolated.pool, { colleges: directory, competitions: [r] }),
      ).rejects.toThrow("报名窗口");
    }
  });
  it("不同精度按北京时间判断已知的倒置，不按原始字符串日期误判", async () => {
    const r = edition();
    r.stages![0].startsAt = { precision: "date", value: "2026-10-14" };
    r.stages![0].deadline = {
      precision: "instant",
      value: "2026-10-13T18:00:00Z",
    };
    await importBatch(isolated.pool, {
      colleges: directory,
      competitions: [r],
    });
    expect((await service.detail("alpha")).stages[0].status).toBe("unknown");
  });
  it("SQL与详情状态一致；日期精度次日北京时间、材料不代替报名", async () => {
    const r = edition();
    r.stages![0].deadline = { precision: "date", value: "2026-10-13" };
    r.stages![0].materialsAt = {
      precision: "instant",
      value: "2026-01-01T00:00:00Z",
    };
    await importBatch(isolated.pool, {
      colleges: directory,
      competitions: [r],
    });
    for (const [now, status] of [
      ["2026-10-13T15:59:59Z", "unknown"],
      ["2026-10-13T16:00:00Z", "closed"],
    ]) {
      jest.spyOn(clock, "now").mockReturnValue(new Date(now));
      expect((await service.list("/competitions")).items[0].stage.status).toBe(
        status,
      );
      expect((await service.detail("alpha")).stages[0].status).toBe(status);
    }
    jest
      .spyOn(clock, "now")
      .mockReturnValue(new Date("2026-10-10T12:00:00+08:00"));
  });
});
