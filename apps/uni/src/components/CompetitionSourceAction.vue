<script setup lang="ts">
import type { CompetitionDetail } from "@hehuoda/api-types";
// #80 唯一来源动作接入位置；本票不自行打开网页或调用剪贴板。
defineProps<{
  notice: CompetitionDetail["notices"][number];
  compact?: boolean;
}>();
</script>
<template>
  <view class="source-action">
    <text v-if="compact" class="source-publisher"
      >{{ notice.publisher }}原文 · 待接入</text
    >
    <text v-else class="source-url" selectable>{{ notice.url }}</text>
    <button
      v-if="!compact"
      class="hhr-button hhr-button--secondary hhr-button--inline source-button"
      disabled
    >
      原文打开 / 复制 · 待接入
    </button>
  </view>
</template>
<style scoped>
.source-action {
  min-width: 0;
}
.source-publisher,
.source-url {
  display: block;
  color: var(--hhr-color-brand);
  font-size: 12px;
  line-height: 1.6;
}
.source-publisher {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
}
.source-url {
  padding: 8px 0;
  overflow-wrap: anywhere;
  word-break: break-all;
}
.source-button {
  margin-top: 4px;
  font-size: 13px;
}
</style>
