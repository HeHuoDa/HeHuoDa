<script setup lang="ts">
import PlaceholderPage from "../../components/PlaceholderPage.vue";
import { openTab } from "../../navigation/navigate";
</script>

<template>
  <view class="hhr-page">
    <view class="hhr-page__inner">
      <PlaceholderPage title="我的收藏" description="在这里回看关注的比赛。">
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
