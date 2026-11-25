import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import {
  SchoolAuthClient,
  type AuthHttpResponse,
  type AuthTransport,
} from "@hehuoda/sicau-connectors/auth";
import { AuthClock } from "../src/auth/auth-clock.js";
import { AuthController } from "../src/auth/auth.controller.js";
import { AuthGuard } from "../src/auth/auth.guard.js";
import { AuthRateLimiter } from "../src/auth/auth-rate-limiter.js";
import { AuthRepository } from "../src/auth/auth.repository.js";
import { AuthService } from "../src/auth/auth.service.js";
import { StubWechatProvider } from "../src/auth/wechat/stub-wechat-provider.js";
import { authDataModule } from "../src/business-access/auth-data-module.js";
import { CapabilityRegistry } from "../src/business-access/capabilities.js";
import { AccountLifecycle } from "../src/business-access/lifecycle.service.js";
import { BusinessPolicy } from "../src/business-access/business-policy.service.js";
import { CampusController } from "../src/campus/campus.controller.js";
import { CampusService } from "../src/campus/campus.service.js";
import { SchoolLoginController } from "../src/campus/school-login.controller.js";
import { SchoolLoginService } from "../src/campus/school-login.service.js";
import { DatabaseService } from "../src/database/database.service.js";
import { configureApp } from "../src/configure-app.js";
import { testDatabase } from "./competition-fixture.js";
import {
  challengeResponse,
  deferred,
  successResponse,
} from "./campus-fixture.js";

export { challengeResponse, successResponse, deferred };

const syntheticResponse = (value: unknown): AuthHttpResponse => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body: Buffer.from(JSON.stringify(value)),
});

/** 与包契约一致的独立固定向量；只替换外部传输，包内解密与解析逻辑仍然执行。 */
export const syntheticSuccess = (
  subject = "SYNTHETIC_SUBJECT",
  number: unknown = "00123456",
  name: unknown = "合成姓名",
) =>
  syntheticResponse({
    code: 200,
    msg: "登录成功",
    data: {
      user: { id: subject, number, name },
      users: [],
      st: "SYNTHETIC_TICKET",
      tgt: "SYNTHETIC_TGT",
    },
  });
export const schoolFailure = (msg: string) =>
  syntheticResponse({ code: 400, msg });
export const multiIdentity = () =>
  syntheticResponse({
    code: 200,
    msg: "登录成功",
    data: {
      user: { id: "SYNTHETIC_SUBJECT", number: "00123456", name: "合成姓名" },
      users: [{ id: "another" }],
      st: "SYNTHETIC_TICKET",
      tgt: "SYNTHETIC_TGT",
    },
  });

export const loginCredentials = {
  name: "合成姓名",
  account: "00123456",
  password: "SYNTHETIC_PASSWORD",
  captcha: "ABCD",
  consentVersion: 2,
};

/**
 * 匿名学校登录的隔离装配：真实 PostgreSQL schema、真实包内解密与 Cookie 逻辑，
 * 只有校方传输是桩。用于验证事务所有权、并发首登、慢响应与令牌生命周期。
 */
