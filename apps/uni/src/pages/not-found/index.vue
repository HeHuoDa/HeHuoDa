<script setup lang="ts">
import { openTab } from "../../navigation/navigate";
</script>

<template>
  <view class="hhr-page">
    <view class="hhr-page__inner">
      <view class="hhr-panel">
        <text class="hhr-eyebrow">404</text>
        <text
          class="mt-2 block font-serif text-[30px] leading-[36px] font-semibold tracking-tight text-ink"
        >
          页面不存在
        </text>
        <text class="mt-4 block text-body leading-[28px] text-muted">
          这个地址没有对应的页面，回到首页继续看看吧。
        </text>
        <button
          class="hhr-button hhr-button--inline mt-8"
          @click="openTab('home')"
        >
          返回首页
        </button>
      </view>
    </view>
  </view>
</template>
