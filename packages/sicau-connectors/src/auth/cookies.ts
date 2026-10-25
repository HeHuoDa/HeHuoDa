import { SchoolAuthError } from "./types.js";

interface Cookie {
  name: string;
  value: string;
  path: string;
  expiresAt: number;
}

/** 仅用于固定 HTTPS 主机的内存容器；没有跨来源请求或序列化入口。 */
export class SchoolCookies {
  private readonly entries = new Map<string, Cookie>();

  receive(headers: string | string[] | undefined, pathname: string): void {
    if (!headers) return;
    const lines = Array.isArray(headers) ? headers : [headers];
    if (lines.length > 32) throw new SchoolAuthError("unknown_response");
    for (const line of lines) {
      if (line.length > 4096) throw new SchoolAuthError("unknown_response");
      const [pair, ...attributes] = line.split(";");
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
        !/^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/.test(value)
      )
        continue;
      const attrs = new Map(
        attributes.map((attribute) => {
          const index = attribute.indexOf("=");
          return index < 0
            ? [attribute.trim().toLowerCase(), ""]
            : [
                attribute.slice(0, index).trim().toLowerCase(),
                attribute.slice(index + 1).trim(),
              ];
        }),
      );
      const domain = attrs.get("domain")?.replace(/^\./, "").toLowerCase();
      if (
        domain !== undefined &&
        domain !== "auth.sicau.edu.cn" &&
        domain !== "sicau.edu.cn"
      )
        continue;
      const requestedPath = attrs.get("path");
      const path = requestedPath?.startsWith("/")
        ? requestedPath
        : pathname.slice(0, pathname.lastIndexOf("/")) || "/";
      if (
        [...path].some(
          (character) =>
            character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
        )
      )
        continue;
      if (name.startsWith("__Secure-") && !attrs.has("secure")) continue;
      if (
        name.startsWith("__Host-") &&
        (!attrs.has("secure") || domain !== undefined || requestedPath !== "/")
      )
        continue;
      let expiresAt = Infinity;
      const expires = attrs.get("expires"),
        age = attrs.get("max-age");
      if (expires && Number.isFinite(Date.parse(expires)))
        expiresAt = Date.parse(expires);
      if (age !== undefined && /^-?\d+$/.test(age))
        expiresAt = Date.now() + Number(age) * 1000;
      const key = `${domain ?? "auth.sicau.edu.cn"}\n${path}\n${name}`;
      if (expiresAt <= Date.now()) this.entries.delete(key);
      else this.entries.set(key, { name, value, path, expiresAt });
      if (this.entries.size > 32) throw new SchoolAuthError("unknown_response");
    }
  }

  header(pathname: string): string | undefined {
    for (const [key, cookie] of this.entries)
      if (cookie.expiresAt <= Date.now()) this.entries.delete(key);
    const value = [...this.entries.values()]
      .filter(
        (cookie) =>
          pathname === cookie.path ||
          pathname.startsWith(
            cookie.path.endsWith("/") ? cookie.path : cookie.path + "/",
          ),
      )
      .sort((a, b) => b.path.length - a.path.length)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    if (value.length > 16 * 1024) throw new SchoolAuthError("unknown_response");
    return value || undefined;
  }

  clear(): void {
    this.entries.clear();
  }
}
