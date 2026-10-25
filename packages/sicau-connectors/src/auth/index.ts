import { randomBytes } from "node:crypto";
import { SchoolCookies } from "./cookies.js";
import {
  appid,
  captchaPath,
  decode,
  loginPath,
  origin,
  parseChallenge,
  parseIdentity,
} from "./protocol.js";
import { schoolTransport } from "./transport.js";
import {
  SchoolAuthError,
  type AuthChallenge,
  type AuthErrorCode,
  type AuthIdentity,
  type AuthOptions,
  type AuthSubmission,
  type AuthTransport,
  type ChallengeOptions,
} from "./types.js";
export { SchoolAuthError } from "./types.js";
export type {
  AuthChallenge,
  AuthErrorCode,
  AuthHttpRequest,
  AuthHttpResponse,
  AuthIdentity,
  AuthOptions,
  AuthSubmission,
  AuthTransport,
  ChallengeOptions,
} from "./types.js";

interface Session {
  handle: string;
  version: string;
  uuid?: string;
  expiresAt: number;
  phase: "waiting" | "refreshing" | "submitting";
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  unlisten: Set<() => void>;
  cookies: SchoolCookies;
}
const token = () => randomBytes(32).toString("base64url");
function limit(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0 || result > maximum)
    throw new SchoolAuthError("invalid_input");
  return result;
}

/** 单实例、进程内短时会话；平台归属、限频、持久事务均由调用方负责。 */
export class SchoolAuthClient {
  private readonly sessions = new Map<string, Session>();
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly capacity: number;
  private readonly bytes: number;
  private disposed = false;

  constructor(
    options: AuthOptions = {},
    private readonly transport: AuthTransport = schoolTransport,
  ) {
    this.ttlMs = limit(options.sessionTtlMs, 300_000, 300_000);
    this.timeoutMs = limit(options.requestTimeoutMs, 10_000, 300_000);
    this.capacity = limit(options.maxSessions, 128, 10_000);
    this.bytes = limit(options.maxResponseBytes, 256 * 1024, 1024 * 1024);
  }

  async createChallenge(
    options: ChallengeOptions = {},
  ): Promise<AuthChallenge> {
    if (this.disposed) throw new SchoolAuthError("disposed");
    if (options.signal?.aborted) throw new SchoolAuthError("cancelled");
    const ttl =
      options.ttlMs === undefined
        ? this.ttlMs
        : Math.min(limit(options.ttlMs, this.ttlMs, 300_000), this.ttlMs);
    if (this.sessions.size >= this.capacity)
      throw new SchoolAuthError("capacity_exceeded");
    const handle = token();
    const session: Session = {
      handle,
      version: token(),
      expiresAt: Date.now() + ttl,
      phase: "refreshing",
      controller: new AbortController(),
      unlisten: new Set(),
      cookies: new SchoolCookies(),
      timer: setTimeout(() => this.drop(session, "session_expired"), ttl),
    };
    session.timer.unref();
    this.sessions.set(handle, session);
    this.bind(session, options.signal);
    return this.challenge(session);
  }

  async refreshChallenge(
    handle: string,
    signal?: AbortSignal,
  ): Promise<AuthChallenge> {
    const session = this.live(handle);
    if (session.phase !== "waiting") throw new SchoolAuthError("session_busy");
    session.phase = "refreshing";
    session.uuid = undefined;
    session.version = token();
    const unbind = this.bind(session, signal);
    try {
      return await this.challenge(session);
    } finally {
      unbind();
    }
  }

  async submit(input: AuthSubmission): Promise<AuthIdentity> {
    const session = this.live(input.handle);
    if (session.phase !== "waiting") throw new SchoolAuthError("session_busy");
    if (session.version !== input.challengeVersion)
      throw new SchoolAuthError("stale_challenge");
    if (
      ![input.account, input.password, input.captcha].every(
        (value) =>
          typeof value === "string" && value.length > 0 && value.length <= 1024,
      )
    )
      throw new SchoolAuthError("invalid_input");
    session.phase = "submitting";
    this.bind(session, input.signal);
    try {
      const body = JSON.stringify({
        appid,
        number: input.account,
        password: input.password,
        code: input.captcha,
        uuid: session.uuid,
      });
      const envelope = await this.send(session, loginPath, body);
      this.check(session);
      return parseIdentity(envelope);
    } finally {
      this.drop(session, "invalid_session");
    }
  }

