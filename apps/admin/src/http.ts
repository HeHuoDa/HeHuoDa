import { shallowReactive } from "vue";
import type { components } from "@hehuoda/api-types";
import { ConsoleError } from "./console/resource";

export type Schema = components["schemas"];
export function safeReturn(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\r\n]/.test(value)
  )
    return "/";
  const url = new URL(value, window.location.origin);
  return url.origin === window.location.origin && url.pathname !== "/login"
    ? url.pathname + url.search + url.hash
    : "/";
}
export function createAdminHttp(onIdentityChange = () => {}) {
  const state = shallowReactive({
    session: null as Schema["AdminSessionDto"] | null,
    ready: false,
    generation: 0,
    writing: 0,
    loggingOut: false,
  });
  const pending = new Set<AbortController>();
  let csrf = "";
  let onUnauthorized = () => {};
  function clear() {
    state.generation++;
    state.session = null;
    csrf = "";
    sessionStorage.removeItem("hh-admin-ingestion");
    for (const controller of pending) controller.abort();
    pending.clear();
  }
  function invalidate() {
    clear();
    state.ready = true;
    onUnauthorized();
  }
  async function request<T>(
    path: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const generation = state.generation;
    const controller = new AbortController();
    pending.add(controller);
    const timeout = setTimeout(() => controller.abort(), 20000);
    const writing =
      !!options.method &&
      options.method !== "GET" &&
      !path.startsWith("/auth/");
    if (writing) state.writing++;
    try {
      const method = options.method ?? "GET";
      if (state.loggingOut && method !== "GET" && path !== "/auth/logout")
        throw new ConsoleError(409, "退出处理中，不能开始新的写操作。");
      if (
        method !== "GET" &&
        !["/auth/login", "/auth/logout"].includes(path) &&
        !csrf
      )
        throw new ConsoleError(401, "请重新登录");
      const response = await fetch("/api/v1/admin" + path, {
        method,
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(options.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
          ...(method !== "GET" && csrf ? { "X-CSRF-Token": csrf } : {}),
        },
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
      });
      if (generation !== state.generation)
        throw new DOMException("会话已改变", "AbortError");
      const responseAdmin = response.headers.get("X-Admin-Id");
      if (
        state.session &&
        responseAdmin &&
        responseAdmin !== state.session.id &&
        path !== "/auth/login"
      ) {
        invalidate();
        throw new ConsoleError(401, "管理员身份已切换，请重新登录。");
      }
      if (!response.ok) {
        if (response.status === 401 && path !== "/auth/login") {
          clear();
          state.ready = true;
          onUnauthorized();
        }
        throw new ConsoleError(
          response.status,
          response.status === 401
            ? "会话已失效，请重新登录。"
            : "管理请求失败，请核对后重试。",
        );
      }
      const value = response.status === 204 ? undefined : await response.json();
      if (generation !== state.generation)
        throw new DOMException("会话已改变", "AbortError");
      return value as T;
    } finally {
      clearTimeout(timeout);
      if (writing) state.writing--;
      pending.delete(controller);
    }
  }
  async function restore() {
    const generation = state.generation;
    try {
      const session = await request<Schema["AdminSessionDto"]>("/auth/session");
      const token = await request<Schema["AdminCsrfDto"]>("/auth/csrf");
      if (generation !== state.generation) return;
      if (token.adminId !== session.id) {
        clear();
        throw new ConsoleError(409, "管理员身份已切换，请重新登录。");
      }
      csrf = token.csrfToken;
      state.session = session;
      state.ready = true;
    } catch (error) {
      if (!(error instanceof ConsoleError && error.status === 401)) throw error;
      state.ready = true;
    }
  }
  async function login(username: string, password: string) {
    if (state.loggingOut)
      throw new ConsoleError(409, "退出处理中，请稍后登录。");
    onIdentityChange();
    clear();
    await request<Schema["AdminSessionDto"]>("/auth/login", {
      method: "POST",
      body: { username, password } satisfies Schema["AdminLoginDto"],
    });
    await restore();
    if (!state.session)
      throw new ConsoleError(401, "未能恢复有效会话，请重新登录。");
  }
  async function logout() {
    if (state.loggingOut) throw new ConsoleError(409, "退出处理中。");
    try {
      const value = JSON.parse(
        sessionStorage.getItem("hh-admin-ingestion") ?? "null",
      );
      if (
        !value ||
        value.actor !== state.session?.id ||
        typeof value.body?.operationId !== "string"
      )
        sessionStorage.removeItem("hh-admin-ingestion");
    } catch {
      sessionStorage.removeItem("hh-admin-ingestion");
    }
    if (state.writing || sessionStorage.getItem("hh-admin-ingestion"))
      throw new ConsoleError(
        409,
        "仍有提交中或未确认受理的操作，请先核验再退出。",
      );
    state.loggingOut = true;
    onIdentityChange();
    try {
      if (!csrf) await restore();
      await request("/auth/logout", { method: "POST" });
    } finally {
      clear();
      state.loggingOut = false;
      state.ready = true;
      onUnauthorized();
    }
  }
  return {
    state,
    request,
    restore,
    login,
    logout,
    clear,
    invalidate,
    onUnauthorized(callback: () => void) {
      onUnauthorized = callback;
    },
  };
}
export type AdminHttp = ReturnType<typeof createAdminHttp>;
