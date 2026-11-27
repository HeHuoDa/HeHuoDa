<script setup lang="ts">
import { pageRouteQuery } from "../../navigation/h5-address";
import { computed, ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import CompetitionSourceAction from "../../components/CompetitionSourceAction.vue";

/**
 * 官方来源直达页。
 *
 * 按 ADR 0011，小程序内嵌 web-view 承载已退役；本页只保留可执行的回退：
 * H5 用安全外链新窗口打开，Android 提供复制与系统浏览器路径（真机打开归 #226）。
 * 地址仍由来源组件按公开 HTTPS 规则重新判定，路由参数不能当作允许标记。
 */
const rawUrl = ref("");
const title = ref("官方原文");
const notice = computed(() => ({
  id: "source",
  title: title.value,
  publisher: "官方通知",
  url: rawUrl.value,
}));
onLoad((platformQuery) => {
  const query = pageRouteQuery(platformQuery ?? {});
  // 不做额外 decode，不接收重复参数数组，更不相信调用方的允许标识。
  const url: unknown = query?.url;
  rawUrl.value = typeof url === "string" ? url : "";
  title.value =
    typeof query?.title === "string" && query.title ? query.title : "官方原文";
});
</script>

<template>
  <view class="hhr-page">
    <view class="hhr-page__inner hhr-panel p-6">
      <text class="source-title">{{ title }}</text>
      <text class="source-explanation"
        >此地址不在应用内嵌入打开，请使用下方原文入口或复制链接到浏览器核对。</text
      >
      <CompetitionSourceAction :notice="notice" copy-only />
    </view>
  </view>
</template>

<style scoped>
.source-title {
  display: block;
  font-size: 20px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.source-explanation {
  display: block;
  margin: 0.75rem 0;
  color: var(--hhr-color-muted);
  font-size: 14px;
}
</style>
