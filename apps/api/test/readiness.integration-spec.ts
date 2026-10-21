import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { configureApp } from "../src/configure-app.js";
import { testDatabase } from "./competition-fixture.js";

describe("database readiness", () => {
  let db: Awaited<ReturnType<typeof testDatabase>>;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    db = await testDatabase();
    const previousUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = db.url;
    try {
      // 与公开查询 HTTP 测试一致：ConfigModule 在模块加载时读取环境。
      const { AppModule } = await import("../src/app.module.js");
      app = await NestFactory.create<NestFastifyApplication>(
        AppModule,
        new FastifyAdapter(),
        { logger: false },
      );
    } finally {
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
    }
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  const request = (url: string) =>
    app.getHttpAdapter().getInstance().inject({ method: "GET", url });

  it("accepts migrated empty databases and safely reports missing structure and migrations", async () => {
    const ready = await request("/api/v1/health/ready");
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({
      status: "ready",
      requestId: expect.any(String),
    });
    expect(ready.headers["cache-control"]).toBe("no-store");

    await db.pool.query(
      "ALTER TABLE colleges RENAME COLUMN name TO missing_name",
    );
    const broken = await request("/api/v1/health/ready");
    expect(broken.statusCode).toBe(503);
    expect(broken.json()).toEqual({
      status: "unavailable",
      requestId: expect.any(String),
    });
    expect((await request("/api/v1/health")).statusCode).toBe(200);
    await db.pool.query(
      "ALTER TABLE colleges RENAME COLUMN missing_name TO name",
    );
    expect((await request("/api/v1/health/ready")).statusCode).toBe(200);

    await db.pool.query(
      "DELETE FROM schema_migrations WHERE name='0003_ingestion_recovery_indexes.sql'",
    );
    expect((await request("/api/v1/health/ready")).statusCode).toBe(503);
    await db.pool.query(
      "INSERT INTO schema_migrations(name) VALUES ('0003_ingestion_recovery_indexes.sql')",
    );
    expect((await request("/api/v1/health/ready")).statusCode).toBe(200);
  });
});
