<script setup lang="ts">
import { computed, ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import ParamFeedback from "../../components/ParamFeedback.vue";
import PlaceholderPage from "../../components/PlaceholderPage.vue";
import { backOrHome, returnToTeams } from "../../navigation/navigate";
import {
  paramMessage,
  parseBusinessId,
  type ParamIssue,
  type RouteQuery,
} from "../../navigation/params";
import {
  parseTeamRouteQuery,
  teamRouteQuery,
} from "../../navigation/team-query";

const id = ref("");
const issue = ref<ParamIssue | null>(null);
const message = computed(() =>
  issue.value ? paramMessage(issue.value, "队伍") : "",
);
// 列表筛选随参数带进来，返回时原样交回，避免详情页承担筛选规则。
let sourceQuery: RouteQuery = {};

function returnToList() {
  returnToTeams(sourceQuery);
}

onLoad((query) => {
  sourceQuery = teamRouteQuery(parseTeamRouteQuery(query ?? {}));
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
      <ParamFeedback v-if="issue" title="无法打开队伍详情" :message="message">
        <button
          class="hhr-button hhr-button--secondary hhr-button--inline"
          @click="returnToList"
        >
          去找队伍
        </button>
      </ParamFeedback>
      <PlaceholderPage
        v-else
        title="队伍详情"
        description="了解队伍目标、成员与合作需求。"
        :note="`业务 ID：${id} · 参数只用于定位内容，不代表身份或权限。`"
      >
        <button class="hhr-button hhr-button--inline" @click="backOrHome">
          返回上一页
        </button>
        <button
          class="hhr-button hhr-button--secondary hhr-button--inline"
          @click="returnToList"
        >
          返回找队友
        </button>
      </PlaceholderPage>
    </view>
  </view>
</template>
