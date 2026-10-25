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

/** 页面统一使用安全反馈，原始 code/message/requestId/details 仍保留在错误对象中。 */
export function requestErrorMessage(
  error: unknown,
  fallback = "加载失败，请稍后重试。",
): string {
  if (!(error instanceof RequestError)) return fallback;
  if (error.kind === "http") {
    if (error.statusCode === 400) return "请求参数无效，请调整条件后重试。";
    if (error.statusCode === 404) return "请求的资源不存在或未公开。";
    if (error.statusCode === 429) return "请求过于频繁，请稍后重试。";
    if (error.statusCode !== null && error.statusCode >= 500)
      return "服务暂时不可用，请稍后重试。";
    return "请求失败，请稍后重试。";
  }
  return error.message;
}

export interface PendingRequest<T> {
  promise: Promise<T>;
  cancel(): void;
}

/** 会话级认证能力：由认证状态模块提供，客户端据此注入头并协调刷新。 */
export interface HttpClientAuth {
  /** 当前访问凭据；null 表示未登录，请求不带认证头。 */
  accessToken(): string | null;
  /** 执行一次刷新并返回新访问凭据；客户端对并发 401 只调用一次。 */
  refresh(): Promise<string>;
}

/**
 * wx.request 的 method 不接受 PATCH，H5 与小程序共用 uni.request 类型，
 * 因此局部更新由后端提供 POST 别名；事务取消使用两端均支持的 DELETE。
 */
export type RequestTransportMethod = "GET" | "POST" | "DELETE";

/** 与 uni.request 的 data 参数兼容的请求体类型。 */
export type RequestBody = Record<string, unknown> | string;

/** 仅依赖本票所用的 uni.request 回调子集，平台替身也走此入口。 */
export type RequestTransport = (options: {
  url: string;
  method: RequestTransportMethod;
  timeout: number;
  dataType: "json";
  data?: RequestBody;
  header?: Record<string, string>;
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
  auth?: HttpClientAuth,
) {
  let inflightRefresh: Promise<string> | null = null;
  // 并发 401 共享同一次刷新；结束后清空，允许下一轮 401 再次协调。
  const sharedRefresh = (): Promise<string> | null => {
    if (!auth) return null;
    inflightRefresh ??= auth.refresh().finally(() => {
      inflightRefresh = null;
    });
    return inflightRefresh;
  };

  function request<T>(
    method: RequestTransportMethod,
    path: string,
    validate: (data: unknown) => data is T,
    body?: RequestBody,
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
      const attempt = (retry: boolean) => {
        if (settled) return;
        const token = auth?.accessToken() ?? null;
        const finishHttpFailure = (
          statusCode: number,
          data: unknown,
          requestId: string | null,
        ) => {
          const body = record(data);
          fail(
            new RequestError(
              "http",
              safeText(body.message, 500) ?? "暂时无法连接服务，请稍后重试。",
              {
                code: safeText(body.code, 128),
                requestId,
                statusCode,
                details:
                  body.details !== null &&
                  typeof body.details === "object" &&
                  !Array.isArray(body.details)
                    ? record(body.details)
                    : undefined,
              },
            ),
          );
        };
        try {
          task = transport({
            url: `${settings.baseUrl}${path}`,
            method,
            timeout: settings.timeout,
            dataType: "json",
            ...(body !== undefined ? { data: body } : {}),
            ...(token !== null
              ? { header: { Authorization: `Bearer ${token}` } }
              : {}),
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
                return;
              }
              // 仅“已带凭据却被明确拒绝”的 401 才刷新重发一次：
              // 无凭据的 401（如登录 code 无效）与未知结果（超时/网络）都不重试，
              // 写请求也不会在业务可能已执行的情况下自动重放。
              if (
                response.statusCode === 401 &&
                token !== null &&
                auth &&
                !retry
              ) {
                const refreshed = sharedRefresh();
                if (refreshed) {
                  refreshed.then(
                    () => attempt(true),
                    () =>
                      finishHttpFailure(
                        response.statusCode,
                        response.data,
                        requestId,
                      ),
                  );
                  return;
                }
              }
              if (response.statusCode < 200 || response.statusCode >= 300) {
                finishHttpFailure(
                  response.statusCode,
                  response.data,
                  requestId,
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
      };
      attempt(false);
    });
    // 401 协调会把拒绝推迟到刷新微任务，调用方的 handler 可能晚于拒绝
    // 本身挂接；预挂观察者避免虚假的未处理拒绝告警，拒绝仍照常传播。
    promise.catch(() => {});
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
  }

  return {
    delete<T>(
      path: string,
      validate: (data: unknown) => data is T,
    ): PendingRequest<T> {
      return request("DELETE", path, validate);
    },
    get<T>(
      path: string,
      validate: (data: unknown) => data is T,
    ): PendingRequest<T> {
      return request("GET", path, validate);
    },
    post<T>(
      path: string,
      body: RequestBody | undefined,
      validate: (data: unknown) => data is T,
    ): PendingRequest<T> {
      return request("POST", path, validate, body);
    },
  };
}
