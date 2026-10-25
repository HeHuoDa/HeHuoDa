import { resolveApiConfig } from "./config.ts";
import {
  createHttpClient,
  type HttpClientAuth,
  type RequestTransport,
} from "./http.ts";

let platform = "mp-weixin";
// #ifdef H5
platform = "h5";
// #endif

const transport: RequestTransport = (options) => uni.request(options);
const readConfig = () =>
  resolveApiConfig({
    baseUrl: import.meta.env.VITE_API_BASE_URL,
    timeout: import.meta.env.VITE_API_TIMEOUT_MS,
    development: import.meta.env.DEV,
    platform,
  });

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
});
