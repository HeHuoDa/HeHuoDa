import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from "@nestjs/swagger";
import { ApiExceptionFilter } from "./common/filters/api-exception.filter.js";
import { createGlobalValidationPipe } from "./common/pipes/global-validation.pipe.js";
import type { FastifyInstance } from "fastify";
import { adminOrigins } from "./admin/admin-security.js";

export function configureApp(app: INestApplication): OpenAPIObject {
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(createGlobalValidationPipe());
  app.useGlobalFilters(new ApiExceptionFilter());

  const environment = app.get(ConfigService);
  const allowedOrigins = adminOrigins(
    environment.get<string>("ADMIN_ALLOWED_ORIGINS", ""),
    environment.get("NODE_ENV") === "production",
  );
  const server: FastifyInstance = app.getHttpAdapter().getInstance();
  server.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0]!;
    if (path !== "/api/v1/admin" && !path.startsWith("/api/v1/admin/")) return;
    reply.header("Cache-Control", "no-store");
    reply.header("Vary", "Origin");
    const origin = request.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Allow-Credentials", "true");
      reply.header("Access-Control-Expose-Headers", "X-Admin-Id");
    }
    if (request.method !== "OPTIONS") return;
    const method = request.headers["access-control-request-method"];
    const headers = String(
      request.headers["access-control-request-headers"] ?? "",
    )
      .toLowerCase()
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (
      !origin ||
      !allowedOrigins.includes(origin) ||
      typeof method !== "string" ||
      !["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD"].includes(method) ||
      headers.some(
        (header) =>
          !["content-type", "x-csrf-token", "accept"].includes(header),
      )
    ) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: "禁止访问",
        requestId: request.id,
      });
    }
    reply.header(
      "Access-Control-Allow-Methods",
      "GET, POST, PATCH, PUT, DELETE, HEAD",
    );
    reply.header(
      "Access-Control-Allow-Headers",
      "Content-Type, X-CSRF-Token, Accept",
    );
    return reply.code(204).send();
  });

  const config = new DocumentBuilder()
    .setTitle("禾伙搭 API")
    .setVersion("1.0")
    .addCookieAuth(
      "hh_admin_session",
      { type: "apiKey", in: "cookie" },
      "adminSession",
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);

  if (app.get(ConfigService).get<boolean>("SWAGGER_ENABLED", false)) {
    SwaggerModule.setup("docs", app, document, {
      jsonDocumentUrl: "/docs-json",
    });
  }

  return document;
}