export async function schoolLoginFixture(
  overrides: Record<string, unknown> = {},
) {
  const isolated = await testDatabase();
  const settings = {
    DATABASE_URL: isolated.url,
    NODE_ENV: "test",
    SWAGGER_ENABLED: false,
    SENSITIVE_BUSINESS_ENABLED: false,
    WECHAT_LOGIN_ENABLED: false,
    AUTH_RATE_LOGIN_PER_SOURCE: 100000,
    AUTH_RATE_LOGIN_PER_IDENTITY: 100000,
    AUTH_RATE_LOGIN_GLOBAL: 100000,
    AUTH_RATE_REFRESH_PER_SUBJECT: 100000,
    AUTH_RATE_REFRESH_GLOBAL: 100000,
    CAMPUS_VERIFICATION_ENABLED: true,
    CAMPUS_POLICY_VERSION: 2,
    CAMPUS_RATE_SUBMIT_USER: 1000,
    CAMPUS_RATE_SUBMIT_SOURCE: 1000,
    CAMPUS_RATE_SUBMIT_GLOBAL: 1000,
    CAMPUS_RATE_CHALLENGE_USER: 1000,
    CAMPUS_RATE_CHALLENGE_SOURCE: 1000,
    CAMPUS_RATE_CHALLENGE_GLOBAL: 1000,
    CAMPUS_RATE_LOGIN_GLOBAL: 1000,
    CAMPUS_RATE_LOGIN_SOURCE: 1000,
    CAMPUS_RATE_LOGIN_ACCOUNT: 100,
    CAMPUS_TERMS: JSON.stringify([
      {
        id: "synthetic-fall",
        startAt: "2026-09-01T00:00:00+08:00",
        endAt: "2027-02-01T00:00:00+08:00",
      },
      {
        id: "synthetic-spring",
        startAt: "2027-02-01T00:00:00+08:00",
        endAt: "2027-08-01T00:00:00+08:00",
      },
    ]),
    CAMPUS_SUBJECT_HMAC_KEY: Buffer.alloc(32, 1).toString("base64"),
    CAMPUS_PROFILE_KEYS: JSON.stringify({
      v1: Buffer.alloc(32, 2).toString("base64"),
    }),
    CAMPUS_PROFILE_KEY_ID: "v1",
    H5_ALLOWED_ORIGINS: "https://h5.example",
    ...overrides,
  };
  const previous = Object.fromEntries(
    Object.keys(settings).map((key) => [key, process.env[key]]),
  );
  const config = new ConfigService(settings);
  const database = new DatabaseService(config),
    clock = new AuthClock();
  let now = new Date("2026-10-25T00:00:00Z");
  clock.now = () => new Date(now);
  const counts = { get: 0, post: 0 };
  let transport: AuthTransport = async (r) =>
    r.method === "GET" ? challengeResponse() : syntheticSuccess();
  const school = new SchoolAuthClient({ requestTimeoutMs: 1000 }, async (r) => {
    if (r.method === "GET") counts.get++;
    else counts.post++;
    return transport(r);
  });
  const repository = new AuthRepository(database);
  const campus = new CampusService(database, config, clock, school);
  const login = new SchoolLoginService(
    database,
    config,
    clock,
    school,
    repository,
  );
  const registry = new CapabilityRegistry();
  registry.register(authDataModule());
  registry.register(campus.dataModule());
  registry.seal(false, ["auth", "campus"]);
  const lifecycle = new AccountLifecycle(registry);
  const auth = new AuthService(
    config,
    repository,
    new AuthRateLimiter(database),
    new StubWechatProvider(),
    clock,
    lifecycle,
    campus,
  );
  const policy = new BusinessPolicy(registry, repository, config, clock);
  @Module({
    controllers: [AuthController, CampusController, SchoolLoginController],
    providers: [
      { provide: ConfigService, useValue: config },
      { provide: CampusService, useValue: campus },
      { provide: SchoolLoginService, useValue: login },
      { provide: AuthRepository, useValue: repository },
      { provide: AuthClock, useValue: clock },
      { provide: AuthService, useValue: auth },
      AuthGuard,
    ],
  })
  class TestModule {}
  const app = await NestFactory.create<NestFastifyApplication>(
    TestModule,
    new FastifyAdapter(),
    { logger: false, abortOnError: false },
  );
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const request = (
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    payload?: unknown,
    tokenOrHeaders?: string | Record<string, string>,
  ) =>
    app.inject({
      method,
      url: "/api/v1/" + path,
      headers: {
        ...(typeof tokenOrHeaders === "string"
          ? { authorization: "Bearer " + tokenOrHeaders }
          : tokenOrHeaders),
        ...(payload === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
  const createChallenge = () =>
    request("POST", "auth/school/challenges", {}).then((r) => {
      if (r.statusCode !== 201) throw new Error("测试挑战创建失败：" + r.body);
      return r.json<{
        id: string;
        holderToken: string;
        challenge: { version: string };
      }>();
    });
  const submitChallenge = (
    challenge: {
      id: string;
      holderToken: string;
      challenge: { version: string };
    },
    extra: Record<string, unknown> = {},
  ) =>
    request("POST", `auth/school/challenges/${challenge.id}/submit`, {
      ...loginCredentials,
      holderToken: challenge.holderToken,
      challengeVersion: challenge.challenge.version,
      ...extra,
    });
  return {
    app,
    isolated,
    database,
    config,
    clock,
    counts,
    campus,
    school,
    login,
    repository,
    registry,
    lifecycle,
    policy,
    request,
    createChallenge,
    submitChallenge,
    time(value: string | Date) {
      now = new Date(value);
    },
    transport(value: AuthTransport) {
      transport = value;
    },
    async close() {
      await app.close();
      campus.onApplicationShutdown();
      login.onApplicationShutdown();
      await database.onApplicationShutdown();
      await isolated.close();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}
