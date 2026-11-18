import { approvedWebViewHosts } from "./config.ts";
export { approvedWebViewHosts } from "./config.ts";

export interface SourceUrl {
  url: string;
  protocol: string;
  hostname: string;
  port: string;
  suffix: string;
}

/**
 * 两端共用保守的 HTTP(S) DNS 地址子集，不依赖微信未保证提供的全局 URL。
 * 不修复空白、反斜杠、userinfo、编码主机、端口或破损转义，避免浏览器二次解释。
 * 官方来源使用 ASCII DNS 主机；IP / 国际化主机需先独立评估后扩展。
 */
export function parseSourceUrl(value: unknown): SourceUrl | null {
  if (
    typeof value !== "string" ||
    /[\s\\<>"`]/u.test(value) ||
    [...value].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    return null;
  const match = /^(https?):\/\/([^/?#]+)([/?#].*)?$/i.exec(value);
  if (!match) return null;
  const authority = /^([a-z\d.-]+)(?::([0-9]{1,5}))?$/i.exec(match[2]);
  if (!authority) return null;
  const hostname = authority[1].toLowerCase();
  const labels = hostname.split(".");
  if (
    hostname.length > 253 ||
    labels.length < 2 ||
    !/^[a-z][a-z\d-]*$/i.test(labels.at(-1)!) ||
    labels.some((label) => !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))
  )
    return null;
  const port = authority[2] || "";
  if (port && (Number(port) < 1 || Number(port) > 65535)) return null;
  try {
    decodeURI(value);
  } catch {
    return null;
  }
  return {
    url: value,
    protocol: match[1].toLowerCase(),
    hostname,
    port,
    suffix: match[3] || "",
  };
}

/** 保留 / 内网专用后缀：DNS 中不指向公开站点，公开外链一律拒绝。 */
const RESERVED_SUFFIXES = [
  "local",
  "localhost",
  "test",
  "example",
  "invalid",
  "internal",
  "home",
  "lan",
  "arpa",
];

/**
 * ADR 0011 的公开外链规则：仅无凭据、无显式非默认端口的公开 HTTPS DNS 地址。
 * H5 新标签安全打开与复制都走这里，不再依赖小程序业务域名白名单；
 * 微信小程序承载页仍用 resolveWebViewSource 的精确主机列表。
 */
export function resolvePublicSourceUrl(value: unknown): SourceUrl | null {
  const source = parseSourceUrl(value);
  if (
    !source ||
    source.protocol !== "https" ||
    (source.port !== "" && source.port !== "443") ||
    RESERVED_SUFFIXES.includes(source.hostname.split(".").at(-1)!)
  )
    return null;
  return source;
}

/**
 * 仅核准主机的 HTTPS 静态通知可嵌入；带 query/hash 的地址统一复制，
 * 不尝试猜测各站的跳转参数名，防止编码和站点私有跳转参数绕过。
 * 承载页必须再次调用，路由传参不能视为可信。
 */
export function resolveWebViewSource(
  value: unknown,
  allowedHosts: readonly string[] = approvedWebViewHosts,
): string | null {
  const source = parseSourceUrl(value);
  if (
    !source ||
    source.protocol !== "https" ||
    (source.port !== "" && source.port !== "443") ||
    !allowedHosts.includes(source.hostname) ||
    /[?#]/.test(source.suffix)
  )
    return null;
  return source.url;
}
