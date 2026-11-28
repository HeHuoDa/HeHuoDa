export interface SourceUrl {
  url: string;
  protocol: string;
  hostname: string;
  port: string;
  suffix: string;
}

/**
 * 保守的 HTTP(S) DNS 地址子集，不依赖运行时未保证提供的全局 URL。
 * 不修复空白、反斜杠、userinfo、编码主机、端口或破损转义，避免浏览器二次解释。
 * 官方来源使用 ASCII DNS 主机；IP / 国际化主机需先独立评估后扩展。
 *
 * 现行交付端（H5 与 Android）之间可执行地址的判定见 `./public-url.ts` 的
 * `resolvePublicSourceUrl`，它与管理端手工录入通道共用同一套规则。
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
    !/^[a-z][a-z\d-]*$/i.test(labels[labels.length - 1]) ||
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
