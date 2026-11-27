import { resolveApiConfig } from "./config.ts";
import {
  createHttpClient,
  type HttpClientAuth,
  type RequestTransport,
} from "./http.ts";

// 现行交付端只有 H5 与 Android（App-Plus）；平台值只用于地址规则与凭据模式。
let platform = "app";
// #ifdef H5
platform = "h5";
// #endif

const transport: RequestTransport = (options) => {
  const requestOptions: UniNamespace.RequestOptions = {
    url: options.url,
    method: options.method as UniNamespace.RequestOptions["method"],
    timeout: options.timeout,
    dataType: options.dataType,
    ...(options.data !== undefined ? { data: options.data } : {}),
    ...(options.header ? { header: options.header } : {}),
    success: options.success,
    fail: options.fail,
  };
  // #ifdef H5
  if (options.withCredentials) requestOptions.withCredentials = true;
  // #endif
  // #ifndef H5
  if (options.method === "PATCH") {
    throw new Error("PATCH 仅在 H5 通道使用。");
  }
  // #endif
  const task = uni.request(requestOptions) as unknown as {
    abort?: () => void;
  };
  return {
    abort() {
      task?.abort?.();
    },
  };
};
const readConfig = () => {
  const config = resolveApiConfig({
    baseUrl: import.meta.env.VITE_API_BASE_URL,
    timeout: import.meta.env.VITE_API_TIMEOUT_MS,
    development: import.meta.env.DEV,
    platform,
  });
  // #ifdef APP-PLUS
  // Android 端开发与正式构建都只接受完整 HTTPS；不关闭证书校验，也不降级明文。
  if (!config.baseUrl.startsWith("https://")) {
    throw new Error("Android 客户端 API 地址必须使用 HTTPS。");
  }
  // #endif
  return config;
};

/** 公开请求客户端：不携带凭据，也不参与 401 刷新协调。 */
export const http = createHttpClient(transport, readConfig);

let session: HttpClientAuth | null = null;

/** 认证状态模块启动时注入会话；注入后业务请求自动携带凭据并参与单次刷新协调。 */
export function bindAuthSession(next: HttpClientAuth): void {
  session = next;
}

/** 登录态请求客户端：认证模块之外的代码不应直接绕过它拼接凭据。 */
export const authedHttp = createHttpClient(transport, readConfig, {
  accessToken: () => session?.accessToken() ?? null,
  refresh: () => {
    if (!session) return Promise.reject(new Error("认证会话尚未注入。"));
    return session.refresh();
  },
  generation: () => session?.generation?.() ?? 0,
});
