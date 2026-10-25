import type {
  Availability,
  CampusStatus,
  CredentialResponse,
  ProfileResponse,
  UserAccount,
} from "@hehuoda/api-types";
import { RequestError, type PendingRequest } from "../api/http.ts";

/**
 * 平台认证会话。
 *
 * 只负责“这是哪个平台账号”：
 * - 访问凭据仅存内存，刷新凭据只在平台分支写入存储；两者都不进 URL、日志或演示数据。
 * - 刷新凭据每次使用即轮换，并发刷新会触发服务端重放撤销，因此这里做单飞。
 * - 登录成功、退出、账号受限、会话到期与冷启动恢复都提升认证代次，
 *   旧代次的迟到回调不得写回状态。
 * 账号与校园状态只来自服务端响应，不采信本地缓存或演示会话。
 */

/** 认证接口只依赖本票使用的五个动作，页面测试与平台替身共用同一形状。 */
export interface AuthApi {
  wechatLogin(
    code: string,
    consentVersion: number,
  ): PendingRequest<CredentialResponse>;
  refresh(refreshToken: string): PendingRequest<CredentialResponse>;
  logout(): PendingRequest<unknown>;
  profile(): PendingRequest<ProfileResponse>;
  updateNickname(nickname: string): PendingRequest<ProfileResponse>;
}

/** 刷新凭据存储：小程序写入平台存储，H5 使用空实现，不落任何凭据。 */
export interface AuthStorage {
  read(): string | null;
  write(value: string): void;
  clear(): void;
}

export type AuthPhase =
  "idle" | "authenticating" | "authenticated" | "anonymous";

export interface AuthState {
  phase: AuthPhase;
  user: UserAccount | null;
  campus: CampusStatus | null;
  availability: Availability | null;
  /** 会话绝对到期时间，由后端下发；刷新不会延长。 */
  sessionExpiresAt: string | null;
  /** 认证代次；页面据此丢弃旧账号的迟到结果。 */
  generation: number;
  /** 面向用户的失败说明；成功动作后清空。 */
  errorMessage: string | null;
  /** 已登录但资料读取失败时的说明；不影响登录态。 */
  profileError: string | null;
}

export function initialAuthState(): AuthState {
  return {
    phase: "idle",
    user: null,
    campus: null,
    availability: null,
    sessionExpiresAt: null,
    generation: 0,
    errorMessage: null,
    profileError: null,
  };
}

export interface LogoutResult {
  /** 远端会话是否已确认撤销；false 时必须如实说明状态不明。 */
  remoteRevoked: boolean;
  message: string;
}

export const NICKNAME_MAX = 20;
export const RELOGIN_MESSAGE = "登录状态已失效，请重新微信登录。";

/** 昵称只做 trim 与长度校验，与后端 NICKNAME_INVALID 规则一致。 */
export function nicknameProblem(raw: string): string | null {
  const nickname = raw.trim();
  if (!nickname) return "请填写昵称。";
  if (Array.from(nickname).length > NICKNAME_MAX)
    return `昵称最多 ${NICKNAME_MAX} 个字。`;
  return null;
}

