<script setup lang="ts">
import FormButton from "../../components/FormButton.vue";
import { openTab } from "../../navigation/navigate";
import { ref } from "vue";

/**
 * 站内通知依赖真实的组队进展与平台投递，两者都随组队一并暂缓（ADR 0011 方案 B）。
 * M1 不展示会话内演示消息，也不提供标记已读等伪交互，只说明开放范围。
 */
const feedback = ref("");
function goProfile() {
  feedback.value = "";
  openTab("profile", () => {
    feedback.value = "暂时无法回到个人中心，请用底部导航重试。";
  });
}
function goHome() {
  feedback.value = "";
  openTab("home", () => {
    feedback.value = "暂时无法回到首页，请用底部导航重试。";
  });
}
const deferred = [
  "组队进展提醒（申请、邀请、入队与退队）",
  "平台公告的真实投递与订阅",
  "已读状态与消息偏好设置",
];
</script>

<template>
  <view class="hhr-page notifications-unavailable">
    <view class="notifications-unavailable__inner">
      <view class="hhr-panel notice-panel">
        <text class="hhr-badge hhr-badge--warning">暂缓开放</text>
        <text class="hhr-eyebrow notice-eyebrow">COMING LATER</text>
        <text class="notice-title" role="heading" aria-level="1">站内通知</text>
        <text class="notice-copy"
          >站内通知尚未开放。它依赖真实的组队进展与平台投递，这两项都随组队功能一并暂缓；当前版本先开放正式比赛信息浏览。</text
        >
        <view class="notice-list" aria-label="暂缓开放的通知能力">
          <text v-for="item in deferred" :key="item" class="notice-list__item"
            >· {{ item }}</text
          >
        </view>
        <text class="notice-copy"
          >收藏可以继续使用，但只在本次会话内保留；刷新、冷启动或重置后清空，不会同步到账号或其它设备。</text
        >
        <view v-if="feedback" role="status" class="notice-feedback">{{
          feedback
        }}</view>
        <view class="notice-actions">
          <FormButton @click="goHome">回首页浏览比赛</FormButton>
          <FormButton variant="secondary" @click="goProfile"
            >返回个人中心</FormButton
          >
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
/* 固定 px 与其它页面的对照迁移例外一致，避免 H5 根字号缩放改变留白。 */
.notifications-unavailable {
  padding: 24px 20px calc(24px + env(safe-area-inset-bottom, 0px));
  font-size: 14px;
  line-height: 1.65;
}
.notifications-unavailable__inner {
  max-width: 640px;
  margin: 0 auto;
}
.notice-panel {
  min-width: 0;
  padding: 24px;
  overflow-wrap: anywhere;
}
.notice-eyebrow {
  display: block;
  margin-top: 16px;
}
.notice-title {
  display: block;
  margin-top: 8px;
  font-family: var(--hhr-font-display);
  font-size: 28px;
  font-weight: 600;
  line-height: 1.35;
}
.notice-copy {
  display: block;
  margin-top: 12px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--hhr-color-muted);
}
.notice-list {
  display: grid;
  gap: 6px;
  margin-top: 16px;
}
.notice-list__item {
  display: block;
  font-size: 14px;
  line-height: 1.6;
}
.notice-feedback {
  margin-top: 16px;
  font-size: 13px;
  color: var(--hhr-color-brand);
}
.notice-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 20px;
}
.notice-actions :deep(.hhr-button) {
  width: auto;
  max-width: 100%;
}
</style>
