<script setup lang="ts">
import { computed, ref, watch } from "vue";
import FormButton from "./FormButton.vue";
import { useAuthStore } from "../stores/auth";
import { backOrHome, replacePage } from "../navigation/navigate";
import { resolveReturnTarget } from "../navigation/return-target";

/**
 * 小程序微信一键登录面板。
 *
 * 点击登录前必须确认当前平台协议/隐私告知版本；取消、失败、限流与
 * 服务关闭都有真实反馈，不模拟成功。登录成功后只回到原位置，
 * 由用户自己重新确认原操作，不自动发布招募或入队。
 */
const props = defineProps<{ returnTo?: string }>();

const auth = useAuthStore();
const consented = ref(false);
const notice = ref("");
const pending = computed(() => auth.loginPending);
const canSubmit = computed(() => consented.value && !pending.value);

// 协议版本被服务端判定过期后，勾选状态作废，必须重新确认。
watch(
  () => auth.consentOutdated,
  (outdated) => {
    if (outdated) consented.value = false;
  },
);

function toggleConsent() {
  if (pending.value) return;
  consented.value = !consented.value;
  notice.value = "";
  if (consented.value) auth.acknowledgeConsent();
}

async function submit() {
  if (!consented.value) {
    notice.value = "请先阅读并勾选同意上面的登录说明。";
    return;
  }
  if (pending.value) return;
  notice.value = "";
  await auth.login();
  if (auth.authenticated) goBack();
}

function goBack() {
  const target = resolveReturnTarget(props.returnTo);
  if (target) {
    replacePage(target);
    return;
  }
  backOrHome();
}
</script>

<template>
  <view class="hhr-panel hhr-auth-panel" role="region" aria-label="微信登录">
    <text class="hhr-eyebrow">WECHAT SIGN IN</text>
    <text class="auth-heading">微信一键登录</text>

    <template v-if="auth.authenticated">
      <text class="auth-intro"
        >已登录：{{ auth.nickname }}。你可以直接继续，或退出后切换账号。</text
      >
      <view class="auth-actions">
        <FormButton class="auth-submit" @click="goBack">继续</FormButton>
        <FormButton
          variant="secondary"
          :loading="auth.logoutPending"
          :disabled="auth.logoutPending"
          @click="auth.logout()"
          >退出登录</FormButton
        >
      </view>
      <text v-if="auth.logoutNotice" role="status" class="auth-feedback">{{
        auth.logoutNotice
      }}</text>
      <text v-if="auth.errorMessage" class="auth-feedback">{{
        auth.errorMessage
      }}</text>
    </template>

    <template v-else>
      <text class="auth-intro"
        >首次登录会自动创建禾伙搭账号，昵称默认为「微信用户」，之后可在个人中心修改。</text
      >
      <view
        class="auth-consent"
        role="checkbox"
        :aria-checked="consented"
        :aria-disabled="pending"
        tabindex="0"
        aria-label="我已阅读并同意登录说明"
        @click="toggleConsent"
        @keydown.enter.prevent="toggleConsent"
        @keydown.space.prevent="toggleConsent"
      >
        <view
          class="auth-consent__box"
          :class="{ 'is-checked': consented }"
          aria-hidden="true"
        >
          <text v-if="consented">✓</text>
        </view>
        <text class="auth-consent__text"
          >我已阅读并同意平台协议与隐私告知（版本
          {{
            auth.consentVersion
          }}）：登录只使用微信临时登录凭证，不获取手机号、头像或好友信息；首次登录自动创建平台账号。</text
        >
      </view>
      <text v-if="auth.consentOutdated" class="auth-service-note"
        >平台协议已更新，请重新阅读并勾选。</text
      >
      <text class="auth-service-note"
        >当前账号与个人中心的示例资料相互独立；退出会清除本地凭据。</text
      >
      <text
        v-if="notice || auth.loginError"
        class="auth-feedback"
        role="status"
        aria-live="polite"
        >{{ notice || auth.loginError }}</text
      >
      <FormButton
        class="auth-submit"
        :disabled="!canSubmit"
        :loading="pending"
        @click="submit"
        >{{ pending ? "正在登录…" : "微信一键登录" }}</FormButton
      >
      <text v-if="!consented" class="auth-service-note"
        >勾选同意后可登录；不登录也可以继续浏览公开内容。</text
      >
    </template>
  </view>
</template>

<style scoped>
/*
 * 与 AuthForm 共用品牌面板的间距与字号；间距写固定 px 的理由见 AuthForm.vue。
 */
.auth-heading {
  display: block;
  margin-top: 8px;
  color: var(--hhr-color-ink);
  font-family: var(--hhr-font-display);
  font-size: 30px;
  font-weight: 600;
  line-height: 36px;
  letter-spacing: -0.025em;
}

.auth-intro {
  display: block;
  margin-top: 8px;
  color: var(--hhr-color-muted);
  font-size: 13px;
  line-height: 1.6;
}

.auth-consent {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-height: 44px;
  margin-top: 20px;
  padding: 12px;
  border: 1px solid var(--hhr-color-line);
  border-radius: var(--hhr-radius-control);
  background: var(--hhr-color-page);
  cursor: pointer;
}

.auth-consent__box {
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

.auth-consent__box.is-checked {
  border-color: var(--hhr-color-brand);
  background: var(--hhr-color-brand);
}

.auth-consent__text {
  flex: 1;
  min-width: 0;
  color: var(--hhr-color-muted);
  font-size: 12px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.auth-service-note {
  display: block;
  margin-top: 12px;
  color: var(--hhr-color-muted);
  font-size: 12px;
  line-height: 1.6;
}

.auth-feedback {
  display: block;
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: var(--hhr-radius-control);
  background: var(--hhr-color-accent-soft);
  color: var(--hhr-color-accent-ink);
  font-size: 14px;
  line-height: 1.65;
}

.auth-submit {
  margin-top: 20px;
  font-weight: 600;
}

.auth-actions {
  display: grid;
  gap: 12px;
  margin-top: 20px;
}
</style>
