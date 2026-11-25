<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, watch } from "vue";
import { authApi } from "../api/auth";
import {
  createSchoolLoginController,
  initialSchoolLoginState,
} from "../auth/school-login";
import { backOrHome, openTab, replacePage } from "../navigation/navigate";
import { resolveReturnTarget } from "../navigation/return-target";
import { useAuthStore } from "../stores/auth";
import FormButton from "./FormButton.vue";
import FormInput from "./FormInput.vue";

const props = withDefaults(
  defineProps<{
    returnTo?: string;
    entry?: "login" | "register" | "campus";
  }>(),
  {
    returnTo: "",
    entry: "login",
  },
);

const auth = useAuthStore();
const state = reactive(initialSchoolLoginState());
const controller = createSchoolLoginController(state, authApi, {
  generation: () => auth.generation,
  onAuthenticated: async (credential) => {
    await auth.applySchoolLogin(credential);
  },
});

const copy = computed(() => {
  if (props.entry === "register") {
    return {
      eyebrow: "SICAU SIGN IN",
      heading: "统一身份认证登录",
      intro:
        "暂不开放单独注册；首次通过四川农业大学统一身份认证登录时将自动创建禾伙搭账号，昵称默认为「禾伙搭用户」。",
    };
  }
  if (props.entry === "campus") {
    return {
      eyebrow: "SICAU UNIFIED AUTH",
      heading: "统一身份认证",
      intro:
        "通过四川农业大学统一身份认证完成账号登录与校园身份核验；密码、验证码与认证凭据仅驻留当次内存请求，不在本地保存。",
    };
  }
  return {
    eyebrow: "SICAU SIGN IN",
    heading: "学校统一身份认证登录",
    intro:
      "只使用四川农业大学统一身份认证登录；首次登录自动创建账号，不要求另设密码。不登录也可以继续浏览公开比赛。",
  };
});

const busy = computed(() => !!state.pending);
const identityDisabled = computed(
  () => busy.value && !["creating", "refreshing"].includes(state.pending),
);
const challenge = computed(() => state.transaction?.challenge);
const processing = computed(
  () => state.transaction?.status === "processing" || state.uncertain,
);
const waiting = computed(
  () =>
    state.transaction?.status === "waiting" &&
    !!challenge.value &&
    !state.uncertain,
);
const ended = computed(() =>
  ["failed", "cancelled", "expired"].includes(state.transaction?.status ?? ""),
);
const needRestart = computed(
  () =>
    state.transaction?.status === "waiting" &&
    !state.transaction.challenge &&
    !state.uncertain,
);
const canSubmit = computed(
  () =>
    !!state.name.trim() &&
    !!state.account.trim() &&
    !!state.password &&
    !!state.captcha.trim() &&
    !!state.policy &&
    !state.policyFailed &&
    state.consented &&
    waiting.value &&
    !state.imageFailed &&
    !busy.value,
);

const campusSummary = computed(() => {
  if (auth.campusStatus === "valid") return "校园身份已验证";
  if (auth.campusStatus === "expired") return "校园身份已过期";
  if (auth.campusStatus === "revoked") return "校园身份已撤销";
  return "学校账号已登录";
});

const isErrorFeedback = computed(
  () =>
    state.policyFailed ||
    state.creationFailed ||
    state.imageFailed ||
    state.uncertain ||
    state.transaction?.status === "failed" ||
    state.transaction?.status === "expired",
);

function goBack() {
  const target = resolveReturnTarget(props.returnTo);
  if (target) {
    replacePage(target);
    return;
  }
  if (props.entry === "campus") {
    openTab("profile");
    return;
  }
  backOrHome();
}

function toggleConsent() {
  if (busy.value) return;
  controller.setConsented(!state.consented);
}

function refreshCaptcha() {
  if (busy.value || state.transaction?.status !== "waiting") return;
  void controller.refresh();
}

async function submit() {
  if (!canSubmit.value) return;
  const ok = await controller.submit();
  if (ok && auth.authenticated) {
    goBack();
  }
}

watch(
  () => auth.authenticated,
  (authed) => {
    if (!authed && !state.pending && !state.transaction) {
      void controller.show();
    }
  },
);

onMounted(() => {
  if (!auth.authenticated) {
    void controller.show();
  }
});

onBeforeUnmount(() => {
  controller.hide(true);
});

defineExpose({
  show: () => controller.show(),
  hide: (leaving = false) => controller.hide(leaving),
});
</script>

