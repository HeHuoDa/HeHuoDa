import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import {
  SchoolAuthClient,
  type AuthTransport,
  type AuthHttpResponse,
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
import { DatabaseService } from "../src/database/database.service.js";
import { configureApp } from "../src/configure-app.js";
import { testDatabase } from "./competition-fixture.js";

const response = (value: unknown): AuthHttpResponse => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body: Buffer.from(JSON.stringify(value)),
});
// 与包契约相同的独立固定向量；只替换外部传输，仍执行包内解密、解析、Cookie 与单次提交逻辑。
export const challengeResponse = () =>
  response({
    code: 200,
    id: "synthetic-challenge",
    requestId: "fixture-request",
    data: "ABEiM0RVZneImaq7zN3u/zJlgNtocJj+pe3pZHEYwfkXDXOGx9iyKBdVhrXnE0ffXUYkKo2GgldA5/PzRqw8OIWdjHfMV9PR3qiCeYrUjr91+6KgI0mlbKoLwM68qM0UPCBdR3/JeQPdeak3cs8wAvkgzIlLAsW4ikKWjSZ/vI+6jTsRR7aP3JMlGv/wZoNb",
  });
export const successResponse = (
  subject = "SYNTHETIC_SUBJECT",
  number: unknown = "00123456",
  name: unknown = "合成姓名",
) =>
  response({
    code: 200,
    msg: "登录成功",
    data: {
      user: { id: subject, number, name },
      users: [],
      st: "SYNTHETIC_TICKET",
      tgt: "SYNTHETIC_TGT",
    },
  });
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
export const credentials = {
  account: "synthetic-account",
  password: "SYNTHETIC_PASSWORD",
  captcha: "ABCD",
};
export async function campusFixture() {
  const isolated = await testDatabase();
  const settings = {
    DATABASE_URL: isolated.url,
    NODE_ENV: "test",
    SWAGGER_ENABLED: false,
    SENSITIVE_BUSINESS_ENABLED: false,
    WECHAT_LOGIN_ENABLED: true,
    WECHAT_APP_ID: "wxtestappid1234567",
    AUTH_RATE_LOGIN_PER_SOURCE: 100000,
    AUTH_RATE_LOGIN_PER_IDENTITY: 100000,
    AUTH_RATE_LOGIN_GLOBAL: 100000,
    CAMPUS_VERIFICATION_ENABLED: true,
    CAMPUS_POLICY_VERSION: 1,
    CAMPUS_RATE_SUBMIT_USER: 5,
    CAMPUS_RATE_SUBMIT_SOURCE: 100,
    CAMPUS_RATE_SUBMIT_GLOBAL: 500,
    CAMPUS_RATE_CHALLENGE_USER: 5,
    CAMPUS_RATE_CHALLENGE_SOURCE: 100,
    CAMPUS_RATE_CHALLENGE_GLOBAL: 500,
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
  };
  // ConfigService.set 同时写 process.env；每个装配恢复原值，避免跨测试污染预算。
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
    r.method === "GET" ? challengeResponse() : successResponse();
  const school = new SchoolAuthClient({ requestTimeoutMs: 1000 }, async (r) => {
    if (r.method === "GET") counts.get++;
    else counts.post++;
    return transport(r);
  });
  const campus = new CampusService(database, config, clock, school);
  const repository = new AuthRepository(database),
    registry = new CapabilityRegistry();
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
    controllers: [AuthController, CampusController],
    providers: [
      { provide: ConfigService, useValue: config },
      { provide: CampusService, useValue: campus },
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
    token?: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url: "/api/v1/" + path,
      headers: {
        ...(token ? { authorization: "Bearer " + token } : {}),
        ...(payload === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
  let sequence = 0;
  async function login(identity = "fixture-user-" + ++sequence) {
    const r = await request("POST", "auth/wechat/login", undefined, {
      code: "stub-identity:" + identity,
      consentVersion: 1,
    });
    if (r.statusCode !== 200) throw new Error("测试登录失败");
    return r.json<{
      accessToken: string;
      refreshToken: string;
      user: { id: string };
    }>();
  }
  async function create(token: string) {
    const r = await request("POST", "campus-verification/transactions", token, {
      consentVersion: 1,
    });
    if (r.statusCode !== 200) throw new Error("测试核验创建失败：" + r.body);
    return r.json<{
      id: string;
      challenge: { version: string };
      expiresAt: string;
    }>();
  }
  const submit = (
    token: string,
    t: { id: string; challenge: { version: string } },
    extra = {},
  ) =>
    request("POST", `campus-verification/transactions/${t.id}/submit`, token, {
      ...credentials,
      challengeVersion: t.challenge.version,
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
    repository,
    registry,
    lifecycle,
    policy,
    request,
    login,
    create,
    submit,
    time(value: string | Date) {
      now = new Date(value);
    },
    transport(value: AuthTransport) {
      transport = value;
    },
    async close() {
      await app.close();
      campus.onApplicationShutdown();
      await database.onApplicationShutdown();
      await isolated.close();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}
