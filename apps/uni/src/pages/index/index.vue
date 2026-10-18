<script setup lang="ts">
import PlaceholderPage from "../../components/PlaceholderPage.vue";
import { openPage, openTab } from "../../navigation/navigate";
</script>

<template>
  <view class="hhr-page hhr-page--tab">
    <view class="hhr-page__inner">
      <PlaceholderPage
        title="首页"
        description="在这里发现校园比赛与项目，找到一起成长的伙伴。"
      >
        <button
          class="hhr-button hhr-button--soft hhr-button--inline"
          @click="openPage('competition-detail', { id: 'preview' })"
        >
          比赛详情 · 占位预览
        </button>
        <button
          class="hhr-button hhr-button--secondary hhr-button--inline"
          @click="openTab('teams')"
        >
          去找队友
        </button>
      </PlaceholderPage>
    </view>
  </view>
</template>
