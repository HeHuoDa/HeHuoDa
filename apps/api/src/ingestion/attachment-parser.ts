import { spawn } from "node:child_process";
import {
  AttachmentParseError,
  type AttachmentMediaType,
  type AttachmentSegment,
} from "@hehuoda/sicau-connectors/notices";

export interface IsolatedAttachmentResult {
  mediaType: AttachmentMediaType;
  extractorVersion: string;
  status: "extracted" | "blocked";
  errorCode?: string;
  segments: AttachmentSegment[];
}

export function parseAttachmentIsolated(
  bytes: Uint8Array,
  mediaType: AttachmentMediaType,
  options: { timeoutMs?: number; workerPath?: string } = {},
): Promise<IsolatedAttachmentResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000)
    return Promise.reject(
      new AttachmentParseError("invalid-timeout", "附件解析时间限制无效"),
    );
  if (bytes.byteLength > 5 * 1024 * 1024)
    return Promise.reject(
      new AttachmentParseError("input-size-limit", "附件超过5MiB下载上限"),
    );
  if (process.platform !== "linux")
    return Promise.reject(
      new AttachmentParseError(
        "sandbox-unavailable",
        "当前系统没有受支持的禁止出网隔离环境",
      ),
    );

  const workerPath =
    options.workerPath ??
    new URL("./attachment-worker.js", import.meta.url).pathname;
  const args = [
    process.execPath,
    "--permission",
    "--allow-worker",
    "--allow-addons",
    "--allow-fs-read=/app/dist",
    "--allow-fs-read=/app/node_modules",
    "--allow-fs-read=/usr",
    "--allow-fs-read=/lib",
    "--allow-fs-read=/lib64",
    "--max-old-space-size=256",
    workerPath,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/local/bin/attachment-sandbox", args, {
      cwd: "/app",
      env: {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        NODE_ENV: "production",
        HOME: "/nonexistent",
      },
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    const output: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let terminationError: Error | undefined;
    const finish = (error?: Error, result?: IsolatedAttachmentResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = setTimeout(() => {
      terminationError = new AttachmentParseError(
        "parse-timeout",
        "附件解析超过时限",
      );
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", () =>
      finish(
        new AttachmentParseError(
          "sandbox-unavailable",
          "Linux seccomp/Landlock隔离器不可用",
        ),
      ),
    );
    child.stdin.on("error", () =>
      finish(
        new AttachmentParseError(
          "parser-input-failed",
          "隔离解析子进程未接收输入",
        ),
      ),
    );
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > 1024 * 1024) {
        terminationError = new AttachmentParseError(
          "ipc-output-limit",
          "附件解析IPC输出超限",
        );
        child.kill("SIGKILL");
      } else output.push(chunk);
    });
    child.on("close", (code) => {
      if (settled) return;
      if (terminationError) return finish(terminationError);
      if (code !== 0)
        return finish(
          new AttachmentParseError("parse-failed", "隔离附件解析失败"),
        );
      try {
        const parsed: unknown = JSON.parse(
          Buffer.concat(output).toString("utf8"),
        );
        if (
          parsed &&
          typeof parsed === "object" &&
          "errorCode" in parsed &&
          !("segments" in parsed)
        ) {
          const code =
            typeof parsed.errorCode === "string" &&
            /^[a-z0-9-]{1,80}$/.test(parsed.errorCode)
              ? parsed.errorCode
              : "parse-failed";
          return finish(
            new AttachmentParseError(code, "附件无法完整提取，需人工核对"),
          );
        }
        if (
          !parsed ||
          typeof parsed !== "object" ||
          !("status" in parsed) ||
          !["extracted", "blocked"].includes(String(parsed.status)) ||
          !("segments" in parsed) ||
          !Array.isArray(parsed.segments)
        )
          return finish(
            new AttachmentParseError(
              "invalid-parser-output",
              "隔离附件解析返回格式无效",
            ),
          );
        finish(undefined, parsed as IsolatedAttachmentResult);
      } catch {
        finish(
          new AttachmentParseError(
            "invalid-parser-output",
            "隔离附件解析返回格式无效",
          ),
        );
      }
    });
    child.stdin.end(
      JSON.stringify({
        bytes: Buffer.from(bytes).toString("base64"),
        mediaType,
      }),
    );
  });
}
