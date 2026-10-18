<script setup lang="ts">
import { computed, ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import ParamFeedback from "../../components/ParamFeedback.vue";
import PlaceholderPage from "../../components/PlaceholderPage.vue";
import { backOrHome, openTab } from "../../navigation/navigate";
import {
  paramMessage,
  parseBusinessId,
  type ParamIssue,
} from "../../navigation/params";

const id = ref("");
const issue = ref<ParamIssue | null>(null);
const message = computed(() =>
  issue.value ? paramMessage(issue.value, "比赛") : "",
);

onLoad((query) => {
  const parsed = parseBusinessId(query?.id);
  if (parsed.issue) {
    issue.value = parsed.issue;
    return;
  }
  id.value = parsed.value;
});
</script>

<template>
  <view class="hhr-page">
    <view class="hhr-page__inner">
      <ParamFeedback v-if="issue" title="无法打开比赛详情" :message="message">
        <button
          class="hhr-button hhr-button--secondary hhr-button--inline"
          @click="openTab('home')"
        >
          去找比赛
        </button>
      </ParamFeedback>
      <PlaceholderPage
        v-else
        title="比赛详情"
        description="比赛规则、赛道与关联招募将在这里展示。"
        :note="`业务 ID：${id} · 参数只用于定位内容，不代表身份或权限。`"
      >
        <button class="hhr-button hhr-button--inline" @click="backOrHome">
          返回上一页
        </button>
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
