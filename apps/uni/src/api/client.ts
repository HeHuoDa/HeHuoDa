import { resolveApiConfig } from "./config.ts";
import { createHttpClient } from "./http.ts";

let platform = "mp-weixin";
// #ifdef H5
platform = "h5";
// #endif

export const http = createHttpClient(
  (options) => uni.request(options),
  () =>
    resolveApiConfig({
      baseUrl: import.meta.env.VITE_API_BASE_URL,
      timeout: import.meta.env.VITE_API_TIMEOUT_MS,
      development: import.meta.env.DEV,
      platform,
    }),
);
