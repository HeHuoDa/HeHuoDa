<script setup lang="ts">
import { onScopeDispose, ref } from "vue";
import { usePageLifecycle } from "../../lifecycle/use-page-lifecycle";
import NotificationList from "../../components/NotificationList.vue";
import FormButton from "../../components/FormButton.vue";
import { backOrHome, openProfileSection } from "../../navigation/navigate";
import { resolveNotificationTarget } from "../../navigation/notification-target";
import { useSessionStore } from "../../stores/session";
import type { SessionNotification } from "../../stores/notification-session";

const session = useSessionStore();
const feedback = ref("");
let timer: ReturnType<typeof globalThis.setInterval> | undefined;
function stop() {
  if (timer !== undefined) globalThis.clearInterval(timer);
  timer = undefined;
}
function open(item: SessionNotification) {
  if (!session.notifications.includes(item)) {
    feedback.value = "会话已重置，原通知已失效。";
    return;
  }
  if (!item.target) return;
  const result = resolveNotificationTarget(session, item.target);
  if (result.error) {
    feedback.value = result.error;
    return;
  }
  if (!result.target) return;
  const target = result.target;
  openProfileSection(
    target.section,
    {
      teamId: target.teamId,
      ...(target.recordId ? { recordId: target.recordId } : {}),
      ...(target.invitationId ? { invitationId: target.invitationId } : {}),
      revision: String(session.sessionRevision),
    },
    () => {
      feedback.value = "暂时无法打开个人中心，请重试。";
    },
  );
}
usePageLifecycle({
  show() {
    feedback.value = "";
    session.syncNotifications();
    if (timer === undefined)
      timer = globalThis.setInterval(() => session.syncNotifications(), 1000);
  },
  hide: stop,
});
const unregisterReset = session.registerReset(Symbol("notifications"), () => {
  feedback.value = "";
});
onScopeDispose(unregisterReset);
</script>

<template>
  <view class="hhr-page">
    <view class="hhr-page__inner">
      <view class="mb-5">
        <text class="hhr-eyebrow">STAY IN THE LOOP</text>
        <text class="block mt-2 font-serif text-display">站内通知</text>
        <text class="block mt-3 text-body text-muted"
          >每一步组队进展，都值得被看见。</text
        >
      </view>
      <view class="hhr-notice mb-4 text-caption"
        >仅当前会话演示，不代表真实投递。阅读不会接受邀请或加入队伍；刷新或重置恢复示例。</view
      >
      <view
        v-if="feedback"
        class="hhr-notice mb-4"
        role="status"
        aria-live="polite"
        >{{ feedback }}</view
      >
      <NotificationList
        :items="session.notifications"
        :unread-count="session.unreadNotificationCount"
        @read="session.markNotificationRead"
        @read-all="session.markAllNotificationsRead()"
        @open="open"
      />
      <FormButton variant="secondary" class="mt-5" @click="backOrHome"
        >返回</FormButton
      >
    </view>
  </view>
</template>
