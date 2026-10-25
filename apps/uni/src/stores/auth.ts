import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";
import { CURRENT_CONSENT_VERSION } from "../api/auth-client.ts";
import { authApi } from "../api/auth.ts";
import { bindAuthSession } from "../api/client.ts";
import { RequestError } from "../api/http.ts";
import {
  authFailureMessage,
  createAuthSession,
  initialAuthState,
  nicknameProblem,
} from "../auth/auth-session.ts";
import { platformAuthStorage } from "../auth/platform-storage.ts";
import { WechatCodeError, requestWechatCode } from "../auth/wechat-login.ts";

/**
 * 平台认证状态（Pinia 外壳）。
 *
 * 与业务演示会话完全独立：这里只保存真实账号、凭据与可用能力，
 * 演示学籍、联系方式与队伍记录不会写入，也不从演示会话推断身份。
 * 页面只读这里的 user/campus/availability 与 pending 状态。
 */
export const useAuthStore = defineStore("platform-auth", () => {
  const state = reactive(initialAuthState());
  const session = createAuthSession(state, authApi, platformAuthStorage());
  // 认证客户端只读取这里的能力：页面与演示 store 都不直接拼接凭据。
  bindAuthSession({
    accessToken: session.accessToken,
    refresh: session.refresh,
  });

  /** 平台协议/隐私告知版本；服务端要求更新时以 details.currentVersion 为准。 */
  const consentVersion = ref(CURRENT_CONSENT_VERSION);
  const consentOutdated = ref(false);
  const loginPending = ref(false);
  const loginError = ref("");
  const logoutPending = ref(false);
  const logoutNotice = ref("");
  const nicknamePending = ref(false);
  const nicknameError = ref("");

  const authenticated = computed(() => state.phase === "authenticated");
  const restoring = computed(() => state.phase === "authenticating");
  const nickname = computed(() => state.user?.nickname ?? "");
  const accountStatus = computed(() => state.user?.status ?? null);
  const campusStatus = computed(() => state.campus?.status ?? null);
  const teamingAvailable = computed(() => state.availability?.teaming === true);

  /** 用户重新确认协议后调用，清除“协议已更新”提示。 */
  function acknowledgeConsent() {
    consentOutdated.value = false;
  }

  async function login(): Promise<void> {
    if (loginPending.value) return;
    loginPending.value = true;
    loginError.value = "";
    logoutNotice.value = "";
    try {
      const code = await requestWechatCode();
      await session.login(code, consentVersion.value);
    } catch (error) {
      if (error instanceof WechatCodeError) {
        loginError.value = error.message;
        return;
      }
      if (
        error instanceof RequestError &&
        error.code === "CONSENT_VERSION_MISMATCH"
      ) {
        const current = error.details?.currentVersion;
        if (typeof current === "number" && Number.isFinite(current)) {
          consentVersion.value = current;
          consentOutdated.value = true;
        }
      }
      loginError.value = authFailureMessage(error, "登录未完成，请稍后重试。");
    } finally {
      loginPending.value = false;
    }
  }

  /** 冷启动恢复：只在持有刷新凭据时尝试，失败即要求重新微信登录。 */
  async function restore(): Promise<void> {
    await session.restore();
  }

  async function logout(): Promise<void> {
    if (logoutPending.value) return;
    logoutPending.value = true;
    logoutNotice.value = "";
    nicknameError.value = "";
    try {
      const result = await session.logout();
      logoutNotice.value = result.message;
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
    consentVersion,
    consentOutdated,
    loginPending,
    loginError,
    logoutPending,
    logoutNotice,
    nicknamePending,
    nicknameError,
    acknowledgeConsent,
    login,
    restore,
    logout,
    updateNickname,
    expireIfNeeded,
    hasStoredSession: () => session.hasStoredSession(),
  };
});
