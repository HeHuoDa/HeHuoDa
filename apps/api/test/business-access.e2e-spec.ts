import { Controller, Module, Param, Post, Req } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import type { FastifyRequest } from "fastify";
import { BusinessPolicy } from "../src/business-access/business-policy.service.js";
import type { BusinessAction } from "../src/business-access/ports.js";
import { DatabaseService } from "../src/database/database.service.js";
import { configureApp } from "../src/configure-app.js";
import { authTestApp } from "./auth-fixture.js";
import { businessFixture } from "./business-access-fixture.js";

// 仅测试装配包含此控制器；不进入 AppModule 或生产 OpenAPI。
@Controller("policy-test")
class PolicyTestController {
  constructor(
    private readonly policy: BusinessPolicy,
    private readonly database: DatabaseService,
  ) {}
  @Post(":action/:resourceId")
  async execute(
    @Req() request: FastifyRequest,
    @Param("action") action: BusinessAction,
    @Param("resourceId") resourceId: string,
  ) {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    const actor = await this.database.db.transaction((tx) =>
      this.policy.authorize(tx, token, action, resourceId),
    );
    return { userId: actor.user.id };
  }
}

describe("业务权限 HTTP 安全边界", () => {
  let f: Awaited<ReturnType<typeof businessFixture>>;
  let app: NestFastifyApplication;
  let actor: Awaited<ReturnType<typeof f.user>>;
  beforeAll(async () => {
    f = await businessFixture();
    actor = await f.user("http-actor");
    @Module({
      controllers: [PolicyTestController],
      providers: [
        {
          provide: ConfigService,
          useValue: new ConfigService({ SWAGGER_ENABLED: false }),
        },
        { provide: BusinessPolicy, useValue: f.policy },
        { provide: DatabaseService, useValue: { db: f.database.db } },
      ],
    })
    class TestModule {}
    app = await NestFactory.create<NestFastifyApplication>(
      TestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app?.close();
    await f?.close();
  });
  it("无会话401、缺少资源404、关闭能力503，使用既有安全错误格式", async () => {
    const request = (resourceId: string, token?: string) =>
      app.inject({
        method: "POST",
        url: `/api/v1/policy-test/applyToTeam/${resourceId}`,
        headers: token ? { authorization: "Bearer " + token } : {},
      });
    const anonymous = await request(actor.id);
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toMatchObject({
      code: "INVALID_SESSION",
      requestId: expect.any(String),
    });
    expect((await request(actor.id, actor.accessToken)).statusCode).toBe(201);
    expect((await request("missing", actor.accessToken)).statusCode).toBe(404);
    f.config.set("SENSITIVE_BUSINESS_ENABLED", false);
    const disabled = await request(actor.id, actor.accessToken);
    expect(disabled.statusCode).toBe(503);
    expect(disabled.json().code).toBe("SENSITIVE_BUSINESS_UNAVAILABLE");
  });
  it("生产装配不能通过环境变量强开缺少提供者的业务", async () => {
    await expect(
      authTestApp({ SENSITIVE_BUSINESS_ENABLED: "true" }),
    ).rejects.toThrow("敏感业务缺少能力");
  });
});