<template>
  <view
    class="hhr-panel hhr-auth-panel school-panel"
    role="region"
    aria-label="学校统一身份认证登录"
  >
    <text class="hhr-eyebrow">{{ copy.eyebrow }}</text>
    <text class="school-heading" role="heading" aria-level="1">{{
      copy.heading
    }}</text>

    <template v-if="auth.authenticated">
      <text class="school-intro">
        已登录：{{ auth.nickname }}（{{ campusSummary }}）。你可以直接继续浏览，或退出当前账号。
      </text>
      <view class="school-actions">
        <FormButton @click="goBack">继续浏览</FormButton>
        <FormButton
          variant="secondary"
          :loading="auth.logoutPending"
          :disabled="auth.logoutPending"
          @click="auth.logout()"
          >退出登录</FormButton
        >
        <FormButton
          v-if="auth.logoutRemoteUnconfirmed"
          variant="soft"
          :loading="auth.logoutPending"
          :disabled="auth.logoutPending"
          @click="auth.retryLogout()"
          >重试撤销远端会话</FormButton
        >
      </view>
      <text v-if="auth.logoutNotice" role="status" class="school-feedback">{{
        auth.logoutNotice
      }}</text>
      <text v-if="auth.errorMessage" role="alert" class="school-feedback">{{
        auth.errorMessage
      }}</text>
    </template>

    <template v-else>
      <text class="school-intro">{{ copy.intro }}</text>

      <text
        v-if="auth.logoutNotice"
        role="status"
        class="school-feedback"
        aria-live="polite"
        >{{ auth.logoutNotice }}</text
      >

      <view v-if="state.policyFailed && !state.policy" class="school-card">
        <text class="school-card__text">{{
          state.message || "认证说明加载失败，请重试。"
        }}</text>
        <FormButton
          variant="secondary"
          :disabled="busy"
          :loading="state.pending === 'loading'"
          @click="controller.restart()"
          >重新加载说明</FormButton
        >
      </view>

      <template v-else>
        <view v-if="waiting && challenge" class="school-form">
          <FormInput
            id="school-name"
            label="姓名"
            placeholder="请输入真实姓名"
            :model-value="state.name"
            :error="state.fieldErrors.name"
            :disabled="identityDisabled"
            :maxlength="128"
            autocomplete="off"
            @update:model-value="controller.edit('name', $event)"
          />
          <FormInput
            id="school-account"
            label="学号"
            placeholder="请输入学号"
            :model-value="state.account"
            :error="state.fieldErrors.account"
            :disabled="identityDisabled"
            :maxlength="128"
            autocomplete="off"
            @update:model-value="controller.edit('account', $event)"
          />
          <FormInput
            id="school-password"
            label="统一身份认证密码"
            placeholder="请输入校园密码"
            :model-value="state.password"
            :error="state.fieldErrors.password"
            secret
            reveal-icon
            :disabled="identityDisabled"
            :maxlength="512"
            autocomplete="off"
            @update:model-value="controller.edit('password', $event)"
          />

          <view class="school-captcha-group">
            <view class="school-captcha-input">
              <FormInput
                id="school-captcha"
                label="验证码"
                placeholder="请输入右侧字符"
                :model-value="state.captcha"
                :error="state.fieldErrors.captcha"
                :disabled="busy"
                :maxlength="32"
                autocomplete="off"
                @update:model-value="controller.edit('captcha', $event)"
                @confirm="submit"
              />
            </view>
            <view class="school-captcha-visual">
              <view
                class="school-captcha-box"
                role="button"
                :tabindex="busy ? -1 : 0"
                aria-label="验证码图片，点击换一张"
                :aria-busy="state.pending === 'refreshing'"
                :aria-disabled="busy"
                @click="refreshCaptcha"
                @keydown.enter.prevent="refreshCaptcha"
                @keydown.space.prevent="refreshCaptcha"
              >
                <image
                  class="school-captcha-img"
                  :src="challenge.imageDataUrl"
                  mode="aspectFit"
                  aria-hidden="true"
                  @error="controller.imageError()"
                />
              </view>
              <FormButton
                variant="secondary"
                class="school-captcha-btn"
                :disabled="busy"
                :loading="state.pending === 'refreshing'"
                @click="refreshCaptcha"
                >换一张</FormButton
              >
            </view>
          </view>
        </view>

        <view v-else-if="state.pending === 'loading' || state.pending === 'creating'" class="school-card">
          <text class="school-card__text" role="status" aria-live="polite"
            >正在获取统一身份认证说明与验证码…</text
          >
        </view>

        <view v-if="state.policy" class="school-policy">
          <view class="school-policy__header">
            <text class="school-policy__title">统一身份认证说明</text>
            <text class="school-policy__ver">v{{ state.policy.version }}</text>
          </view>
          <text class="school-policy__content">{{ state.policy.content }}</text>
          <view
            class="school-consent"
            role="checkbox"
            :aria-checked="state.consented"
            :aria-disabled="busy"
            tabindex="0"
            aria-label="我已阅读并同意上述统一身份认证说明"
            @click="toggleConsent"
            @keydown.enter.prevent="toggleConsent"
            @keydown.space.prevent="toggleConsent"
          >
            <view
              class="school-consent__box"
              :class="{ 'is-checked': state.consented }"
              aria-hidden="true"
            >
              <text v-if="state.consented">✓</text>
            </view>
            <text class="school-consent__text"
              >我已阅读并同意上述统一身份认证说明</text
            >
          </view>
        </view>

        <text
          v-if="state.message"
          class="school-feedback"
          :class="{ 'is-error': isErrorFeedback }"
          :role="isErrorFeedback ? 'alert' : 'status'"
          aria-live="polite"
          >{{ state.message }}</text
        >

        <view v-if="processing" class="school-actions">
          <FormButton
            v-if="state.uncertain"
            variant="secondary"
            :disabled="busy"
            :loading="state.pending === 'querying'"
            @click="controller.query()"
            >查询本次结果</FormButton
          >
          <FormButton
            variant="soft"
            :disabled="state.pending === 'cancelling'"
            :loading="state.pending === 'cancelling'"
            @click="controller.cancel()"
            >取消本次登录</FormButton
          >
        </view>

        <view
          v-else-if="ended || needRestart || state.creationFailed || state.imageFailed"
          class="school-actions"
        >
          <FormButton
            variant="secondary"
            :disabled="busy"
            :loading="state.pending === 'creating'"
            @click="controller.restart()"
            >{{
              state.pending === "creating" ? "正在获取验证码…" : "重新获取验证码"
            }}</FormButton
          >
        </view>

        <FormButton
          v-if="waiting"
          class="school-submit"
          :disabled="!canSubmit"
          :loading="state.pending === 'submitting'"
          @click="submit"
          >{{
            state.pending === "submitting" ? "正在验证登录…" : "学校账号登录"
          }}</FormButton
        >
      </template>

      <view class="school-guest-back">
        <FormButton variant="soft" :disabled="busy" @click="goBack"
          >暂不登录，返回继续浏览</FormButton
        >
      </view>
    </template>
  </view>