  destroy(handle: string): void {
    const session = this.sessions.get(handle);
    if (session) this.drop(session, "cancelled");
  }

  dispose(): void {
    this.disposed = true;
    for (const session of this.sessions.values())
      this.drop(session, "cancelled");
  }

  private live(handle: string): Session {
    const session = this.sessions.get(handle);
    if (!session) throw new SchoolAuthError("invalid_session");
    this.check(session);
    return session;
  }

  private check(session: Session): void {
    if (session.controller.signal.aborted)
      throw session.controller.signal.reason;
    if (Date.now() >= session.expiresAt) {
      this.drop(session, "session_expired");
      throw new SchoolAuthError("session_expired");
    }
  }

  private bind(session: Session, signal?: AbortSignal): () => void {
    if (!signal) return () => {};
    const cancel = () => this.drop(session, "cancelled");
    if (signal.aborted) cancel();
    else {
      signal.addEventListener("abort", cancel, { once: true });
      session.unlisten.add(unbind);
    }
    function unbind() {
      signal?.removeEventListener("abort", cancel);
      session.unlisten.delete(unbind);
    }
    return unbind;
  }

  private drop(session: Session, reason: AuthErrorCode): void {
    this.sessions.delete(session.handle);
    clearTimeout(session.timer);
    for (const unlisten of session.unlisten) unlisten();
    session.unlisten.clear();
    session.uuid = undefined;
    session.cookies.clear();
    session.controller.abort(new SchoolAuthError(reason));
  }

  private async challenge(session: Session): Promise<AuthChallenge> {
    try {
      const envelope = await this.send(session, captchaPath);
      this.check(session);
      const { uuid, imageDataUrl } = parseChallenge(envelope);
      session.uuid = uuid;
      session.phase = "waiting";
      return {
        handle: session.handle,
        challengeVersion: session.version,
        imageDataUrl,
        mimeType: "image/png",
        expiresAt: session.expiresAt,
      };
    } catch (error) {
      this.drop(session, "invalid_session");
      throw error;
    }
  }

  private async send(
    session: Session,
    path: string,
    body?: string,
  ): Promise<Record<string, unknown>> {
    this.check(session);
    const signal = session.controller.signal;
    const timer = setTimeout(
      () => this.drop(session, "upstream_timeout"),
      this.timeoutMs,
    );
    let remove = () => {};
    try {
      const cookie = session.cookies.header(new URL(origin + path).pathname);
      const response = await new Promise<Awaited<ReturnType<AuthTransport>>>(
        (resolve, reject) => {
          const abort = () => reject(signal.reason);
          signal.addEventListener("abort", abort, { once: true });
          remove = () => signal.removeEventListener("abort", abort);
          this.transport({
            url: origin + path,
            method: body === undefined ? "GET" : "POST",
            body,
            signal,
            maxResponseBytes: this.bytes,
            headers: {
              accept: "application/json",
              "cache-control": "no-store",
              ...(cookie ? { cookie } : {}),
              ...(body === undefined
                ? {}
                : {
                    "content-type": "application/json",
                    "content-length": String(Buffer.byteLength(body)),
                  }),
            },
          }).then(resolve, reject);
        },
      );
      this.check(session);
      if (response.body.byteLength > this.bytes)
        throw new SchoolAuthError("unknown_response");
      session.cookies.receive(
        response.headers["set-cookie"],
        new URL(origin + path).pathname,
      );
      return decode(response);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      throw error instanceof SchoolAuthError
        ? error
        : new SchoolAuthError("upstream_unavailable");
    } finally {
      clearTimeout(timer);
      remove();
    }
  }
}
