<script setup lang="ts">
import PlaceholderPage from "../../components/PlaceholderPage.vue";
import { openTab } from "../../navigation/navigate";
</script>

<template>
  <view class="hhr-page">
    <view class="hhr-page__inner">
      <PlaceholderPage
        title="站内通知"
        description="组队进展与平台提醒将在这里展示。"
      >
        <button
          class="hhr-button hhr-button--secondary hhr-button--inline"
          @click="openTab('home')"
        >
          返回首页
        </button>
      </PlaceholderPage>
    </view>
  </view>
</template>
