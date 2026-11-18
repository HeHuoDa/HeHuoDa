<script setup lang="ts">
import { ref } from "vue";
import FormButton from "./FormButton.vue";
import { openPage, openTab } from "../navigation/navigate";

/**
 * 找队友主 Tab 与旧发布/详情直达页共用同一份暂缓说明（ADR 0011 方案 B）。
 * 不读取演示会话、不渲染队伍或表单，避免真实访客以为组队已可用。
 */
const feedback = ref("");
function goHome() {
  feedback.value = "";
  openTab("home", () => {
    feedback.value = "暂时无法回到首页，请用底部导航重试。";
  });
}
function openFavorites() {
  feedback.value = "";
  openPage("favorites", undefined, () => {
    feedback.value = "暂时无法打开收藏，请稍后重试。";
  });
}
const deferred = [
  "发布与查找招募",
  "申请入队、邀请与成员管理",
  "队伍治理与举报处理",
];
defineProps<{ tab?: boolean }>();
</script>

<template>
  <view class="hhr-page teams-unavailable" :class="{ 'hhr-page--tab': tab }">
    <view class="teams-unavailable__inner">
      <view class="hhr-panel teams-panel">
        <text class="hhr-badge hhr-badge--warning">暂缓开放</text>
        <text class="hhr-eyebrow teams-eyebrow">COMING LATER</text>
        <text class="teams-title" role="heading" aria-level="1">找队友</text>
        <text class="teams-copy"
          >组队与治理功能暂未开放。当前版本先开放正式比赛信息浏览：比赛列表、详情、赛段与官方来源都可以免登录查看。</text
        >
        <view class="teams-list" aria-label="暂缓开放的能力">
          <text v-for="item in deferred" :key="item" class="teams-list__item"
            >· {{ item }}</text
          >
        </view>
        <text class="teams-copy"
          >收藏可以继续使用，但只在本次会话内保留；刷新、冷启动或重置后清空，不会同步到账号或其它设备。</text
        >
        <view v-if="feedback" role="status" class="teams-feedback">{{
          feedback
        }}</view>
        <view class="teams-actions">
          <FormButton @click="goHome">回首页浏览比赛</FormButton>
          <FormButton variant="secondary" @click="openFavorites"
            >查看我的收藏</FormButton
          >
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
/* 固定 px 与其它页面的对照迁移例外一致，避免 H5 根字号缩放改变留白。 */
.teams-unavailable {
  padding: 24px 20px calc(24px + env(safe-area-inset-bottom, 0px));
  font-size: 14px;
  line-height: 1.65;
}
.teams-unavailable__inner {
  max-width: 640px;
  margin: 0 auto;
}
.teams-panel {
  min-width: 0;
  padding: 24px;
  overflow-wrap: anywhere;
}
.teams-eyebrow {
  display: block;
  margin-top: 16px;
}
.teams-title {
  display: block;
  margin-top: 8px;
  font-family: var(--hhr-font-display);
  font-size: 28px;
  font-weight: 600;
  line-height: 1.35;
}
.teams-copy {
  display: block;
  margin-top: 12px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--hhr-color-muted);
}
.teams-list {
  display: grid;
  gap: 6px;
  margin-top: 16px;
}
.teams-list__item {
  display: block;
  font-size: 14px;
  line-height: 1.6;
}
.teams-feedback {
  margin-top: 16px;
  font-size: 13px;
  color: var(--hhr-color-brand);
}
.teams-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 20px;
}
.teams-actions :deep(.hhr-button) {
  width: auto;
  max-width: 100%;
}
</style>
