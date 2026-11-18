// 来源链接校验基线：采集通道只认学校 HTTPS 域名，手工维护通道放宽到公开 HTTPS DNS。
export const SICau_DOMAIN = "sicau.edu.cn";

// 保留与不可路由后缀；URL 解析层的非法主机表达也会被拒绝。
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
  // arpa 是基础设施专用顶级域（含 home.arpa），不存在可注册的公开站点。
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
// 数字顶级域与单段数值主机通常是十进制/十六进制 IP 的变体表达。
const NUMERIC_TLD = /^\d+$/;

export function isSicauHost(hostname: string): boolean {
  return hostname === SICau_DOMAIN || hostname.endsWith("." + SICau_DOMAIN);
}

function parseHttps(raw: string): string | null {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 2000)
    return "来源链接无效";
  if (raw !== raw.trim() || /\s/.test(raw)) return "来源链接不能含空白字符";
  // 归一化前拦截反斜杠、userinfo 与协议相对写法，避免解析器替换语义。
  if (raw.includes("\\") || raw.includes("@")) return "来源链接不能含账号信息";
  if (!/^https?:\/\//i.test(raw)) return "来源链接必须是 https";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "来源链接无效";
  }
  if (url.protocol !== "https:") return "来源链接必须使用 https";
  if (url.username || url.password) return "来源链接不能含账号信息";
  if (url.port && url.port !== "443") return "来源链接只能使用默认端口 443";
  return null;
}

function dnsHostError(hostname: string): string | null {
  if (!hostname || RESERVED_HOSTS.has(hostname))
    return "来源链接主机不能是本地或内网地址";
  // URL 解析后 IPv4/IPv6 字面量仍是方括号或点分数字形式。
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

/** 采集入库通道：学校 HTTPS 域名，默认端口且无凭据。返回 null 表示通过。 */
export function noticeUrlError(raw: string): string | null {
  const error = parseHttps(raw);
  if (error) return error;
  const { hostname } = new URL(raw);
  if (!isSicauHost(hostname)) return "官方来源必须使用学校 https 域名";
  return null;
}

/**
 * 手工维护通道：公开 DNS 的 HTTPS 地址（省略端口或显式 :443）。
 * 仅做词法判断，官方性由管理员人工核验；不发起任何网络请求。
 */
export function manualNoticeUrlError(raw: string): string | null {
  const error = parseHttps(raw);
  if (error) return error;
  return dnsHostError(new URL(raw).hostname);
}
