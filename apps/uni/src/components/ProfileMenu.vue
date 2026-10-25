<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { onPageHide, onUnload } from "@dcloudio/uni-app";
import AppIcon from "./AppIcon.vue";
import FormDialog from "./FormDialog.vue";
import { useAuthStore } from "../stores/auth";
import { useSessionStore } from "../stores/session";
import { openPage } from "../navigation/navigate";

/**
 * 个人中心标题行的账号入口。
 *
 * 未登录显示线框人像，已登录显示昵称首字；点开是页面内下拉，
 * 收纳微信登录/账号、编辑资料、关于我们、联系方式授权与重置示例。
 * 下拉用透明遮罩关闭：小程序没有 window 点击事件，不依赖事件冒泡。
 * 只呈现真实账号与演示设置，不把演示资料写进账号。
 */
const emit = defineEmits<{ edit: []; notice: [value: string] }>();

const auth = useAuthStore();
const session = useSessionStore();
const open = ref(false);
const confirmingReset = ref(false);

const initial = computed(() => {
  const name = auth.nickname.trim();
  return name ? Array.from(name)[0] : "";
});

/** 账号状态只来自 /auth/me，不采信本地缓存。 */
const statusText = computed(() => {
  if (!auth.accountStatus) return "账号状态未知";
  const account = auth.accountStatus === "active" ? "账号正常" : "账号受限";
  const campusLabels = {
    unverified: "校园账号未验证",
    valid: "校园账号已验证",
    expired: "校园账号核验已过期",
    revoked: "校园账号核验已撤销",
  };
  if (auth.campusStatus)
    return `${account} · ${campusLabels[auth.campusStatus]}`;
  return account;
});

function toggle() {
  open.value = !open.value;
}

function close() {
  open.value = false;
}

function editProfile() {
  close();
  emit("edit");
}

function openLogin() {
  close();
  emit("notice", "");
  openPage("login", undefined, () => {
    emit("notice", "暂时无法打开登录页，请重试。");
  });
}

function openAbout() {
  close();
  emit("notice", "");
  openPage("about", undefined, () => {
    emit("notice", "暂时无法打开关于页面，请重试。");
  });
}

function askReset() {
  close();
  confirmingReset.value = true;
}

function cancelReset() {
  confirmingReset.value = false;
}

function confirmReset() {
  confirmingReset.value = false;
  session.reset();
  emit("notice", "示例数据已重置，联系方式默认不共享。");
}

/** 退出不关闭下拉：远端撤销失败时要在这里如实显示状态。 */
async function logout() {
  await auth.logout();
}

function authorize(event: unknown) {
  const value = (event as { detail?: { value?: unknown } })?.detail?.value;
  if (typeof value !== "boolean") return;
  session.contactShared = value;
}

function authorizationKey(event: {
  key?: string;
  repeat?: boolean;
  preventDefault?: () => void;
}) {
  if (event.key !== " " && event.key !== "Enter") return;
  event.preventDefault?.();
  if (!event.repeat) authorize({ detail: { value: !session.contactShared } });
}

// 页面隐藏或卸载时收起，避免回到页面时看到过期的下拉。
onPageHide(close);
onUnload(close);

