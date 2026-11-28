import { parseSourceUrl, type SourceUrl } from "./policy.ts";

/**
 * H5 公开外链规则（ADR 0011 第 2 节），与 `apps/api/src/competitions/source-url.ts`
 * 的 `manualNoticeUrlError` 使用同一套判定：管理端能保存的外链，H5 一定能打开或复制。
 * 这里用 WHATWG URL 解析，因此接受 `:00443` 这类会被归一化为默认端口的写法与国际化域名，
 * 并按同一份保留后缀与私有地址清单拒绝内网目标。
 * 判定不发起任何网络请求，官方性仍由管理员人工核验。
 */
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

function parseHttps(value: string): URL | null {
  if (!value.trim() || value.length > 2000) return null;
  if (value !== value.trim() || /\s/.test(value)) return null;
  // 与解析层一致：反斜杠与 HTML 标记字符不参与地址判定。
  if (value.includes("\\") || value.includes("<") || value.includes(">"))
    return null;
  if (!/^https?:\/\//i.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  // `new URL` 已把 :443 / :00443 归一化为空字符串，非默认端口保留原值。
  if (url.port && url.port !== "443") return null;
  return url;
}

function dnsHostOk(hostname: string): boolean {
  if (!hostname || RESERVED_HOSTS.has(hostname)) return false;
  // 解析后的 IP 字面量仍是方括号或点分数字形式。
  if (hostname.startsWith("[") || /^\d+(?:\.\d+){0,3}$/.test(hostname))
    return false;
  if (LOOPBACK_AND_PRIVATE.some((pattern) => pattern.test(hostname)))
    return false;
  const labels = hostname.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((label) => HOST_LABEL.test(label))) return false;
  const top = labels[labels.length - 1]!;
  if (top.length < 2 || NUMERIC_TLD.test(top)) return false;
  return !RESERVED_SUFFIXES.some(
    (suffix) => hostname.endsWith(suffix) || hostname === suffix.slice(1),
  );
}

/** 返回可用于打开与复制的地址；不合法时返回 null，页面不给可点击或一键复制入口。 */
export function resolvePublicSourceUrl(value: unknown): SourceUrl | null {
  if (typeof value !== "string") return null;
  // App-Plus 的独立 JS 逻辑层可能没有浏览器的 URL 构造器。
  if (typeof URL !== "function") {
    if (value.length > 2000) return null;
    const source = parseSourceUrl(value);
    if (
      !source ||
      source.protocol !== "https" ||
      (source.port && Number(source.port) !== 443) ||
      !dnsHostOk(source.hostname)
    )
      return null;
    return {
      ...source,
      port: "",
      suffix: source.suffix === "/" ? "" : source.suffix,
    };
  }
  const url = parseHttps(value);
  if (!url || !dnsHostOk(url.hostname)) return null;
  const path = `${url.pathname}${url.search}${url.hash}`;
  return {
    // 保留管理员录入的原文，避免改写字面量后与官方通知不符。
    url: value,
    protocol: "https",
    hostname: url.hostname,
    port: url.port,
    suffix: path === "/" ? "" : path,
  };
}
