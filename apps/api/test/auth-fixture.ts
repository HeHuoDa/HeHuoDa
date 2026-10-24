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
  "DATABASE_URL",
  "WECHAT_LOGIN_ENABLED",
  "WECHAT_LOGIN_ADAPTER",
  "WECHAT_APP_ID",
  "WECHAT_APP_SECRET",
  "AUTH_RATE_LOGIN_PER_SOURCE",
  "AUTH_RATE_LOGIN_PER_IDENTITY",
  "AUTH_RATE_LOGIN_GLOBAL",
  "AUTH_RATE_REFRESH_PER_SUBJECT",
  "AUTH_RATE_REFRESH_GLOBAL",
] as const;

// 默认开启登录并使用离线替身；限流预算放宽，专项测试按需收紧。
const BASE_ENV: Record<string, string> = {
  WECHAT_LOGIN_ENABLED: "true",
  WECHAT_LOGIN_ADAPTER: "stub",
  WECHAT_APP_ID: "wxtestappid1234567",
  WECHAT_APP_SECRET: "test-secret-32-chars-aaaaaaaaaa",
  AUTH_RATE_LOGIN_PER_SOURCE: "100000",
  AUTH_RATE_LOGIN_PER_IDENTITY: "100000",
  AUTH_RATE_LOGIN_GLOBAL: "100000",
  AUTH_RATE_REFRESH_PER_SUBJECT: "100000",
  AUTH_RATE_REFRESH_GLOBAL: "100000",
};

export interface AuthTestApp {
  app: NestFastifyApplication;
  pool: Pool;
  request(
    method: "GET" | "POST" | "PATCH",
    url: string,
    payload?: unknown,
    headers?: Record<string, string>,
  ): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

export async function authTestApp(
  env: Record<string, string> = {},
): Promise<AuthTestApp> {
  const db = await testDatabase();
  const previous = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, BASE_ENV, env, { DATABASE_URL: db.url });

  const { AppModule } = await import("../src/app.module.js");
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: false },
  );
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const instance = app.getHttpAdapter().getInstance();

  const test: AuthTestApp = {
    app,
    pool: db.pool,
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
      for (const key of ENV_KEYS) {
        const value = previous[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
  return test;
}
