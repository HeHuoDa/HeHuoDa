import type { H5CredentialResponse } from "@hehuoda/api-types";
import { RequestError } from "../api/http.ts";

export const H5_COORD_KEY = "hehuoda.auth.h5.coord.v1";
export const H5_LOCK_NAME = "hehuoda:auth:h5";
export const H5_CHANNEL_NAME = "hehuoda.auth.h5.v1";

export type H5CoordStatus =
  | "idle"
  | "running"
  | "succeeded"
  | "failed"
  | "restricted"
  | "logged_out"
  | "rate_limited"
  | "unknown";

/** 仅含无身份、无凭据的协调元数据，绝不保存令牌、用户 ID 或学号。 */
export interface H5CoordRecord {
  seq: number;
  roundId: string;
  status: H5CoordStatus;
  ownerTabId: string;
  logoutSeq: number;
  updatedAt: number;
  retryUntil?: number;
}

export interface H5CoordStorage {
  read(): H5CoordRecord | null;
  write(record: H5CoordRecord): void;
}

export interface H5BroadcastChannelLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
}

export interface H5LocksLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export interface H5TabSyncEnv {
  isSecureContext?: boolean;
  locks?: H5LocksLike | null;
  createChannel?: ((name: string) => H5BroadcastChannelLike) | null;
  coordStorage?: H5CoordStorage;
  now?: () => number;
  graceMs?: number;
  logoutLockTimeoutMs?: number;
  tabId?: string;
}

export type H5SyncMessage =
  | {
      kind: "refresh-result";
      seq: number;
      roundId: string;
      senderTabId: string;
      outcome: "succeeded";
      credential: H5CredentialResponse;
    }
  | {
      kind: "refresh-result";
      seq: number;
      roundId: string;
      senderTabId: string;
      outcome: "failed" | "restricted" | "rate_limited" | "unknown";
      retryUntil?: number;
      errorCode?: string;
    }
  | {
      kind: "login-succeeded";
      seq: number;
      roundId: string;
      senderTabId: string;
      credential: H5CredentialResponse;
    }
  | {
      kind: "logout";
      seq: number;
      senderTabId: string;
    };

export interface H5TabSyncHandlers {
  currentAccessToken(): string | null;
  onRemoteRefresh(credential: H5CredentialResponse): void;
  onRemoteLogin(credential: H5CredentialResponse): void;
  onRemoteLogout(): void;
  onRemoteInvalidated(
    outcome: "failed" | "restricted",
    errorCode?: string,
  ): void;
}

export type CoordinateRefreshResult =
  | { kind: "refreshed"; credential: H5CredentialResponse }
  | { kind: "adopted"; credential: H5CredentialResponse | null }
  | { kind: "logged-out" }
  | { kind: "restricted"; error?: unknown }
  | { kind: "failed"; error?: unknown }
  | { kind: "rate-limited"; retryUntil?: number; error?: unknown }
  | { kind: "unknown"; error?: unknown }
  | { kind: "unsupported" };

