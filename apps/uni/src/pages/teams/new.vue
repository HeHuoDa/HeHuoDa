<script setup lang="ts">
import { onLoad } from "@dcloudio/uni-app";
import PlaceholderPage from "../../components/PlaceholderPage.vue";
import { returnToTeams } from "../../navigation/navigate";
import type { RouteQuery } from "../../navigation/params";
import {
  parseTeamRouteQuery,
  teamRouteQuery,
} from "../../navigation/team-query";

// 发布表单属 #72；这里只把列表筛选原样带回，保证发布后返回条件不丢。
let sourceQuery: RouteQuery = {};

function returnToList() {
  returnToTeams(sourceQuery);
}

onLoad((query) => {
  sourceQuery = teamRouteQuery(parseTeamRouteQuery(query ?? {}));
});
</script>

<template>
  <view class="hhr-page">
    <view class="hhr-page__inner">
      <PlaceholderPage
        title="发布招募"
        description="填写项目目标与角色需求，演示发布队伍招募。"
      >
        <button class="hhr-button hhr-button--inline" @click="returnToList">
          返回找队友
        </button>
      </PlaceholderPage>
    </view>
  </view>
</template>