function detailNumber(error: RequestError, key: string): number | null {
  const value = error.details?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 认证动作的统一安全反馈：只按状态码与公开错误码给文案，不回显原始 message。 */
export function authFailureMessage(
  error: unknown,
  fallback = "操作未完成，请稍后重试。",
): string {
  if (!(error instanceof RequestError)) {
    return error instanceof Error && error.message ? error.message : fallback;
  }
  if (error.kind === "cancelled") return "操作已取消。";
  if (error.kind === "timeout") return "网络超时，结果未确认，请稍后重试。";
  if (error.kind === "network") return "暂时无法连接服务，请稍后重试。";
  if (error.kind === "invalid-response") return "服务响应异常，请稍后重试。";
  switch (error.code) {
    case "WECHAT_LOGIN_UNAVAILABLE":
      return "微信登录暂未开放，当前可先浏览公开内容。";
    case "WECHAT_UPSTREAM_UNAVAILABLE":
      return "微信登录服务暂时不可用，请稍后重试。";
    case "WECHAT_CODE_INVALID":
      return "微信登录凭证已失效，请重新点击登录。";
    case "CONSENT_VERSION_MISMATCH":
      return "平台协议已更新，请重新确认后登录。";
    case "ACCOUNT_RESTRICTED":
      return "账号当前受限，无法继续操作。";
    case "NICKNAME_INVALID":
      return `昵称须为 1–${NICKNAME_MAX} 个字。`;
    case "REFRESH_TOKEN_REPLAY":
    case "INVALID_REFRESH_TOKEN":
      return RELOGIN_MESSAGE;
    case "TOO_MANY_REQUESTS": {
      const seconds = detailNumber(error, "retryAfterSeconds");
      return seconds === null
        ? "请求过于频繁，请稍后重试。"
        : `请求过于频繁，请 ${seconds} 秒后再试。`;
    }
  }
  if (error.statusCode === 401) return RELOGIN_MESSAGE;
  if (error.statusCode === 429) return "请求过于频繁，请稍后重试。";
  if (error.statusCode === 403) return "账号当前受限，无法继续操作。";
  if (error.statusCode !== null && error.statusCode >= 500)
    return "服务暂时不可用，请稍后重试。";
  return fallback;
}

export function createAuthSession(
  state: AuthState,
  api: AuthApi,
  storage: AuthStorage,
  now: () => number = Date.now,
) {
  let accessToken: string | null = null;
  let inflightRefresh: Promise<string> | null = null;
  let inflightProfile: PendingRequest<ProfileResponse> | null = null;

  /** 提升代次并取消旧账号的私人请求；不在此处改凭据，便于退出先发请求后清理。 */
  function advance(): number {
    state.generation += 1;
    inflightProfile?.cancel();
    inflightProfile = null;
    return state.generation;
  }

  function forgetCredentials() {
    accessToken = null;
    storage.clear();
    state.user = null;
    state.campus = null;
    state.availability = null;
    state.sessionExpiresAt = null;
  }

  function applyCredentials(credentials: CredentialResponse) {
    accessToken = credentials.accessToken;
    storage.write(credentials.refreshToken);
    state.user = credentials.user;
    state.sessionExpiresAt = credentials.sessionExpiresAt;
    state.phase = "authenticated";
    state.errorMessage = null;
  }

  function applyProfile(profile: ProfileResponse) {
    state.user = profile.user;
    state.campus = profile.campus;
    state.availability = profile.availability;
  }

  /** 凭据不可恢复：清本地并要求重新微信登录，不循环提交旧刷新凭据。 */
  function requireRelogin(message: string = RELOGIN_MESSAGE) {
    advance();
    forgetCredentials();
    state.phase = "anonymous";
    state.errorMessage = message;
    state.profileError = null;
  }

  function currentAccessToken(): string | null {
    return state.phase === "authenticated" ? accessToken : null;
  }

  /** 撤销请求可能因配置错误同步抛出，这里统一收敛为 null，不影响本地清理。 */
  function requestLogout(): PendingRequest<unknown> | null {
    try {
      return api.logout();
    } catch {
      return null;
    }
  }

  /** 读取真实账号资料；stale 表示代次已变，调用方必须丢弃结果。 */
  async function loadProfile(at: number): Promise<"ok" | "stale" | "failed"> {
    const pending = api.profile();
    inflightProfile = pending;
    try {
      const profile = await pending.promise;
      if (at !== state.generation) return "stale";
      applyProfile(profile);
      state.profileError = null;
      return "ok";
    } catch (error) {
      if (at !== state.generation) return "stale";
      // 401 凭据失效与 403 账号受限都必须清理，不能继续显示旧账号。
      if (
        error instanceof RequestError &&
        (error.statusCode === 401 || error.statusCode === 403)
      ) {
        requireRelogin(authFailureMessage(error));
        return "failed";
      }
      state.profileError = authFailureMessage(error, "账号资料读取失败。");
      return "failed";
    } finally {
      if (inflightProfile === pending) inflightProfile = null;
    }
  }

  /**
   * 用存储中的刷新凭据换取新访问凭据。
   * 并发调用共享同一次请求：刷新凭据轮换后重复提交会被服务端判定重放并撤销会话。
   */
  function refresh(): Promise<string> {
    if (inflightRefresh) return inflightRefresh;
    const refreshToken = storage.read();
    if (!refreshToken) {
      requireRelogin();
      return Promise.reject(
        new RequestError("http", RELOGIN_MESSAGE, {
          statusCode: 401,
          code: "INVALID_REFRESH_TOKEN",
        }),
      );
    }
    const at = state.generation;
    inflightRefresh = (async () => {
      try {
        const credentials = await api.refresh(refreshToken).promise;
        if (at !== state.generation)
          throw new RequestError(
            "cancelled",
            "登录状态已变化，已丢弃过期结果。",
          );
        applyCredentials(credentials);
        return credentials.accessToken;
      } catch (error) {
        // 结果不明或旧凭据已消费：一律清理并要求重新登录，不重试旧凭据。
        if (at === state.generation) requireRelogin(authFailureMessage(error));
        throw error;
      } finally {
        inflightRefresh = null;
      }
    })();
    return inflightRefresh;
  }

  async function login(code: string, consentVersion: number): Promise<void> {
    if (!code.trim()) throw new Error("未能取得微信登录凭证，请重试。");
    // 新登录先提升代次并清空旧凭据：旧账号的迟到响应不能写进新账号。
    const at = advance();
    forgetCredentials();
    state.phase = "authenticating";
    state.errorMessage = null;
    state.profileError = null;
    try {
      const credentials = await api.wechatLogin(code, consentVersion).promise;
      if (at !== state.generation)
        throw new RequestError("cancelled", "登录状态已变化，已丢弃过期结果。");
      applyCredentials(credentials);
      const outcome = await loadProfile(at);
      if (outcome === "stale")
        throw new RequestError("cancelled", "登录状态已变化，已丢弃过期结果。");
    } catch (error) {
      if (at === state.generation) {
        state.phase = "anonymous";
        state.errorMessage = authFailureMessage(error);
      }
      throw error;
    }
  }

  /** 冷启动：只持有刷新凭据恢复会话，绝不持久化 code、访问凭据或学校凭据。 */
  async function restore(): Promise<void> {
    if (state.phase === "authenticating") return;
    if (!storage.read()) {
      state.phase = "anonymous";
      return;
    }
    state.phase = "authenticating";
    state.errorMessage = null;
    try {
      await refresh();
      // refresh 成功会把会话置为 authenticated；失败则已清理凭据。
      if (currentAccessToken() !== null) await loadProfile(state.generation);
    } catch {
      // refresh 已清理本地凭据并给出说明；冷启动不额外弹错。
      if (state.phase === "authenticating") state.phase = "anonymous";
    }
  }

  /** 退出：无论远端是否确认，本地凭据与资料都会清除，并如实返回远端状态。 */
  async function logout(): Promise<LogoutResult> {
    if (state.phase !== "authenticated" || !accessToken) {
      advance();
      forgetCredentials();
      state.phase = "anonymous";
      state.errorMessage = null;
      state.profileError = null;
      return { remoteRevoked: false, message: "当前未登录，无需退出。" };
    }
    // 先提升代次，让旧账号的迟到响应失效；请求在清理前同步发出以携带当前凭据。
    advance();
    const pending = requestLogout();
    forgetCredentials();
    state.phase = "anonymous";
    state.errorMessage = null;
    state.profileError = null;
    if (!pending)
      return {
        remoteRevoked: false,
        message: "已清除本地凭据，但未能发出撤销请求，远端会话状态不明。",
      };
    try {
      await pending.promise;
      return { remoteRevoked: true, message: "已退出登录，本地凭据已清除。" };
    } catch {
      return {
        remoteRevoked: false,
        message:
          "已清除本地凭据，但远端会话未能确认撤销；如需彻底撤销，请稍后重新登录后再退出。",
      };
    }
  }

  async function updateNickname(raw: string): Promise<void> {
    const problem = nicknameProblem(raw);
    if (problem) throw new Error(problem);
    const at = state.generation;
    try {
      const profile = await api.updateNickname(raw.trim()).promise;
      if (at !== state.generation)
        throw new RequestError("cancelled", "登录状态已变化，昵称未更新。");
      applyProfile(profile);
    } catch (error) {
      if (at !== state.generation)
        throw new RequestError("cancelled", "登录状态已变化，昵称未更新。");
      if (
        error instanceof RequestError &&
        (error.statusCode === 401 || error.statusCode === 403)
      )
        requireRelogin(authFailureMessage(error));
      throw error;
    }
  }

  /** 本地会话到期检查：绝对有效期由后端决定，到期即清凭据并要求重新登录。 */
  function expireIfNeeded(current: number = now()): boolean {
    if (state.phase !== "authenticated" || !state.sessionExpiresAt)
      return false;
    const expires = Date.parse(state.sessionExpiresAt);
    if (!Number.isFinite(expires) || expires > current) return false;
    requireRelogin("登录已过期，请重新微信登录。");
    return true;
  }

  return {
    accessToken: currentAccessToken,
    reloadProfile: () =>
      state.phase === "authenticated"
        ? loadProfile(state.generation)
        : Promise.resolve("failed" as const),
    refresh,
    login,
    restore,
    logout,
    updateNickname,
    expireIfNeeded,
    hasStoredSession: () => storage.read() !== null,
    isAuthenticated: () => state.phase === "authenticated",
  };
}
