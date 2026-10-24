import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

interface ApiErrorPayload {
  code: string;
  message: string;
  requestId: string;
  details?: Record<string, unknown>;
}

const errorCodesByStatus: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "UNPROCESSABLE_ENTITY",
  429: "TOO_MANY_REQUESTS",
  503: "SERVICE_UNAVAILABLE",
};

const messagesByStatus: Record<number, string> = {
  400: "请求参数无效",
  401: "未授权",
  403: "禁止访问",
  404: "请求的资源不存在",
  409: "请求冲突",
  422: "请求无法处理",
  429: "请求过于频繁",
  503: "服务暂不可用",
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const httpContext = host.switchToHttp();
    const request = httpContext.getRequest<FastifyRequest>();
    const reply = httpContext.getResponse<FastifyReply>();
    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : 500;

    // 抛出方通过 createApiError 指定业务 code/message/details 时原样透传。
    const custom =
      exception instanceof HttpException
        ? (exception.getResponse() as Record<string, unknown>)
        : undefined;
    const customCode = typeof custom?.code === "string" ? custom.code : null;
    const customMessage =
      typeof custom?.message === "string" ? custom.message : null;
    const hasCustom = customCode !== null && customMessage !== null;

    const payload: ApiErrorPayload = {
      code: hasCustom
        ? customCode
        : (errorCodesByStatus[statusCode] ??
          (statusCode >= 500 ? "INTERNAL_SERVER_ERROR" : "HTTP_ERROR")),
      message: hasCustom
        ? customMessage
        : (messagesByStatus[statusCode] ??
          (statusCode >= 500 ? "服务器内部错误" : "请求失败")),
      requestId: request.id,
      ...(hasCustom && isPlainObject(custom?.details)
        ? { details: custom.details }
        : {}),
    };

    // 错误响应可能携带会话或账号状态线索，一律禁止缓存。
    reply.header("Cache-Control", "no-store");
    reply.status(statusCode).send(payload);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
