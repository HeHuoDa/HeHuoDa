import type { HealthResponse } from "@hehuoda/api-types";
import { resolveApiConfig } from "./config.ts";
import { createHttpClient } from "./http.ts";

export function isHealthResponse(data: unknown): data is HealthResponse {
  if (data === null || typeof data !== "object") return false;
  const body = data as Partial<HealthResponse>;
  return (
    body.status === "ok" &&
    typeof body.requestId === "string" &&
    body.requestId.trim().length > 0 &&
    body.requestId.length <= 256 &&
    Array.from(body.requestId).every(
      (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
    )
  );
}

// UNI_PLATFORM 不属于 Vite 默认公开环境变量，用 uni-app 条件编译确定平台。
let platform = "mp-weixin";
// #ifdef H5
platform = "h5";
// #endif

const http = createHttpClient(
  (options) => uni.request(options),
  () =>
    resolveApiConfig({
      baseUrl: import.meta.env.VITE_API_BASE_URL,
      timeout: import.meta.env.VITE_API_TIMEOUT_MS,
      development: import.meta.env.DEV,
      platform,
    }),
);

export const healthApi = {
  getHealth: () => http.get("/health", isHealthResponse),
};