</template>

<style scoped>
.school-panel {
  min-width: 0;
}

.school-heading {
  display: block;
  margin-top: 8px;
  color: var(--hhr-color-ink);
  font-family: var(--hhr-font-display);
  font-size: 26px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.025em;
  overflow-wrap: anywhere;
}

.school-intro {
  display: block;
  margin-top: 8px;
  color: var(--hhr-color-muted);
  font-size: 13px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.school-form {
  display: grid;
  gap: 14px;
  margin-top: 18px;
  min-width: 0;
}

.school-captcha-group {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
  min-width: 0;
}

.school-captcha-input {
  flex: 1 1 132px;
  min-width: 0;
}

.school-captcha-visual {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.school-captcha-box {
  display: grid;
  place-items: center;
  width: 104px;
  height: 44px;
  min-height: 44px;
  border: 1px solid var(--hhr-color-line);
  border-radius: var(--hhr-radius-control);
  background: var(--hhr-color-surface);
  overflow: hidden;
  cursor: pointer;
}

.school-captcha-img {
  width: 100%;
  height: 100%;
}

.school-captcha-btn {
  width: auto;
  min-height: 44px;
  padding: 0 12px;
}

.school-card {
  display: grid;
  gap: 12px;
  margin-top: 18px;
  padding: 14px;
  border: 1px solid var(--hhr-color-line);
  border-radius: var(--hhr-radius-control);
  background: var(--hhr-color-page);
}

.school-card__text {
  color: var(--hhr-color-muted);
  font-size: 13px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.school-policy {
  display: grid;
  gap: 10px;
  margin-top: 16px;
  padding: 12px;
  border: 1px solid var(--hhr-color-line);
  border-radius: var(--hhr-radius-control);
  background: var(--hhr-color-page);
  min-width: 0;
}

.school-policy__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.school-policy__title {
  color: var(--hhr-color-ink);
  font-size: 13px;
  font-weight: 600;
}

.school-policy__ver {
  color: var(--hhr-color-muted);
  font-size: 12px;
}

.school-policy__content {
  color: var(--hhr-color-muted);
  font-size: 12px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.school-consent {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-height: 44px;
  padding: 8px 4px;
  cursor: pointer;
}

.school-consent__box {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  margin-top: 2px;
  border: 1px solid var(--hhr-color-line);
  border-radius: 6px;
  background: var(--hhr-color-surface);
  color: var(--hhr-color-surface);
  font-size: 13px;
  line-height: 1;
}

.school-consent__box.is-checked {
  border-color: var(--hhr-color-brand);
  background: var(--hhr-color-brand);
}

.school-consent__text {
  flex: 1;
  min-width: 0;
  color: var(--hhr-color-ink);
  font-size: 13px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.school-feedback {
  display: block;
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: var(--hhr-radius-control);
  background: var(--hhr-color-accent-soft);
  color: var(--hhr-color-accent-ink);
  font-size: 13px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.school-submit {
  margin-top: 18px;
  font-weight: 600;
}

.school-actions {
  display: grid;
  gap: 10px;
  margin-top: 16px;
}

.school-guest-back {
  margin-top: 12px;
}
</style>
