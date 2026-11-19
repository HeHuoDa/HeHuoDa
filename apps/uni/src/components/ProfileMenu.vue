<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { onPageHide, onUnload } from "@dcloudio/uni-app";
import AppIcon from "./AppIcon.vue";
import { openPage } from "../navigation/navigate";

/**
 * 个人中心标题行的账号入口。
 *
 * M1 不提供任何登录渠道：入口只说明学校统一身份认证尚未开放、
 * 当前可免登录浏览比赛，并保留修改资料与关于页入口。
 * 下拉用透明遮罩关闭：小程序没有 window 点击事件，不依赖事件冒泡。
 */
const emit = defineEmits<{ edit: []; notice: [value: string] }>();

const open = ref(false);
/** 下拉顶部两行说明；拆成常量避免整块静态节点，组件宿主无需静态节点插入能力。 */
const accountHint = "免登录浏览";
const authHint = "统一身份认证登录即将开放";

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
      :aria-label="'账号与设置'"
      tabindex="0"
      @click="toggle"
      @keydown.enter.prevent="toggle"
      @keydown.space.prevent="toggle"
    >
      <AppIcon name="user" :size="24" />
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
        <view class="profile-menu__avatar" aria-hidden="true">苗</view>
        <view class="profile-menu__account-text">
          <text class="profile-menu__nickname">{{ accountHint }}</text>
          <text class="profile-menu__status">{{ authHint }}</text>
        </view>
      </view>
      <view
        class="profile-menu__row"
        role="menuitem"
        tabindex="0"
        @click="openLogin"
        @keydown.enter.prevent="openLogin"
        @keydown.space.prevent="openLogin"
      >
        <view class="profile-menu__text">
          <text class="profile-menu__label">登录说明</text>
          <text class="profile-menu__hint">学校统一身份认证尚未开放</text>
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
    </view>
  </view>
</template>

<style scoped>
/*
 * 与个人中心标题行同高；触控区 44px，视觉尺寸 40px。
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
