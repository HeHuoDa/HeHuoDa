import { request } from "node:https";
import { origin, captchaPath, loginPath } from "./protocol.js";
import { SchoolAuthError, type AuthTransport } from "./types.js";

/** 固定来源、无重试、无重定向、无缓存；不沿用 notices 的 HTTP 链。 */
export const schoolTransport: AuthTransport = (input) =>
  new Promise((resolve, reject) => {
    if (!(
      (input.method === "GET" && input.url === origin + captchaPath) ||
      (input.method === "POST" && input.url === origin + loginPath)
    )) {
      reject(new SchoolAuthError("invalid_input"));
      return;
    }
    const req = request(
      input.url,
      {
        method: input.method,
        headers: input.headers,
        signal: input.signal,
        agent: false,
        maxHeaderSize: 16 * 1024,
      },
      (res) => {
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > input.maxResponseBytes) {
            chunks.length = 0;
            req.destroy(new SchoolAuthError("unknown_response"));
          } else chunks.push(chunk);
        });
        res.on("error", () =>
          reject(new SchoolAuthError("upstream_unavailable")),
        );
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          chunks.length = 0;
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
      },
    );
    req.on("error", (error) =>
      reject(
        error instanceof SchoolAuthError
          ? error
          : new SchoolAuthError("upstream_unavailable"),
      ),
    );
    req.end(input.body);
  });
