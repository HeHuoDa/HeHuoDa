import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";
import { gunzipSync, inflateSync, brotliDecompressSync } from "node:zlib";
import { sources } from "./sources.js";
import type { Source } from "./sources.js";

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}
export interface FetchResult extends HttpResponse {
  url: string;
  html: string;
}
export interface HttpLimits {
  requests: number;
  intervalMs: number;
  timeoutMs: number;
  durationMs: number;
  bytes: number;
  signal?: AbortSignal;
  /** 传输层逐块记录实际接收量，含超限/取消前已收到的字节。 */
  onDownload?: (bytes: number) => void;
  beforeRequest?: (url: URL) => Promise<void>;
  onUsage?: (usage: {
    requests: number;
    downloadedBytes: number;
    elapsedMs: number;
  }) => Promise<void>;
}
export const defaultLimits: HttpLimits = {
  requests: 80,
  intervalMs: 2000,
  timeoutMs: 15000,
  durationMs: 600000,
  bytes: 2 * 1024 * 1024,
};
export const userAgent =
  "HeHuoDaIngestion/1.0 (public academic notices; manual review)";
export class BudgetExhaustedError extends Error {}
export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(address) === 6) {
    // 仅允许全球单播；拒绝映射 IPv4、ULA、链路本地、组播及特殊转换范围。
    const parts = address.toLowerCase().split(":");
    const first = parseInt(parts[0], 16);
    return (
      first >= 0x2000 &&
      first <= 0x3fff &&
      !(first === 0x2001 && parseInt(parts[1] || "0", 16) <= 0x1ff) &&
      !(first === 0x2001 && parseInt(parts[1] || "0", 16) === 0xdb8) &&
      first !== 0x2002 &&
      first < 0x3ffe
    );
  }
  return false;
}
export function safeUrl(value: string, source: Source): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== source.host ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error("请求 URL 不在来源 HTTPS 白名单");
  if (
    url.pathname !== "/robots.txt" &&
    !source.channels.some(
      (channel) =>
        new RegExp(channel.listPath).test(url.pathname) ||
        new RegExp(channel.noticePath).test(url.pathname),
    )
  )
    throw new Error("请求路径不在来源注册栏目白名单");
  url.hash = "";
  return url;
}
export function parseDnsOverrides(
  value: string | undefined,
): Record<string, string[]> {
  if (!value) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("来源公网 DNS 配置须为 JSON 对象");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("来源公网 DNS 配置须为 JSON 对象");
  for (const [host, addresses] of Object.entries(parsed))
    if (
      !sources.some((s) => s.host === host) ||
      !Array.isArray(addresses) ||
      !addresses.length ||
      addresses.length > 4 ||
      addresses.some(
        (ip: unknown) => typeof ip !== "string" || !publicAddress(ip),
      )
    )
      throw new Error("来源公网 DNS 配置含非白名单域名或危险地址");
  return parsed as Record<string, string[]>;
}
export function normalizeUrl(value: string, source: Source): string {
  const url = safeUrl(value, source);
  for (const key of [...url.searchParams.keys()])
    if (/^utm_(source|medium|campaign|term|content)$/i.test(key))
      url.searchParams.delete(key);
  return url.toString();
}
export function decodeHtml(body: Uint8Array, contentType = ""): string {
  const head = new TextDecoder("latin1").decode(body.subarray(0, 2048));
  const label =
    /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1] ??
    /charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] ??
    "utf-8";
  try {
    return new TextDecoder(label, { fatal: true }).decode(body);
  } catch {
    throw new Error("响应编码无效或不支持");
  }
}
export type Transport = (
  url: URL,
  limits: HttpLimits,
  headers: Record<string, string>,
) => Promise<HttpResponse>;
export const nativeTransport: Transport = async (url, limits, headers) => {
  const signal = AbortSignal.any([
    AbortSignal.timeout(limits.timeoutMs),
    ...(limits.signal ? [limits.signal] : []),
  ]);
  signal.throwIfAborted();
  const override = parseDnsOverrides(process.env.INGESTION_DNS_OVERRIDES)[
    url.hostname
  ];
  const addresses = override
    ? override.map((address) => ({ address, family: isIP(address) }))
    : await Promise.race([
        lookup(url.hostname, { all: true }),
        new Promise<never>((_, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new Error("DNS 超时")),
            {
              once: true,
            },
          ),
        ),
      ]);
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new Error("DNS 返回危险连接地址");
  const pinned = addresses.find((a) => a.family === 4) ?? addresses[0];
  return new Promise<HttpResponse>((resolve, reject) => {
    const req = request(
      url,
      {
        headers: {
          "User-Agent": userAgent,
          Accept: "text/html,text/plain",
          "Accept-Encoding": "identity",
          ...headers,
        },
        signal,
        agent: false,
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [pinned]);
          else callback(null, pinned.address, pinned.family);
        },
      },
      (res) => {
        if (
          !res.socket.remoteAddress ||
          !publicAddress(res.socket.remoteAddress)
        ) {
          res.destroy(new Error("实际连接地址不是公网地址"));
          reject(new Error("实际连接地址不是公网地址"));
          return;
        }
        const parts: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          limits.onDownload?.(chunk.length);
          size += chunk.length;
          if (size > limits.bytes) res.destroy(new Error("响应体超过上限"));
          else parts.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          const normalized = Object.fromEntries(
            Object.entries(res.headers).map(([k, v]) => [
              k,
              Array.isArray(v) ? v.join(",") : (v ?? ""),
            ]),
          );
          resolve({
            status: res.statusCode ?? 0,
            headers: normalized,
            body: Buffer.concat(parts),
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
};
export class BoundedFetcher {
  private used = 0;
  private downloaded = 0;
  private readonly started: number;
  private lastRequest: number | null = null;
  private robots: {
    rules: { allow: boolean; pattern: string }[];
    delay: number;
  } | null = null;
  get remainingRequests() {
    return this.limits.requests - this.used;
  }
  get usage() {
    return {
      requests: this.used,
      downloadedBytes: this.downloaded,
      elapsedMs: Math.max(0, this.now() - this.started),
    };
  }
  constructor(
    readonly source: Source,
    readonly limits: HttpLimits = defaultLimits,
    private readonly transport: Transport = nativeTransport,
    private readonly now = () => Date.now(),
    private readonly sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ) {
    this.started = now();
    // 开始前也等待一个间隔，覆盖不同进程前后接力运行的最后一次请求。
    this.lastRequest = this.started;
    if (
      ![
        limits.requests,
        limits.intervalMs,
        limits.timeoutMs,
        limits.durationMs,
        limits.bytes,
      ].every(Number.isInteger) ||
      limits.requests < 1 ||
      limits.requests > 200 ||
      limits.intervalMs < 2000 ||
      limits.intervalMs > 60000 ||
      limits.timeoutMs < 1000 ||
      limits.timeoutMs > 30000 ||
      limits.durationMs < 1000 ||
      limits.durationMs > 900000 ||
      limits.bytes < 1024 ||
      limits.bytes > 5 * 1024 * 1024
    )
      throw new Error("请求配置超过边界");
  }
  private async pause(ms: number) {
    if (this.limits.signal?.aborted) throw new Error("采集已停止");
    if (this.now() - this.started + ms >= this.limits.durationMs)
      throw new BudgetExhaustedError("运行时长预算耗尽");
    if (ms > 0) {
      const signal = this.limits.signal;
      if (!signal) await this.sleep(ms);
      else {
        let onAbort: (() => void) | undefined;
        try {
          await Promise.race([
            this.sleep(ms),
            new Promise<never>((_, reject) => {
              onAbort = () => reject(new Error("采集已停止"));
              signal.addEventListener("abort", onAbort, { once: true });
            }),
          ]);
        } finally {
          if (onAbort) signal.removeEventListener("abort", onAbort);
        }
      }
    }
    if (this.limits.signal?.aborted) throw new Error("采集已停止");
  }
  private async response(
    value: string,
    headers: Record<string, string> = {},
  ): Promise<FetchResult> {
    let url = safeUrl(value, this.source);
    let redirects = 0;
    let retries = 0;
    while (true) {
      if (
        this.robots &&
        !robotsAllowed(url.pathname + url.search, this.robots.rules)
      )
        throw new Error("robots.txt 禁止重定向路径");
      if (this.used >= this.limits.requests)
        throw new BudgetExhaustedError("请求预算耗尽");
      await this.pause(
        this.lastRequest === null
          ? 0
          : Math.max(
              0,
              Math.max(this.limits.intervalMs, this.robots?.delay ?? 0) -
                (this.now() - this.lastRequest),
            ),
      );
      await this.limits.beforeRequest?.(url);
      this.used++;
      await this.limits.onUsage?.(this.usage);
      this.lastRequest = this.now();
      let res: HttpResponse;
      let reported = 0;
      try {
        res = await this.transport(
          url,
          {
            ...this.limits,
            onDownload: (bytes) => {
              reported += bytes;
              this.downloaded += bytes;
            },
            timeoutMs: Math.min(
              this.limits.timeoutMs,
              this.limits.durationMs - (this.now() - this.started),
            ),
          },
          headers,
        );
        if (!reported) this.downloaded += res.body.byteLength;
        await this.limits.onUsage?.(this.usage);
      } catch (error) {
        await this.limits.onUsage?.(this.usage);
        if (this.limits.signal?.aborted)
          throw new Error("采集已停止", { cause: error });
        if (error instanceof Error && /危险|白名单|上限/.test(error.message))
          throw error;
        if (retries++ >= 2)
          throw new Error("HTTP 超时或连接失败，有限重试结束", {
            cause: error,
          });
        await this.pause(2000 * 2 ** (retries - 1));
        continue;
      }
      if (res.body.byteLength > this.limits.bytes)
        throw new Error("响应体超过上限");
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        if (++redirects > 3 || !res.headers.location)
          throw new Error("异常重定向");
        url = safeUrl(
          new URL(res.headers.location, url).toString(),
          this.source,
        );
        headers = {};
        continue;
      }
      if (res.status === 401 || res.status === 403)
        throw new Error("站点拒绝访问，停止来源采集");
      if (res.status === 429 || [500, 502, 503, 504].includes(res.status)) {
        if (retries++ >= 2) throw new Error("站点限流或临时服务错误");
        const after = res.headers["retry-after"];
        const delay = after
          ? /^\d+$/.test(after)
            ? Number(after) * 1000
            : Date.parse(after) - this.now()
          : 2000 * 2 ** (retries - 1);
        if (!Number.isFinite(delay) || delay > 60000)
          throw new Error("Retry-After 超出本次等待预算，停止采集");
        await this.pause(Math.max(2000, delay));
        continue;
      }
      let decoded = res.body;
      const encoding = res.headers["content-encoding"]?.toLowerCase();
      try {
        if (encoding === "gzip")
          decoded = gunzipSync(res.body, {
            maxOutputLength: this.limits.bytes,
          });
        else if (encoding === "deflate")
          decoded = inflateSync(res.body, {
            maxOutputLength: this.limits.bytes,
          });
        else if (encoding === "br")
          decoded = brotliDecompressSync(res.body, {
            maxOutputLength: this.limits.bytes,
          });
        else if (encoding && encoding !== "identity")
          throw new Error("不支持的 HTTP 压缩编码");
      } catch (error) {
        throw new Error("压缩响应损坏或解压体积超过上限", { cause: error });
      }
      const html =
        res.status === 304
          ? ""
          : decodeHtml(decoded, res.headers["content-type"]);
      if (
        res.status === 200 &&
        /验证码|captcha|访问过于频繁|访问被拒绝|登录后访问/i.test(html)
      )
        throw new Error("出现验证码、登录或拦截页，停止来源采集");
      return { ...res, url: url.toString(), html };
    }
  }
  async checkRobots() {
    const result = await this.response(
      `https://${this.source.host}/robots.txt`,
    );
    if (result.status === 404 || result.status === 410) {
      this.robots = { rules: [], delay: 0 };
      return "robots.txt 不存在（HTTP " + result.status + "）";
    }
    if (result.status !== 200 || /<html/i.test(result.html))
      throw new Error("robots.txt 无法核实，停止来源采集");
    this.robots = parseRobots(result.html);
    if (this.robots.delay > 60000)
      throw new Error("robots 请求间隔超出运行预算");
    return "已核对 robots.txt";
  }
  async get(
    value: string,
    headers: Record<string, string> = {},
  ): Promise<FetchResult> {
    if (!this.robots) throw new Error("采集前必须核对 robots.txt");
    const url = safeUrl(value, this.source);
    if (!robotsAllowed(url.pathname + url.search, this.robots.rules))
      throw new Error("robots.txt 禁止该路径");
    const result = await this.response(url.toString(), headers);
    // 重定向后的路径也必须被允许；response 在每次跟随后先校验路径。
    return result;
  }
}
export function parseRobots(text: string) {
  const groups: {
    agents: string[];
    rules: { allow: boolean; pattern: string }[];
    delay: number;
  }[] = [];
  let group: (typeof groups)[number] | undefined;
  let hasRule = false;
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([^:#]+):\s*([^#]*)/.exec(line);
    if (!match) continue;
    const key = match[1].trim().toLowerCase(),
      value = match[2].trim();
    if (key === "user-agent") {
      if (!group || hasRule) {
        group = { agents: [], rules: [], delay: 0 };
        groups.push(group);
        hasRule = false;
      }
      group.agents.push(value.toLowerCase());
    } else if (group) {
      hasRule = true;
      if ((key === "allow" || key === "disallow") && value)
        group.rules.push({ allow: key === "allow", pattern: value });
      if (key === "crawl-delay")
        group.delay = Math.max(group.delay, Number(value) * 1000 || 0);
    }
  }
  const specific = groups.filter((g) => g.agents.includes("hehuodaingestion"));
  const selected = specific.length
    ? specific
    : groups.filter((g) => g.agents.includes("*"));
  return {
    rules: selected.flatMap((g) => g.rules),
    delay: Math.max(0, ...selected.map((g) => g.delay)),
  };
}
export function robotsAllowed(
  path: string,
  rules: { allow: boolean; pattern: string }[],
): boolean {
  const matches = rules
    .filter((r) =>
      new RegExp(
        "^" +
          r.pattern
            .replace(/[.+?^{}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*")
            .replace(/\$$/, "$"),
      ).test(path),
    )
    .sort(
      (a, b) =>
        b.pattern.length - a.pattern.length ||
        Number(b.allow) - Number(a.allow),
    );
  return matches[0]?.allow ?? true;
}
