<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import FormButton from "./FormButton.vue";
import FormInput from "./FormInput.vue";
import { useAuthStore } from "../stores/auth";
import { openPage } from "../navigation/navigate";

/**
 * 真实账号入口。
 *
 * 只显示服务端 /auth/me 返回的账号与校园状态，独立于下方示例资料：
 * 演示学籍、联系方式与队伍记录不会写入账号，也不从演示数据推断身份。
 * 昵称修改走平台接口；退出登录无论远端是否确认都会清理本地凭据并说明状态。
 */
const auth = useAuthStore();
const editing = ref(false);
const draft = ref("");
const notice = ref("");
const focusNickname = ref(false);
const nicknameError = computed(() => auth.nicknameError);

const initial = computed(() => {
  const name = auth.nickname.trim();
  return name ? Array.from(name)[0] : "禾";
});
const statusText = computed(() => {
  if (!auth.accountStatus) return "账号状态未知";
  return auth.accountStatus === "active" ? "账号正常" : "账号受限";
});
const campusText = computed(() => {
  if (!auth.campusStatus) return "校园身份状态未知";
  return auth.campusStatus === "unverified"
    ? "校园身份未核验"
    : "校园身份已核验";
});

function openLogin() {
  notice.value = "";
  openPage("login", undefined, () => {
    notice.value = "暂时无法打开登录页，请重试。";
  });
}

async function startEdit() {
  notice.value = "";
  draft.value = auth.nickname;
  editing.value = true;
  await nextTick();
  focusNickname.value = true;
}

function cancelEdit() {
  editing.value = false;
  focusNickname.value = false;
  notice.value = "";
}

async function save() {
  const ok = await auth.updateNickname(draft.value);
  if (!ok) return;
  editing.value = false;
  focusNickname.value = false;
  notice.value = "昵称已保存。";
}

async function logout() {
  notice.value = "";
  editing.value = false;
  await auth.logout();
  notice.value = auth.logoutNotice;
}
</script>

<template>
  <view class="hhr-panel account-panel" aria-label="真实账号">
    <view class="account-heading">
      <text class="hhr-eyebrow">YOUR ACCOUNT</text>
      <text class="account-title">真实账号</text>
    </view>

    <view v-if="auth.restoring" role="status" class="account-note"
      >正在恢复登录状态…</view
    >

    <template v-else-if="auth.authenticated">
      <view class="account-identity">
        <view class="account-avatar" aria-hidden="true">{{ initial }}</view>
        <view class="account-text">
          <text class="account-name">{{ auth.nickname }}</text>
          <text class="account-meta">{{ statusText }} · {{ campusText }}</text>
          <text class="account-meta">{{
            auth.teamingAvailable
              ? "组队能力已开放"
              : "组队能力暂未开放，发布与入队仍按未开放处理"
          }}</text>
        </view>
      </view>

      <view v-if="editing" class="account-editor">
        <FormInput
          id="account-nickname"
          v-model="draft"
          label="昵称"
          :maxlength="20"
          hint="首尾空格会被忽略，1–20 个字。"
          :error="nicknameError"
          :focus="focusNickname"
          @confirm="save"
        />
        <view class="account-actions">
          <FormButton
            class="account-action"
            :loading="auth.nicknamePending"
            :disabled="auth.nicknamePending"
            @click="save"
            >保存昵称</FormButton
          >
          <FormButton
            class="account-action"
            variant="secondary"
            :disabled="auth.nicknamePending"
            @click="cancelEdit"
            >取消</FormButton
          >
        </view>
      </view>

      <view v-else class="account-actions">
        <FormButton
          class="account-action"
          variant="secondary"
          @click="startEdit"
          >修改昵称</FormButton
        >
        <FormButton
          class="account-action"
          variant="secondary"
          :loading="auth.logoutPending"
          :disabled="auth.logoutPending"
          @click="logout"
          >退出登录</FormButton
        >
      </view>

      <text
        v-if="notice || auth.errorMessage || auth.profileError"
        role="status"
        aria-live="polite"
        class="account-feedback"
        >{{ notice || auth.errorMessage || auth.profileError }}</text
      >
    </template>

    <template v-else>
      <text class="account-note"
        >登录后可保存昵称与后续真实业务数据。下方「示例资料」仅用于演示，
        不会写入账号，也不会因为登录而变成真实学籍或联系方式。</text
      >
      <text v-if="auth.errorMessage" role="status" class="account-feedback">{{
        auth.errorMessage
      }}</text>
      <view class="account-actions">
        <FormButton class="account-action" @click="openLogin">
          <!-- #ifdef MP-WEIXIN -->
          微信登录
          <!-- #endif -->
          <!-- #ifndef MP-WEIXIN -->
          登录
          <!-- #endif -->
        </FormButton>
      </view>
      <text v-if="notice" role="status" class="account-feedback">{{
        notice
      }}</text>
    </template>
  </view>
</template>

<style scoped>
.account-panel {
  margin-bottom: 24px;
}

.account-heading {
  display: grid;
  gap: 6px;
}

.account-title {
  color: var(--hhr-color-ink);
  font-family: var(--hhr-font-display);
  font-size: 22px;
  font-weight: 600;
  line-height: 30px;
}

.account-identity {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 18px;
  min-width: 0;
}

.account-avatar {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 52px;
  height: 52px;
  border-radius: 16px;
  background: var(--hhr-color-brand-soft);
  color: var(--hhr-color-brand);
  font-family: var(--hhr-font-display);
  font-size: 24px;
}

.account-text {
  min-width: 0;
}

.account-name {
  display: block;
  color: var(--hhr-color-ink);
  font-size: 18px;
  font-weight: 600;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.account-meta {
  display: block;
  margin-top: 2px;
  color: var(--hhr-color-muted);
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.account-note {
  display: block;
  margin-top: 12px;
  color: var(--hhr-color-muted);
  font-size: 13px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.account-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 16px;
}

.account-action {
  width: auto;
  min-height: 44px;
}

.account-editor {
  margin-top: 16px;
}

.account-feedback {
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

@media (max-width: 600px) {
  .account-actions {
    gap: 10px;
  }
}
</style>
