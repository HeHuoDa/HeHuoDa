// 手工比赛外链规则（ADR 0011 第 2 节）：与 apps/api/src/competitions/source-url.ts 的
// manualNoticeUrlError 保持同一判定与同一提示语，允许无凭据、无非默认端口的公开
// HTTPS DNS 地址，官方性由管理员人工核实。仅做词法判断，不发起网络请求。
// 采集与审核通道仍使用 review.ts 的 safeSourceUrl（保留 http 与显式端口），互不放宽。
const RESERVED_SUFFIXES = [
  ".internal",
  ".intranet",
  ".lan",
  ".local",
  ".localhost",
  ".localdomain",
  ".home",
  ".corp",
  ".private",
  ".test",
  ".invalid",
  ".example",
  ".onion",
  ".arpa",
];
const RESERVED_HOSTS = new Set([
  "localhost",
  "local",
  "home.arpa",
  "ip6-localhost",
  "ip6-loopback",
  "broadcasthost",
]);
const LOOPBACK_AND_PRIVATE = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^0\./,
];
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const NUMERIC_TLD = /^\d+$/;

function parseHttps(raw: string): string | null {
  if (!raw || !raw.trim() || raw.length > 2000) return "来源链接无效";
  if (raw !== raw.trim() || /\s/.test(raw)) return "来源链接不能含空白字符";
  // 归一化前拦截反斜杠，避免解析器把 \ 当成路径分隔符替换语义。
  if (raw.includes("\\")) return "来源链接无效";
  if (!/^https?:\/\//i.test(raw)) return "来源链接必须是 https";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "来源链接无效";
  }
  if (url.protocol !== "https:") return "来源链接必须使用 https";
  if (url.username || url.password) return "来源链接不能含账号信息";
  // new URL 已把 :443 / :00443 归一化为空字符串，非默认端口保留原值。
  if (url.port && url.port !== "443") return "来源链接只能使用默认端口 443";
  if (raw.includes("<") || raw.includes(">")) return "来源链接不能含 HTML 标记";
  return null;
}

function dnsHostError(hostname: string): string | null {
  if (!hostname || RESERVED_HOSTS.has(hostname))
    return "来源链接主机不能是本地或内网地址";
  if (hostname.startsWith("[") || /^\d+(?:\.\d+){0,3}$/.test(hostname))
    return "来源链接不能使用 IP 地址";
  if (LOOPBACK_AND_PRIVATE.some((pattern) => pattern.test(hostname)))
    return "来源链接不能使用 IP 地址";
  const labels = hostname.split(".");
  if (labels.length < 2) return "来源链接必须是完整域名";
  if (!labels.every((label) => HOST_LABEL.test(label)))
    return "来源链接主机格式无效";
  const top = labels[labels.length - 1]!;
  if (top.length < 2 || NUMERIC_TLD.test(top)) return "来源链接必须是完整域名";
  if (
    RESERVED_SUFFIXES.some(
      (suffix) => hostname.endsWith(suffix) || hostname === suffix.slice(1),
    )
  )
    return "来源链接不能指向本地、内网或保留主机名";
  return null;
}

/** 手工维护通道：公开 DNS 的 HTTPS 地址（省略端口或显式 :443）。返回 null 表示通过。 */
export function manualSourceUrlError(raw: string): string | null {
  const error = parseHttps(raw);
  if (error) return error;
  return dnsHostError(new URL(raw).hostname);
}
