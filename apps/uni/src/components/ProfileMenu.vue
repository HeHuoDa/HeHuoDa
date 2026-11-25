<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { onPageHide, onUnload } from "@dcloudio/uni-app";
import AppIcon from "./AppIcon.vue";
import { openPage } from "../navigation/navigate";
import { useAuthStore } from "../stores/auth";

/**
 * 个人中心标题行的账号入口。
 *
 * 区分游客与服务端确认的学校账号；仅展示昵称与认证状态摘要，不落真实姓名或学号。
 * 下拉用透明遮罩关闭：不依赖页面外冒泡。
 */
const emit = defineEmits<{
  edit: [];
  "edit-nickname": [];
  notice: [value: string];
}>();

const auth = useAuthStore();
const open = ref(false);

const avatarInitial = computed(() => {
  if (!auth.authenticated) return "游";
  const first = Array.from(auth.nickname.trim())[0];
  return first || "禾";
});

const accountTitle = computed(() =>
  auth.authenticated ? auth.nickname || "禾伙搭用户" : "游客浏览",
);

const authSubtitle = computed(() => {
  if (auth.authenticated) {
    if (auth.campusStatus === "unverified") return "学校账号 · 校园身份未验证";
    return auth.campusStatus === "valid"
      ? "学校账号 · 校园身份已验证"
      : "学校账号已登录";
  }
  return auth.restoring ? "正在恢复登录状态…" : "未登录学校账号";
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

function editNickname() {
  close();
  emit("edit-nickname");
}

function openLogin() {
  close();
  emit("notice", "");
  openPage("login", undefined, () => {
    emit("notice", "暂时无法打开登录页，请重试。");
  });
}

async function runLogout() {
  if (auth.logoutPending) return;
  close();
  await auth.logout();
}

function openAbout() {
  close();
  emit("notice", "");
  openPage("about", undefined, () => {
    emit("notice", "暂时无法打开关于页面，请重试。");
  });
}

// 页面隐藏或卸载时收起，避免回到页面时看到过期的下拉。
onPageHide(close);
onUnload(close);

// #ifdef H5
function onKeydown(event: { key?: string }) {
  if (event.key === "Escape") close();
}
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
      aria-label="账号与设置"
      tabindex="0"
      @click="toggle"
      @keydown.enter.prevent="toggle"
      @keydown.space.prevent="toggle"
    >
      <text v-if="auth.authenticated" class="profile-menu__initial">{{
        avatarInitial
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
      <view class="profile-menu__account">
        <view class="profile-menu__avatar" aria-hidden="true">{{
          avatarInitial
        }}</view>
        <view class="profile-menu__account-text">
          <text class="profile-menu__nickname">{{ accountTitle }}</text>
          <text class="profile-menu__status">{{ authSubtitle }}</text>
        </view>
      </view>

      <template v-if="auth.authenticated">
        <view
          class="profile-menu__row"
          role="menuitem"
          tabindex="0"
          @click="editNickname"
          @keydown.enter.prevent="editNickname"
          @keydown.space.prevent="editNickname"
        >
          <view class="profile-menu__text">
            <text class="profile-menu__label">修改昵称</text>
            <text class="profile-menu__hint">保存至服务端账号</text>
          </view>
        </view>
      </template>

      <template v-else>
        <view
          class="profile-menu__row"
          role="menuitem"
          tabindex="0"
          @click="openLogin"
          @keydown.enter.prevent="openLogin"
          @keydown.space.prevent="openLogin"
        >
          <view class="profile-menu__text">
            <text class="profile-menu__label">使用学校账号登录</text>
            <text class="profile-menu__hint">四川农业大学统一身份认证</text>
          </view>
        </view>
      </template>

      <view
        class="profile-menu__row"
        role="menuitem"
        tabindex="0"
        @click="editProfile"
        @keydown.enter.prevent="editProfile"
        @keydown.space.prevent="editProfile"
      >
        <view class="profile-menu__text">
          <text class="profile-menu__label">编辑示例资料</text>
          <text class="profile-menu__hint">仅保留在当前会话内</text>
        </view>
      </view>

      <view
        v-if="auth.authenticated"
        class="profile-menu__row profile-menu__row--logout"
        role="menuitem"
        tabindex="0"
        :aria-disabled="auth.logoutPending"
        @click="runLogout"
        @keydown.enter.prevent="runLogout"
        @keydown.space.prevent="runLogout"
      >
        <view class="profile-menu__text">
          <text class="profile-menu__label">{{
            auth.logoutPending ? "正在退出…" : "退出登录"
          }}</text>
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
    </view>
  </view>
</template>

<style scoped>
/*
 * 与个人中心标题行同高；触控区 44px。
 * 间距写固定 px：uni-app H5 的根字号随视口缩放，rem 会让留白在各档宽度波动。
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
  max-height: calc(
    100vh - var(--window-top, 0px) - var(--window-bottom, 0px) - 120px
  );
  max-height: calc(
    100dvh - var(--window-top, 0px) - var(--window-bottom, 0px) - 120px
  );
  padding: 6px;
  border: 1px solid var(--hhr-color-line);
  border-radius: 14px;
  background: var(--hhr-color-surface);
  overflow-y: auto;
  overscroll-behavior: contain;
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
</style>