function defaultTabId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto;
  if (typeof cryptoObj?.randomUUID === "function")
    return cryptoObj.randomUUID();
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultRoundId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto;
  if (typeof cryptoObj?.randomUUID === "function")
    return cryptoObj.randomUUID();
  return `round-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const VALID_STATUSES = new Set<H5CoordStatus>([
  "idle",
  "running",
  "succeeded",
  "failed",
  "restricted",
  "logged_out",
  "rate_limited",
  "unknown",
]);

function isCoordRecord(v: unknown): v is H5CoordRecord {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.seq === "number" &&
    Number.isInteger(r.seq) &&
    r.seq >= 0 &&
    typeof r.roundId === "string" &&
    typeof r.ownerTabId === "string" &&
    typeof r.logoutSeq === "number" &&
    Number.isInteger(r.logoutSeq) &&
    r.logoutSeq >= 0 &&
    typeof r.updatedAt === "number" &&
    Number.isFinite(r.updatedAt) &&
    VALID_STATUSES.has(r.status as H5CoordStatus) &&
    (r.retryUntil === undefined ||
      (typeof r.retryUntil === "number" && Number.isFinite(r.retryUntil)))
  );
}

function browserCoordStorage(): H5CoordStorage {
  const storage = (
    globalThis as {
      localStorage?: {
        getItem(k: string): string | null;
        setItem(k: string, v: string): void;
      };
    }
  ).localStorage;
  return {
    read() {
      try {
        const raw = storage?.getItem(H5_COORD_KEY);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return isCoordRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    write(record) {
      try {
        storage?.setItem(H5_COORD_KEY, JSON.stringify(record));
      } catch {
        /* 协调存储不可用时不落凭据，也不阻塞本次会话。 */
      }
    },
  };
}

function resolveDefaultEnv(): Required<
  Pick<
    H5TabSyncEnv,
    | "isSecureContext"
    | "locks"
    | "createChannel"
    | "coordStorage"
    | "now"
    | "graceMs"
    | "logoutLockTimeoutMs"
  >
> {
  const host = globalThis as unknown as {
    isSecureContext?: boolean;
    navigator?: { locks?: H5LocksLike };
    BroadcastChannel?: new (name: string) => H5BroadcastChannelLike;
  };
  const ChannelCtor = host.BroadcastChannel;
  return {
    isSecureContext: host.isSecureContext === true,
    locks:
      typeof host.navigator?.locks?.request === "function"
        ? host.navigator.locks
        : null,
    createChannel:
      typeof ChannelCtor === "function"
        ? (name: string) => new ChannelCtor(name)
        : null,
    coordStorage: browserCoordStorage(),
    now: () => Date.now(),
    graceMs: 400,
    logoutLockTimeoutMs: 1500,
  };
}

function isMessage(v: unknown): v is H5SyncMessage {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  if (
    typeof r.seq !== "number" ||
    !Number.isInteger(r.seq) ||
    typeof r.senderTabId !== "string"
  ) {
    return false;
  }
  return (
    r.kind === "logout" ||
    (r.kind === "login-succeeded" && typeof r.roundId === "string") ||
    (r.kind === "refresh-result" && typeof r.roundId === "string")
  );
}

function classifyRefreshError(
  error: unknown,
  now: number,
): {
  outcome: "failed" | "restricted" | "rate_limited" | "unknown";
  retryUntil?: number;
  errorCode?: string;
} {
  if (!(error instanceof RequestError)) {
    return { outcome: "unknown" };
  }
  if (error.kind !== "http") {
    // network / timeout / cancelled / invalid-response: 不确认服务端是否已轮换 Cookie。
    return { outcome: "unknown" };
  }
  if (error.statusCode === 403 && error.code === "ACCOUNT_RESTRICTED") {
    return { outcome: "restricted", errorCode: error.code };
  }
  if (error.statusCode === 401 || error.statusCode === 403) {
    return { outcome: "failed", errorCode: error.code ?? undefined };
  }
  if (error.statusCode === 429) {
    const rawSec = error.details?.retryAfterSeconds;
    const waitMs =
      typeof rawSec === "number" && Number.isFinite(rawSec) && rawSec > 0
        ? rawSec * 1000
        : 30_000;
    return {
      outcome: "rate_limited",
      retryUntil: now + waitMs,
      errorCode: error.code ?? undefined,
    };
  }
  return { outcome: "unknown", errorCode: error.code ?? undefined };
}

export function createH5TabSync(
  handlers: H5TabSyncHandlers,
  overrides: H5TabSyncEnv = {},
) {
  const defaults = resolveDefaultEnv();
  const isSecureContext = overrides.isSecureContext ?? defaults.isSecureContext;
  const locks = "locks" in overrides ? overrides.locks : defaults.locks;
  const createChannel =
    "createChannel" in overrides
      ? overrides.createChannel
      : defaults.createChannel;
  const coordStorage = overrides.coordStorage ?? defaults.coordStorage;
  const now = overrides.now ?? defaults.now;
  const graceMs = overrides.graceMs ?? defaults.graceMs;
  const logoutLockTimeoutMs =
    overrides.logoutLockTimeoutMs ?? defaults.logoutLockTimeoutMs;
  const tabId = overrides.tabId ?? defaultTabId();

  let channel: H5BroadcastChannelLike | null = null;
  let channelBroken = false;
  if (isSecureContext && locks && createChannel) {
    try {
      channel = createChannel(H5_CHANNEL_NAME);
    } catch {
      channel = null;
      channelBroken = true;
    }
  }

  const supported = Boolean(
    isSecureContext && locks && channel && !channelBroken,
  );

  const initialCoord = coordStorage.read();
  let lastSeenSeq = initialCoord?.seq ?? 0;
  let lastLogoutSeq = initialCoord?.logoutSeq ?? 0;

  const receivedResults = new Map<string, H5SyncMessage>();
  const roundWaiters = new Map<string, Array<(msg: H5SyncMessage) => void>>();

  function resolveRoundWaiters(roundId: string, msg: H5SyncMessage) {
    const list = roundWaiters.get(roundId);
    if (!list) return;
    roundWaiters.delete(roundId);
    for (const notify of list) notify(msg);
  }

  function rejectAllWaitersAsLogout() {
    const msg: H5SyncMessage = {
      kind: "logout",
      seq: lastLogoutSeq,
      senderTabId: tabId,
    };
    for (const [roundId, list] of roundWaiters.entries()) {
      roundWaiters.delete(roundId);
      for (const notify of list) notify(msg);
    }
  }

  function nextSeq(base?: number): number {
    const stored = coordStorage.read()?.seq ?? 0;
    const seq = Math.max(lastSeenSeq, lastLogoutSeq, stored, base ?? 0) + 1;
    lastSeenSeq = seq;
    return seq;
  }

  function post(msg: H5SyncMessage) {
    try {
      channel?.postMessage(msg);
    } catch {
      /* 广播失败不影响本标签页状态。 */
    }
  }

  if (channel) {
    channel.onmessage = (event) => {
      const msg = event?.data;
      if (!isMessage(msg) || msg.senderTabId === tabId) return;
      if (msg.kind === "logout") {
        if (msg.seq <= lastLogoutSeq) return;
        lastLogoutSeq = msg.seq;
        lastSeenSeq = Math.max(lastSeenSeq, msg.seq);
        rejectAllWaitersAsLogout();
        handlers.onRemoteLogout();
        return;
      }
      // 退出之后的旧刷新/旧登录广播一律丢弃，绝不复活会话。
      if (msg.seq <= lastLogoutSeq) return;
      if (msg.kind === "refresh-result") {
        receivedResults.set(msg.roundId, msg);
        resolveRoundWaiters(msg.roundId, msg);
      }
      if (msg.seq <= lastSeenSeq) return;
      lastSeenSeq = msg.seq;
      if (msg.kind === "login-succeeded") {
        handlers.onRemoteLogin(msg.credential);
        return;
      }
      if (msg.outcome === "succeeded") {
        handlers.onRemoteRefresh(msg.credential);
      } else if (msg.outcome === "failed" || msg.outcome === "restricted") {
        handlers.onRemoteInvalidated(msg.outcome, msg.errorCode);
      }
    };
  }

  function waitForRoundResult(roundId: string): Promise<H5SyncMessage | null> {
    const existing = receivedResults.get(roundId);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const list = roundWaiters.get(roundId);
        if (list) {
          const next = list.filter((fn) => fn !== onDone);
          if (next.length > 0) roundWaiters.set(roundId, next);
          else roundWaiters.delete(roundId);
        }
        resolve(receivedResults.get(roundId) ?? null);
      }, graceMs);
      const onDone = (msg: H5SyncMessage) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(msg);
      };
      const list = roundWaiters.get(roundId) ?? [];
      list.push(onDone);
      roundWaiters.set(roundId, list);
    });
  }

  async function coordinateRefresh(
    runRefresh: () => Promise<H5CredentialResponse>,
    options: {
      reason: "restore" | "retry";
      failedAccessToken?: string | null;
    },
  ): Promise<CoordinateRefreshResult> {
    if (!supported || !locks) {
      return { kind: "unsupported" };
    }
    // 401 重试前若已通过同源广播收到更新的访问凭据，直接复用，不再申请锁或发请求。
    const preToken = handlers.currentAccessToken();
    if (
      options.reason === "retry" &&
      options.failedAccessToken &&
      preToken !== null &&
      preToken !== options.failedAccessToken
    ) {
      return { kind: "adopted", credential: null };
    }

    const waitStart = coordStorage.read();
    const waitStartSeq = waitStart?.seq ?? lastSeenSeq;
    const waitStartLogoutSeq = Math.max(
      lastLogoutSeq,
      waitStart?.logoutSeq ?? 0,
    );

    if (options.reason === "restore" && waitStart) {
      if (waitStart.status === "logged_out") return { kind: "logged-out" };
      if (waitStart.status === "restricted") return { kind: "restricted" };
      if (waitStart.status === "failed") return { kind: "failed" };
      if (waitStart.status === "unknown") return { kind: "unknown" };
      if (
        waitStart.status === "rate_limited" &&
        waitStart.retryUntil !== undefined &&
        now() < waitStart.retryUntil
      ) {
        return { kind: "rate-limited", retryUntil: waitStart.retryUntil };
      }
    }

    return locks.request(H5_LOCK_NAME, async () => {
      const current = coordStorage.read();
      const effectiveLogoutSeq = Math.max(
        lastLogoutSeq,
        current?.logoutSeq ?? 0,
      );
      if (
        effectiveLogoutSeq > waitStartLogoutSeq ||
        current?.status === "logged_out"
      ) {
        return { kind: "logged-out" };
      }

      const tokenNow = handlers.currentAccessToken();
      if (
        options.reason === "retry" &&
        options.failedAccessToken &&
        tokenNow !== null &&
        tokenNow !== options.failedAccessToken
      ) {
        return { kind: "adopted", credential: null };
      }

      if (current && current.seq > waitStartSeq) {
        if (current.status === "succeeded") {
          const msg = await waitForRoundResult(current.roundId);
          if (lastLogoutSeq > effectiveLogoutSeq) {
            return { kind: "logged-out" };
          }
          if (
            msg &&
            msg.kind === "refresh-result" &&
            msg.outcome === "succeeded" &&
            msg.seq > effectiveLogoutSeq
          ) {
            return { kind: "adopted", credential: msg.credential };
          }
          // 锁已释放且有成功记录，但等待广播超时或发送者异常退出：状态不明，阻止二次补发。
          coordStorage.write({
            seq: nextSeq(current.seq),
            roundId: current.roundId,
            status: "unknown",
            ownerTabId: tabId,
            logoutSeq: effectiveLogoutSeq,
            updatedAt: now(),
          });
          return { kind: "unknown" };
        }
        if (current.status === "failed") return { kind: "failed" };
        if (current.status === "restricted") return { kind: "restricted" };
        if (current.status === "unknown") return { kind: "unknown" };
        if (current.status === "rate_limited") {
          return { kind: "rate-limited", retryUntil: current.retryUntil };
        }
      }

      // 进入独占锁时发现上一位持有者状态仍停留在 running：说明领先页在刷新途中关闭或崩溃。
      if (
        current &&
        current.status === "running" &&
        current.ownerTabId !== tabId
      ) {
        const seq = nextSeq(current.seq);
        coordStorage.write({
          seq,
          roundId: current.roundId,
          status: "unknown",
          ownerTabId: tabId,
          logoutSeq: effectiveLogoutSeq,
          updatedAt: now(),
        });
        post({
          kind: "refresh-result",
          seq,
          roundId: current.roundId,
          senderTabId: tabId,
          outcome: "unknown",
        });
        return { kind: "unknown" };
      }

      if (current?.status === "unknown") {
        return { kind: "unknown" };
      }

      const roundId = defaultRoundId();
      const startSeq = nextSeq(current?.seq ?? waitStartSeq);
      coordStorage.write({
        seq: startSeq,
        roundId,
        status: "running",
        ownerTabId: tabId,
        logoutSeq: effectiveLogoutSeq,
        updatedAt: now(),
      });

      try {
        const credential = await runRefresh();
        if (lastLogoutSeq > effectiveLogoutSeq) {
          return { kind: "logged-out" };
        }
        const doneSeq = nextSeq(startSeq);
        coordStorage.write({
          seq: doneSeq,
          roundId,
          status: "succeeded",
          ownerTabId: tabId,
          logoutSeq: effectiveLogoutSeq,
          updatedAt: now(),
        });
        post({
          kind: "refresh-result",
          seq: doneSeq,
          roundId,
          senderTabId: tabId,
          outcome: "succeeded",
          credential,
        });
        return { kind: "refreshed", credential };
      } catch (error) {
        if (lastLogoutSeq > effectiveLogoutSeq) {
          return { kind: "logged-out" };
        }
        const classified = classifyRefreshError(error, now());
        const doneSeq = nextSeq(startSeq);
        coordStorage.write({
          seq: doneSeq,
          roundId,
          status: classified.outcome,
          ownerTabId: tabId,
          logoutSeq: effectiveLogoutSeq,
          updatedAt: now(),
          ...(classified.retryUntil !== undefined
            ? { retryUntil: classified.retryUntil }
            : {}),
        });
        post({
          kind: "refresh-result",
          seq: doneSeq,
          roundId,
          senderTabId: tabId,
          outcome: classified.outcome,
          ...(classified.retryUntil !== undefined
            ? { retryUntil: classified.retryUntil }
            : {}),
          ...(classified.errorCode !== undefined
            ? { errorCode: classified.errorCode }
            : {}),
        });
        if (classified.outcome === "restricted")
          return { kind: "restricted", error };
        if (classified.outcome === "rate_limited")
          return {
            kind: "rate-limited",
            retryUntil: classified.retryUntil,
            error,
          };
        if (classified.outcome === "failed") return { kind: "failed", error };
        return { kind: "unknown", error };
      }
    });
  }

  function notifyLogin(credential: H5CredentialResponse) {
    const seq = nextSeq();
    const roundId = defaultRoundId();
    coordStorage.write({
      seq,
      roundId,
      status: "succeeded",
      ownerTabId: tabId,
      logoutSeq: lastLogoutSeq,
      updatedAt: now(),
    });
    if (supported) {
      post({
        kind: "login-succeeded",
        seq,
        roundId,
        senderTabId: tabId,
        credential,
      });
    }
  }

  async function coordinateLogout<T>(runLogout: () => Promise<T>): Promise<T> {
    const seq = nextSeq();
    lastLogoutSeq = seq;
    rejectAllWaitersAsLogout();
    coordStorage.write({
      seq,
      roundId: defaultRoundId(),
      status: "logged_out",
      ownerTabId: tabId,
      logoutSeq: seq,
      updatedAt: now(),
    });
    if (supported) {
      post({ kind: "logout", seq, senderTabId: tabId });
    }
    if (!supported || !locks) {
      return runLogout();
    }
    // 用锁串行化到任何在途刷新之后发登出，确保携带浏览器最新 Cookie；同时设置超时兜底避免锁挂死。
    let ran = false;
    let ranInsideLock = false;
    let lockFinished = false;
    return new Promise<T>((resolve, reject) => {
      const execute = () => {
        if (ran) return;
        ran = true;
        runLogout().then(resolve, reject);
      };
      const timer = setTimeout(() => {
        if (!lockFinished) execute();
      }, logoutLockTimeoutMs);
      locks
        .request(H5_LOCK_NAME, async () => {
          lockFinished = true;
          clearTimeout(timer);
          if (!ran) {
            ran = true;
            ranInsideLock = true;
            return runLogout();
          }
          return undefined as unknown as T;
        })
        .then(
          (value) => {
            clearTimeout(timer);
            if (ranInsideLock) resolve(value);
          },
          (err) => {
            clearTimeout(timer);
            if (!ran) execute();
            else if (ranInsideLock) reject(err);
          },
        );
    });
  }

  function dispose() {
    rejectAllWaitersAsLogout();
    try {
      channel?.close();
    } catch {
      /* ignore */
    }
  }

  return {
    isSupported: () => supported,
    tabId,
    coordinateRefresh,
    notifyLogin,
    coordinateLogout,
    dispose,
  };
}
