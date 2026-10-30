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
export function createAdminHttp() {
  const state = shallowReactive({
    session: null as Schema["AdminSessionDto"] | null,
    ready: false,
    generation: 0,
  });
  const pending = new Set<AbortController>();
  let csrf = "";
  let onUnauthorized = () => {};
  function clear() {
    state.generation++;
    state.session = null;
    csrf = "";
    for (const controller of pending) controller.abort();
    pending.clear();
  }
  async function request<T>(
    path: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const generation = state.generation;
    const controller = new AbortController();
    pending.add(controller);
    try {
      const method = options.method ?? "GET";
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
      pending.delete(controller);
    }
  }
  async function restore() {
    const generation = state.generation;
    try {
      const session = await request<Schema["AdminSessionDto"]>("/auth/session");
      const token = await request<Schema["AdminCsrfDto"]>("/auth/csrf");
      if (generation !== state.generation) return;
      csrf = token.csrfToken;
      state.session = session;
      state.ready = true;
    } catch (error) {
      if (!(error instanceof ConsoleError && error.status === 401)) throw error;
      state.ready = true;
    }
  }
  async function login(username: string, password: string) {
    clear();
    await request<Schema["AdminSessionDto"]>("/auth/login", {
      method: "POST",
      body: { username, password } satisfies Schema["AdminLoginDto"],
    });
    await restore();
  }
  async function logout() {
    try {
      await request("/auth/logout", { method: "POST" });
    } finally {
      clear();
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
    onUnauthorized(callback: () => void) {
      onUnauthorized = callback;
    },
  };
}
export type AdminHttp = ReturnType<typeof createAdminHttp>;
