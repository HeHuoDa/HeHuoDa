import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { SchedulerRegistry } from "@nestjs/schedule";
import { configureApp } from "../src/configure-app.js";
import { IngestionScheduler } from "../src/ingestion/ingestion.module.js";
import { IngestionRunner } from "../src/ingestion/runner.js";
import {
  BoundedFetcher,
  type Transport,
} from "@hehuoda/sicau-connectors/notices";
import {
  approveReview,
  applyReview,
  exportReview,
  publishImported,
} from "../src/ingestion/review.js";
import { informationArticle } from "./notice-fixtures.js";
import { importBatch } from "../src/competitions/import.js";
import { correctedReview } from "./ingestion-fixture.js";
import { testDatabase, directory } from "./competition-fixture.js";

describe("采集审核发布与公开首页 API", () => {
  let db: Awaited<ReturnType<typeof testDatabase>>, app: NestFastifyApplication;
  let previous: string | undefined, previousEnabled: string | undefined;
  beforeAll(async () => {
    db = await testDatabase();
    previous = process.env.DATABASE_URL;
    previousEnabled = process.env.INGESTION_ENABLED;
    process.env.DATABASE_URL = db.url;
    process.env.INGESTION_ENABLED = "true";
    const { AppModule } = await import("../src/app.module.js");
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      { logger: false },
    );
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await importBatch(db.pool, { colleges: directory });
  });
  afterAll(async () => {
    await app?.close();
    await db?.close();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    if (previousEnabled === undefined) delete process.env.INGESTION_ENABLED;
    else process.env.INGESTION_ENABLED = previousEnabled;
  });
  it("测试环境关闭实际调度，采集HTTP只在受保护管理空间开放", async () => {
    await app.get(IngestionScheduler).scan();
    expect(
      app.get(SchedulerRegistry).getCronJob("official-notices").nextDate()
        .zoneName,
    ).toBe("Asia/Shanghai");
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/competitions" })).json()
        .totalCompetitions,
    ).toBe(0);
    expect(
      (await db.pool.query("SELECT count(*) FROM ingestion_runs")).rows[0]
        .count,
    ).toBe("0");
    const swagger = (
      await app.inject({ method: "GET", url: "/docs-json" })
    ).json();
    const paths = Object.keys(swagger.paths).filter((path) =>
      path.includes("ingestion"),
    );
    expect(paths.length).toBeGreaterThan(0);
    expect(
      paths.every((path) => path.startsWith("/api/v1/admin/ingestion/")),
    ).toBe(true);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/admin/ingestion/sources",
        })
      ).statusCode,
    ).toBe(401);
  });
  it("候选和草稿不公开，显式发布后首页和详情有官方来源，官网修改不影响公开记录", async () => {
    let time = 0;
    const transport: Transport = async (url) => ({
      status: url.pathname === "/robots.txt" ? 404 : 200,
      headers: {},
      body: new TextEncoder().encode(
        url.pathname === "/robots.txt" ? "" : informationArticle,
      ),
    });
    const runner = new IngestionRunner(
      db.pool,
      (s, l) =>
        new BoundedFetcher(
          s,
          l,
          transport,
          () => time,
          async (ms) => {
            time += ms;
          },
        ),
    );
    await runner.scan({
      sourceId: "information-engineering",
      url: "https://xxgc.sicau.edu.cn/info/1043/100.htm",
    });
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/competitions" })).json()
        .totalCompetitions,
    ).toBe(0);
    const candidate = (
      await db.pool.query("SELECT id FROM ingestion_candidates")
    ).rows[0];
    const file = correctedReview(await exportReview(db.pool, candidate.id));
    await approveReview(db.pool, file, "maintainer");
    await applyReview(db.pool, file, "maintainer");
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/v1/competitions/${file.targetId}`,
        })
      ).statusCode,
    ).toBe(404);
    const publish = await exportReview(db.pool, candidate.id);
    await publishImported(
      db.pool,
      candidate.id,
      "maintainer",
      publish.baseline,
    );
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/competitions" })).json()
        .totalCompetitions,
    ).toBe(1);
    const detail = (
      await app.inject({
        method: "GET",
        url: `/api/v1/competitions/${file.targetId}`,
      })
    ).json();
    expect(detail.notices[0]).toMatchObject({
      publisher: "信息工程学院",
      url: file.source.url,
      checkedAt: "2026-10-11",
    });
    expect(detail).not.toHaveProperty("candidate");
    const revised: Transport = async (url) => ({
      status: url.pathname === "/robots.txt" ? 404 : 200,
      headers: {},
      body: new TextEncoder().encode(
        url.pathname === "/robots.txt"
          ? ""
          : informationArticle.replace("10月20日", "10月28日"),
      ),
    });
    await new IngestionRunner(
      db.pool,
      (s, l) =>
        new BoundedFetcher(
          s,
          l,
          revised,
          () => time,
          async (ms) => {
            time += ms;
          },
        ),
    ).scan({ sourceId: "information-engineering", url: file.source.url });
    expect(
      (await db.pool.query("SELECT status FROM ingestion_candidates")).rows[0]
        .status,
    ).toBe("pending");
    const after = (
      await app.inject({
        method: "GET",
        url: `/api/v1/competitions/${file.targetId}`,
      })
    ).json();
    delete detail.evaluatedAt;
    delete after.evaluatedAt;
    expect(after).toEqual(detail);
  });
});