// #ifdef H5
function onKeydown(event: { key?: string }) {
  if (event.key === "Escape") close();
}
// 用 globalThis 而非 window：小程序分支会被编译剔除，这里只服务 H5 键盘关闭。
const host = globalThis as unknown as {
  addEventListener?: (type: string, handler: typeof onKeydown) => void;
  removeEventListener?: (type: string, handler: typeof onKeydown) => void;
};
watch(open, (value) => {
  if (!host.addEventListener || !host.removeEventListener) return;
  if (value) host.addEventListener("keydown", onKeydown);
  else host.removeEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => host.removeEventListener?.("keydown", onKeydown));
// #endif
</script>

<template>
  <view class="profile-menu">
    <view
      class="profile-menu__trigger"
      role="button"
      :aria-expanded="open"
      aria-haspopup="menu"
      :aria-label="auth.authenticated ? `账号：${auth.nickname}` : '账号与设置'"
      tabindex="0"
      @click="toggle"
      @keydown.enter.prevent="toggle"
      @keydown.space.prevent="toggle"
    >
      <text v-if="auth.authenticated" class="profile-menu__initial">{{
        initial
      }}</text>
      <AppIcon v-else name="user" :size="24" />
    </view>

    <view
      v-if="open"
      class="profile-menu__mask"
      aria-hidden="true"
      @click="close"
      @touchmove.stop.prevent
    />

    <view v-if="open" class="profile-menu__card" role="menu">
      <template v-if="auth.authenticated">
        <view class="profile-menu__account">
          <view class="profile-menu__avatar" aria-hidden="true">{{
            initial
          }}</view>
          <view class="profile-menu__account-text">
            <text class="profile-menu__nickname">{{ auth.nickname }}</text>
            <text class="profile-menu__status">{{ statusText }}</text>
          </view>
        </view>
      </template>
      <view
        v-else
        class="profile-menu__row"
        role="menuitem"
        tabindex="0"
        @click="openLogin"
        @keydown.enter.prevent="openLogin"
        @keydown.space.prevent="openLogin"
      >
        <view class="profile-menu__text">
          <text class="profile-menu__label">微信登录</text>
          <text class="profile-menu__hint">首次登录自动创建账号</text>
        </view>
      </view>

      <view
        class="profile-menu__row"
        role="menuitem"
        tabindex="0"
        @click="editProfile"
        @keydown.enter.prevent="editProfile"
        @keydown.space.prevent="editProfile"
      >
        <view class="profile-menu__text">
          <text class="profile-menu__label">编辑资料</text>
        </view>
      </view>

      <view
        class="profile-menu__row"
        role="menuitem"
        tabindex="0"
        @click="openAbout"
        @keydown.enter.prevent="openAbout"
        @keydown.space.prevent="openAbout"
      >
        <view class="profile-menu__text">
          <text class="profile-menu__label">关于我们</text>
        </view>
      </view>

      <view class="profile-menu__row profile-menu__row--switch">
        <view class="profile-menu__text">
          <text class="profile-menu__label">联系方式授权</text>
          <text class="profile-menu__hint">{{
            session.contactShared ? "演示已授权" : "未授权 · 不共享"
          }}</text>
        </view>
        <switch
          id="profile-menu-contact"
          class="profile-menu__switch"
          :checked="session.contactShared"
          color="var(--hhr-color-brand)"
          role="switch"
          tabindex="0"
          :aria-checked="session.contactShared"
          aria-label="允许同队有效成员查看（演示）"
          @change="authorize"
          @keydown="authorizationKey"
        />
      </view>

      <view
        class="profile-menu__row"
        role="menuitem"
        tabindex="0"
        @click="askReset"
        @keydown.enter.prevent="askReset"
        @keydown.space.prevent="askReset"
      >
        <view class="profile-menu__text">
          <text class="profile-menu__label">重置示例</text>
          <text class="profile-menu__hint">仅清空当前会话演示</text>
        </view>
      </view>

      <template v-if="auth.authenticated">
        <view
          class="profile-menu__row profile-menu__row--logout"
          role="menuitem"
          tabindex="0"
          @click="logout"
          @keydown.enter.prevent="logout"
          @keydown.space.prevent="logout"
        >
          <view class="profile-menu__text">
            <text class="profile-menu__label">退出登录</text>
          </view>
        </view>
      </template>

      <text
        v-if="auth.logoutNotice"
        role="status"
        aria-live="polite"
        class="profile-menu__notice"
        >{{ auth.logoutNotice }}</text
      >
      <text
        v-else-if="!auth.authenticated && auth.errorMessage"
        role="status"
        class="profile-menu__notice"
        >{{ auth.errorMessage }}</text
      >
    </view>

    <FormDialog
      id="profile-reset-confirm"
      :open="confirmingReset"
      title="重置示例数据？"
      save-label="确认重置"
      @save="confirmReset"
      @cancel="cancelReset"
    >
      <text class="block text-sm"
        >收藏、队伍、申请与通知会恢复到初始示例，联系方式授权同时关闭。</text
      >
      <text class="block mt-3 text-xs text-muted"
        >只影响当前会话的演示数据，不会删除真实账号，也不会退出登录。</text
      >
    </FormDialog>
  </view>
</template>

<style scoped>
/*
 * 与个人中心标题行同高；触控区 44px，视觉尺寸 40px。
 * 间距写固定 px 的理由见 AuthForm.vue（H5 根字号随视口缩放）。
 */
.profile-menu {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.profile-menu__trigger {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 1px solid var(--hhr-color-line);
  border-radius: 22px;
  background: var(--hhr-color-surface);
  color: var(--hhr-color-ink);
  cursor: pointer;
}

.profile-menu__initial {
  color: var(--hhr-color-brand);
  font-family: var(--hhr-font-display);
  font-size: 18px;
  font-weight: 600;
  line-height: 1;
}

/* 遮罩盖住整页：小程序没有 window 点击事件，关闭只靠它和再次点击图标。 */
.profile-menu__mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 30;
  background: transparent;
}

.profile-menu__card {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 40;
  box-sizing: border-box;
  width: 240px;
  max-width: calc(100vw - 40px);
  padding: 6px;
  border: 1px solid var(--hhr-color-line);
  border-radius: 14px;
  background: var(--hhr-color-surface);
  overflow-wrap: anywhere;
}

.profile-menu__account {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-bottom: 1px solid var(--hhr-color-line);
}

.profile-menu__avatar {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--hhr-color-brand-soft);
  color: var(--hhr-color-brand);
  font-family: var(--hhr-font-display);
  font-size: 16px;
}

.profile-menu__account-text {
  min-width: 0;
}

.profile-menu__nickname {
  display: block;
  color: var(--hhr-color-ink);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.profile-menu__status {
  display: block;
  color: var(--hhr-color-muted);
  font-size: 11px;
  line-height: 1.6;
}

.profile-menu__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  box-sizing: border-box;
  min-height: 44px;
  padding: 8px 10px;
  border-radius: 10px;
  cursor: pointer;
}

.profile-menu__row + .profile-menu__row {
  border-top: 1px solid var(--hhr-color-line);
  border-radius: 0;
}

.profile-menu__row--switch {
  cursor: default;
}

.profile-menu__text {
  min-width: 0;
}

.profile-menu__label {
  display: block;
  color: var(--hhr-color-ink);
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.profile-menu__hint {
  display: block;
  color: var(--hhr-color-muted);
  font-size: 11px;
  line-height: 1.5;
}

.profile-menu__row--logout .profile-menu__label {
  color: var(--hhr-color-danger);
}

.profile-menu__switch {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  min-height: 44px;
}

.profile-menu__notice {
  display: block;
  margin-top: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--hhr-color-accent-soft);
  color: var(--hhr-color-accent-ink);
  font-size: 11px;
  line-height: 1.6;
}
</style>
