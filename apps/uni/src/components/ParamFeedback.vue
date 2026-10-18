<script setup lang="ts">
import { openTab } from "../navigation/navigate";

/** 参数缺失或非法时的明确反馈，页面不各自复制这套结构。 */
defineProps<{
  title: string;
  message: string;
}>();
</script>

<template>
  <view class="hhr-panel">
    <text class="hhr-eyebrow">PARAMETER</text>
    <text
      class="mt-2 block font-serif text-[30px] leading-[36px] font-semibold tracking-tight text-ink"
    >
      {{ title }}
    </text>
    <text class="mt-3 block text-body leading-[28px] text-muted">
      {{ message }}
    </text>
    <view class="mt-6 flex flex-wrap gap-3">
      <button class="hhr-button hhr-button--inline" @click="openTab('home')">
        返回首页
      </button>
      <slot />
    </view>
  </view>
</template>
