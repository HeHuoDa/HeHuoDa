// 管理员与 H5 允许来源列表共用同一严格 URL 校验：禁止通配符、路径、尾斜杠、凭据与生产明文 HTTP。
export function parseAllowedOrigins(
  raw: string,
  production = false,
  label = "允许的",
): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw.split(",").map((value) => {
        const origin = value.trim();
        const url = new URL(origin);
        if (
          url.hostname.includes("*") ||
          url.origin !== origin ||
          !["http:", "https:"].includes(url.protocol) ||
          (production && url.protocol !== "https:")
        )
          throw new Error(
            `${label} Origin 必须是完整且无路径的来源，生产仅允许 HTTPS`,
          );
        return origin;
      }),
    ),
  ];
}
