<script setup lang="ts">
import PlaceholderPage from "../../components/PlaceholderPage.vue";
import { openPage } from "../../navigation/navigate";
</script>

<template>
  <view class="hhr-page hhr-page--tab">
    <view class="hhr-page__inner">
      <PlaceholderPage
        title="找队友"
        description="按项目与角色发现招募，寻找志同道合的伙伴。"
      >
        <button
          class="hhr-button hhr-button--inline"
          @click="openPage('team-new')"
        >
          发布招募
        </button>
        <button
          class="hhr-button hhr-button--soft hhr-button--inline"
          @click="openPage('team-detail', { id: 'preview' })"
        >
          队伍详情 · 占位预览
        </button>
      </PlaceholderPage>
    </view>
  </view>
</template>
