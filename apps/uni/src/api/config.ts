export interface ApiConfig {
  baseUrl: string;
  timeout: number;
}

/** 不依赖浏览器 URL/location；小程序与 H5 使用相同校验。 */
export function resolveApiConfig(env: {
  baseUrl?: string;
  timeout?: string;
  development: boolean;
  platform: string;
}): ApiConfig {
  const baseUrl = (
    env.baseUrl?.trim() ||
    (env.development && env.platform === "h5" ? "/api/v1" : "")
  ).replace(/\/+$/, "");
  const relative = /^\/(?!\/)[^\s?#\\]*$/.test(baseUrl);
  const absolute = /^https?:\/\/[^\s/@?#\\:]+(?::\d+)?(?:\/[^\s?#\\]*)?$/.test(
    baseUrl,
  );
  if (!baseUrl || (!absolute && !(relative && env.platform === "h5"))) {
    throw new Error(
      "请配置有效的 VITE_API_BASE_URL。小程序须使用完整 API 地址。",
    );
  }
  if (!env.development && absolute && !baseUrl.startsWith("https://")) {
    throw new Error("正式环境 API 地址必须使用 HTTPS。");
  }
  const timeout = env.timeout?.trim() ? Number(env.timeout) : 5000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60000) {
    throw new Error("VITE_API_TIMEOUT_MS 必须为 1–60000 的整数。");
  }
  return { baseUrl, timeout };
}
