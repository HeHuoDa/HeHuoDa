<script setup lang="ts">
/**
 * 预留页内容骨架：标题、说明、开发状态与相关入口。
 * 页面任务（首页、找队友、个人中心等）落地时替换内容，不复制这个组件。
 * 字号、行高与面板留白对齐旧 Web 的 PlaceholderView。
 */
defineProps<{
  title: string;
  description: string;
  note?: string;
}>();
</script>

<template>
  <view class="hhr-panel hhr-placeholder">
    <view class="hhr-badge hhr-badge--warning">待开发</view>
    <text
      class="mt-6 block font-serif text-[30px] leading-[36px] font-semibold tracking-tight text-ink"
    >
      {{ title }}
    </text>
    <text class="mt-4 block text-body leading-[28px] text-muted">
      {{ description }}
    </text>
    <text class="mt-2 block text-body leading-[28px] text-muted">
      {{ note ?? "页面正在准备中，期待与你和伙伴在这里相遇。" }}
    </text>
    <view class="mt-8 flex flex-wrap gap-3">
      <slot />
    </view>
  </view>
</template>
