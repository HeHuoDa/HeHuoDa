import type { ApiError } from "@hehuoda/api-types";
import type { ApiConfig } from "./config.ts";

export type RequestErrorKind =
  "http" | "invalid-response" | "network" | "timeout" | "cancelled" | "config";

export class RequestError extends Error {
  readonly kind: RequestErrorKind;
  readonly requestId: string | null;
  readonly code: string | null;
  readonly statusCode: number | null;
  readonly details?: ApiError["details"];

  constructor(
    kind: RequestErrorKind,
    message: string,
    info: {
      requestId?: string | null;
      code?: string | null;
      statusCode?: number;
      details?: ApiError["details"];
    } = {},
  ) {
    super(message);
    this.name = "RequestError";
    this.kind = kind;
    this.requestId = info.requestId ?? null;
    this.code = info.code ?? null;
    this.statusCode = info.statusCode ?? null;
    this.details = info.details;
  }
}

export interface PendingRequest<T> {
  promise: Promise<T>;
  cancel(): void;
}

/** 仅依赖本票所用的 uni.request 回调子集，平台替身也走此入口。 */
export type RequestTransport = (options: {
  url: string;
  method: "GET";
  timeout: number;
  dataType: "json";
  success(response: {
    statusCode: number;
    data: unknown;
    header?: Record<string, unknown>;
  }): void;
  fail(error: { errMsg: string }): void;
}) => { abort(): void };

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeText(value: unknown, max: number): string | null {
  return typeof value === "string" &&
    value.trim() &&
    value.length <= max &&
    Array.from(value).every(
      (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
    )
    ? value.trim()
    : null;
}

export function responseRequestId(
  data: unknown,
  header?: Record<string, unknown>,
): string | null {
  const fromBody = safeText(record(data).requestId, 256);
  if (fromBody) return fromBody;
  const key = Object.keys(header ?? {}).find(
    (name) => name.toLowerCase() === "x-request-id",
  );
  return key ? safeText(header?.[key], 256) : null;
}

export function createHttpClient(
  transport: RequestTransport,
  config: () => ApiConfig,
) {
  return {
    get<T>(
      path: string,
      validate: (data: unknown) => data is T,
    ): PendingRequest<T> {
      let settled = false;
      let task: { abort(): void } | undefined;
      let rejectRequest: (error: RequestError) => void;
      const promise = new Promise<T>((resolve, reject) => {
        rejectRequest = reject;
        const fail = (error: RequestError) => {
          if (settled) return;
          settled = true;
          reject(error);
        };
        let settings: ApiConfig;
        try {
          settings = config();
          if (!/^\/(?!\/)/.test(path))
            throw new Error("请求路径必须以单个 / 开头。");
        } catch (error) {
          fail(
            new RequestError(
              "config",
              error instanceof Error ? error.message : "API 配置无效。",
            ),
          );
          return;
        }
        try {
          task = transport({
            url: `${settings.baseUrl}${path}`,
            method: "GET",
            timeout: settings.timeout,
            dataType: "json",
            success(response) {
              if (settled) return;
              const requestId = responseRequestId(
                response.data,
                response.header,
              );
              if (!Number.isInteger(response.statusCode)) {
                fail(
                  new RequestError(
                    "invalid-response",
                    "服务响应格式异常，请稍后重试。",
                    { requestId },
                  ),
                );
              } else if (
                response.statusCode < 200 ||
                response.statusCode >= 300
              ) {
                const body = record(response.data);
                fail(
                  new RequestError(
                    "http",
                    safeText(body.message, 500) ??
                      "暂时无法连接服务，请稍后重试。",
                    {
                      code: safeText(body.code, 128),
                      requestId,
                      statusCode: response.statusCode,
                      details:
                        body.details !== null &&
                        typeof body.details === "object" &&
                        !Array.isArray(body.details)
                          ? record(body.details)
                          : undefined,
                    },
                  ),
                );
              } else if (!validate(response.data)) {
                fail(
                  new RequestError(
                    "invalid-response",
                    "服务响应格式异常，请稍后重试。",
                    { requestId },
                  ),
                );
              } else {
                settled = true;
                resolve(response.data);
              }
            },
            fail(error) {
              const message = error.errMsg.toLowerCase();
              fail(
                message.includes("abort")
                  ? new RequestError("cancelled", "请求已取消。")
                  : message.includes("timeout") || message.includes("time out")
                    ? new RequestError("timeout", "连接超时，请稍后重试。")
                    : new RequestError(
                        "network",
                        "暂时无法连接服务，请稍后重试。",
                      ),
              );
            },
          });
        } catch {
          fail(new RequestError("network", "暂时无法连接服务，请稍后重试。"));
        }
      });
      return {
        promise,
        cancel() {
          if (settled) return;
          settled = true;
          rejectRequest(new RequestError("cancelled", "请求已取消。"));
          // 平台可能不回调 fail，或同步回调；先结算再中断，迟到回调不改变结果。
          try {
            task?.abort();
          } catch {
            /* 取消已完成，不把平台 abort 异常显示为业务错误。 */
          }
        },
      };
    },
  };
}
