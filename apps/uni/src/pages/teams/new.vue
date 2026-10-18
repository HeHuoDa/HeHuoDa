<script setup lang="ts">
import PlaceholderPage from "../../components/PlaceholderPage.vue";
import { openTab } from "../../navigation/navigate";
</script>

<template>
  <view class="hhr-page">
    <view class="hhr-page__inner">
      <PlaceholderPage
        title="发布招募"
        description="填写项目目标与角色需求，演示发布队伍招募。"
      >
        <button class="hhr-button hhr-button--inline" @click="openTab('teams')">
          返回找队友
        </button>
      </PlaceholderPage>
    </view>
  </view>
</template>
