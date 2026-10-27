import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import type { LightMyRequestResponse } from "fastify";
import type { Pool } from "pg";
import { configureApp } from "../src/configure-app.js";
import { testDatabase } from "./competition-fixture.js";

const ENV_KEYS = [
  "NODE_ENV",
  "DATABASE_URL",
  "SENSITIVE_BUSINESS_ENABLED",
  "WECHAT_LOGIN_ENABLED",
  "WECHAT_LOGIN_ADAPTER",
  "WECHAT_APP_ID",
  "WECHAT_APP_SECRET",
  "AUTH_RATE_LOGIN_PER_SOURCE",
  "AUTH_RATE_LOGIN_PER_IDENTITY",
  "AUTH_RATE_LOGIN_GLOBAL",
  "AUTH_RATE_REFRESH_PER_SUBJECT",
  "AUTH_RATE_REFRESH_GLOBAL",
  "ADMIN_ALLOWED_ORIGINS",
  "ADMIN_SESSION_HOURS",
  "ADMIN_RATE_LOGIN_SOURCE",
  "ADMIN_RATE_LOGIN_ACCOUNT",
  "ADMIN_RATE_LOGIN_GLOBAL",
  "CAMPUS_VERIFICATION_ENABLED",
  "CAMPUS_TERMS",
] as const;

// 默认开启登录并使用离线替身；限流预算放宽，专项测试按需收紧。
const BASE_ENV: Record<string, string> = {
  NODE_ENV: "test",
  SENSITIVE_BUSINESS_ENABLED: "false",
  WECHAT_LOGIN_ENABLED: "true",
  WECHAT_LOGIN_ADAPTER: "stub",
  WECHAT_APP_ID: "wxtestappid1234567",
  WECHAT_APP_SECRET: "test-secret-32-chars-aaaaaaaaaa",
  AUTH_RATE_LOGIN_PER_SOURCE: "100000",
  AUTH_RATE_LOGIN_PER_IDENTITY: "100000",
  AUTH_RATE_LOGIN_GLOBAL: "100000",
  AUTH_RATE_REFRESH_PER_SUBJECT: "100000",
  AUTH_RATE_REFRESH_GLOBAL: "100000",
  ADMIN_ALLOWED_ORIGINS: "http://localhost:5173",
  ADMIN_RATE_LOGIN_SOURCE: "10000",
  ADMIN_RATE_LOGIN_ACCOUNT: "10000",
  ADMIN_RATE_LOGIN_GLOBAL: "10000",
  CAMPUS_VERIFICATION_ENABLED: "false",
  CAMPUS_TERMS: "[]",
};

export interface AuthTestApp {
  app: NestFastifyApplication;
  pool: Pool;
  request(
    method: "GET" | "POST" | "PATCH" | "PUT" | "OPTIONS",
    url: string,
    payload?: unknown,
    headers?: Record<string, string>,
  ): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
  restart(): Promise<void>;
}

export async function authTestApp(
  env: Record<string, string> = {},
): Promise<AuthTestApp> {
  const db = await testDatabase();
  const previous = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, BASE_ENV, env, { DATABASE_URL: db.url });
  const restoreEnvironment = () => {
    for (const key of ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  const { AppModule } = await import("../src/app.module.js");
  let app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: false, abortOnError: false },
  );
  try {
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  } catch (error) {
    await app.close();
    await db.close();
    restoreEnvironment();
    throw error;
  }
  let instance = app.getHttpAdapter().getInstance();

  const test: AuthTestApp = {
    app,
    pool: db.pool,
    async restart() {
      await app.close();
      app = await NestFactory.create<NestFastifyApplication>(
        AppModule,
        new FastifyAdapter(),
        { logger: false, abortOnError: false },
      );
      configureApp(app);
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      instance = app.getHttpAdapter().getInstance();
      test.app = app;
    },
    request(method, url, payload, headers) {
      return instance.inject({
        method,
        url: "/api/v1/" + url,
        payload: payload === undefined ? undefined : JSON.stringify(payload),
        headers:
          payload === undefined
            ? headers
            : { "content-type": "application/json", ...headers },
      });
    },
    async close() {
      await app.close();
      await db.close();
      restoreEnvironment();
    },
  };
  return test;
}
