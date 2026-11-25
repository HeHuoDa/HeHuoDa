import type {
  CredentialResponse,
  H5CredentialResponse,
} from "@hehuoda/api-types";
import { defineStore } from "pinia";
import { computed, reactive, ref, watch } from "vue";
import { authApi } from "../api/auth.ts";
import { bindAuthSession } from "../api/client.ts";
import {
  authFailureMessage,
  createAuthSession,
  initialAuthState,
  nicknameProblem,
} from "../auth/auth-session.ts";
import { platformAuthStorage } from "../auth/platform-storage.ts";
import { useSessionStore } from "./session.ts";

const platformFlags = { h5: false };
// #ifdef H5
platformFlags.h5 = true;
// #endif

function isH5Runtime(): boolean {
  try {
    const name = (
      uni.getSystemInfoSync() as { uniPlatform?: unknown } | undefined
    )?.uniPlatform;
    if (typeof name === "string" && name && name !== "web") return false;
  } catch {
    /* 忽略未注入 uni 的测试环境 */
  }
  return platformFlags.h5;
}

/**
 * 平台认证状态（Pinia 外壳）。
 *
 * 与业务演示会话完全独立：这里只保存真实账号、内存访问凭据与可用能力，
 * 校园密码、验证码、事务持有凭据与演示学籍都不会写入；退出或 401 时不清空临时收藏。
 */
export const useAuthStore = defineStore("platform-auth", () => {
  const h5 = isH5Runtime();
  const state = reactive(initialAuthState());
  const session = createAuthSession(
    state,
    authApi,
    platformAuthStorage(),
    Date.now,
    { h5 },
  );
  // 认证客户端只读取这里的能力：页面与演示 store 都不直接拼接凭据。
  bindAuthSession({
    accessToken: session.accessToken,
    refresh: session.refresh,
    generation: () => state.generation,
  });

  const logoutPending = ref(false);
  const logoutNotice = ref("");
  const logoutRemoteUnconfirmed = ref(false);
  const nicknamePending = ref(false);
  const nicknameError = ref("");

  const authenticated = computed(() => state.phase === "authenticated");
  const restoring = computed(() => state.phase === "authenticating");
  const nickname = computed(() => state.user?.nickname ?? "");
  const accountStatus = computed(() => state.user?.status ?? null);
  const campusStatus = computed(() => state.campus?.status ?? null);
  const teamingAvailable = computed(() => state.availability?.teaming === true);

  // 真实昵称同步给业务会话：不触碰临时收藏。
  const business = useSessionStore();
  watch(
    () => state.user?.nickname ?? null,
    (value) => business.setAccountNickname(value),
    { immediate: true },
  );

  async function applySchoolLogin(
    credentials: CredentialResponse | H5CredentialResponse,
  ): Promise<void> {
    logoutNotice.value = "";
    logoutRemoteUnconfirmed.value = false;
    nicknameError.value = "";
    await session.applySchoolLogin(credentials);
  }

  /** 冷启动恢复：H5 经多标签协调尝试静默 Cookie 恢复；失败平滑回到游客，不清空收藏。 */
  async function restore(): Promise<void> {
    await session.restore();
    if (state.phase === "authenticated") {
      logoutNotice.value = "";
      logoutRemoteUnconfirmed.value = false;
    }
  }

  async function logout(): Promise<void> {
    if (logoutPending.value) return;
    const wasAuthenticated = state.phase === "authenticated";
    logoutPending.value = true;
    logoutNotice.value = "";
    logoutRemoteUnconfirmed.value = false;
    nicknameError.value = "";
    try {
      const result = await session.logout();
      logoutNotice.value = result.message;
      logoutRemoteUnconfirmed.value =
        h5 && wasAuthenticated && !result.remoteRevoked;
    } finally {
      logoutPending.value = false;
    }
  }

  async function retryLogout(): Promise<void> {
    if (logoutPending.value) return;
    logoutPending.value = true;
    try {
      const result = await session.retryRemoteLogout();
      logoutNotice.value = result.message;
      logoutRemoteUnconfirmed.value = h5 && !result.remoteRevoked;
    } finally {
      logoutPending.value = false;
    }
  }

  async function updateNickname(raw: string): Promise<boolean> {
    if (nicknamePending.value) return false;
    nicknameError.value = "";
    const problem = nicknameProblem(raw);
    if (problem) {
      nicknameError.value = problem;
      return false;
    }
    nicknamePending.value = true;
    try {
      await session.updateNickname(raw);
      return true;
    } catch (error) {
      nicknameError.value = authFailureMessage(
        error,
        "昵称未更新，请稍后重试。",
      );
      return false;
    } finally {
      nicknamePending.value = false;
    }
  }

  /** 回到前台或冷启动后检查本地会话绝对到期时间。 */
  function expireIfNeeded(): boolean {
    return session.expireIfNeeded();
  }

  return {
    phase: computed(() => state.phase),
    user: computed(() => state.user),
    campus: computed(() => state.campus),
    availability: computed(() => state.availability),
    sessionExpiresAt: computed(() => state.sessionExpiresAt),
    generation: computed(() => state.generation),
    errorMessage: computed(() => state.errorMessage),
    profileError: computed(() => state.profileError),
    authenticated,
    restoring,
    nickname,
    accountStatus,
    campusStatus,
    teamingAvailable,
    logoutPending,
    logoutNotice,
    logoutRemoteUnconfirmed,
    nicknamePending,
    nicknameError,
    applySchoolLogin,
    restore,
    reloadProfile: session.reloadProfile,
    logout,
    retryLogout,
    updateNickname,
    expireIfNeeded,
    hasStoredSession: () => session.hasStoredSession(),
  };
});
