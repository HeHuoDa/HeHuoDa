<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { teamTime } from "@hehuoda/client-domain/team";
import {
  filterNotifications,
  notificationType,
  type SessionNotification,
} from "../stores/notification-session";
import AppIcon from "./AppIcon.vue";
import FormButton from "./FormButton.vue";

const props = defineProps<{
  items: SessionNotification[];
  unreadCount: number;
}>();
const emit = defineEmits<{
  read: [id: string];
  readAll: [];
  open: [item: SessionNotification];
}>();
const unread = ref(false);
const type = ref("");
const expanded = ref<string[]>([]);
const rows = computed(() =>
  filterNotifications(props.items, unread.value, type.value),
);
const types = [
  { value: "", label: "全部类型" },
  { value: "progress", label: "组队进展" },
  { value: "announcement", label: "平台公告" },
];
function toggle(id: string) {
  expanded.value = expanded.value.includes(id)
    ? expanded.value.filter((key) => key !== id)
    : [...expanded.value, id];
}
watch(
  () => props.items,
  () => {
    expanded.value = [];
  },
);
</script>

<template>
  <view class="notification-list">
    <view class="notification-summary hhr-panel">
      <view class="summary-text">
        <text class="block text-title-sm">{{
          unreadCount ? `${unreadCount} 条未读` : "消息都已读完"
        }}</text>
        <text class="block mt-1 text-caption text-muted"
          >共 {{ items.length }} 条 · 当前会话演示</text
        >
      </view>
      <FormButton
        variant="secondary"
        class="compact-button"
        :disabled="!unreadCount"
        @click="emit('readAll')"
        >全部已读</FormButton
      >
    </view>

    <view class="notification-filters" aria-label="筛选通知">
      <view class="filter-row" aria-label="已读状态">
        <FormButton
          :variant="!unread ? 'primary' : 'secondary'"
          :aria-pressed="!unread"
          class="compact-button"
          @click="unread = false"
          >全部</FormButton
        >
        <FormButton
          :variant="unread ? 'primary' : 'secondary'"
          :aria-pressed="unread"
          class="compact-button"
          @click="unread = true"
          >未读</FormButton
        >
      </view>
      <view class="filter-row" aria-label="通知类型">
        <FormButton
          v-for="option in types"
          :key="option.value"
          :variant="type === option.value ? 'soft' : 'secondary'"
          :aria-pressed="type === option.value"
          class="compact-button"
          @click="type = option.value"
          >{{ option.label }}</FormButton
        >
      </view>
    </view>

    <view v-if="!items.length" class="hhr-panel notification-empty">
      <AppIcon name="bell" :size="32" />
      <text class="block text-title-sm">还没有通知</text>
      <text class="text-body text-muted">组队进展与平台公告会在这里展示。</text>
    </view>
    <view v-else-if="!rows.length" class="hhr-panel notification-empty">
      <text class="text-title-sm">没有符合筛选条件的通知</text>
      <text class="text-body text-muted">试试查看全部状态和全部类型。</text>
      <FormButton
        variant="secondary"
        class="compact-button"
        @click="
          unread = false;
          type = '';
        "
        >清除筛选</FormButton
      >
    </view>
    <view
      v-for="item in rows"
      :key="item.id"
      class="hhr-card notification-card"
      :class="{ 'notification-card--unread': item.readAt === null }"
      :data-notification="item.id"
    >
      <view class="notification-meta">
        <text
          class="hhr-badge"
          :class="item.type === 'progress' ? 'hhr-badge--warning' : ''"
          >{{ notificationType(item.type) }}</text
        >
        <text
          class="text-caption"
          :class="item.readAt === null ? 'text-brand' : 'text-muted'"
          >{{ item.readAt === null ? "未读" : "已读" }}</text
        >
      </view>
      <text class="block text-title-sm notification-title">{{
        item.title
      }}</text>
      <text
        class="notification-body text-body text-muted"
        :class="{ 'notification-body--summary': !expanded.includes(item.id) }"
        >{{
          expanded.includes(item.id)
            ? item.body
            : item.body.slice(0, 90) + (item.body.length > 90 ? "…" : "")
        }}</text
      >
      <text class="block text-caption text-muted">{{
        teamTime(new Date(item.time).toISOString())
      }}</text>
      <view class="notification-actions">
        <FormButton
          variant="secondary"
          class="compact-button"
          :aria-expanded="expanded.includes(item.id)"
          @click="toggle(item.id)"
          >{{
            expanded.includes(item.id) ? "收起正文" : "阅读全文"
          }}</FormButton
        >
        <FormButton
          v-if="item.readAt === null"
          variant="soft"
          class="compact-button"
          @click="emit('read', item.id)"
          >标为已读</FormButton
        >
        <FormButton
          v-if="item.target"
          class="compact-button"
          @click="emit('open', item)"
          >查看关联记录</FormButton
        >
      </view>
    </view>
  </view>
</template>

<style scoped>
.notification-list {
  display: grid;
  gap: 1rem;
  min-width: 0;
}
.notification-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
  padding: 1.25rem;
}
.summary-text {
  flex: 1 1 8rem;
  min-width: 0;
}
.notification-filters {
  display: grid;
  gap: 0.625rem;
  padding: 0.25rem 0;
}
.filter-row,
.notification-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.notification-list :deep(.compact-button) {
  width: auto;
  max-width: 100%;
  padding: 0.625rem 1rem;
  font-size: 0.8125rem;
  min-height: 44px;
}
.notification-card {
  display: grid;
  gap: 0.875rem;
  padding: 1.25rem;
  min-width: 0;
}
.notification-card--unread {
  border-left: 3px solid var(--hhr-color-brand);
}
.notification-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.notification-title,
.notification-body {
  overflow-wrap: anywhere;
}
.notification-body {
  display: block;
  line-height: 1.8;
  white-space: pre-wrap;
}
.notification-empty {
  display: grid;
  justify-items: center;
  gap: 1rem;
  padding: 2rem 1.25rem;
  text-align: center;
}
</style>
