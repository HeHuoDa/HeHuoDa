<script setup lang="ts">
import { pageRouteQuery } from "../../navigation/h5-address";
import { computed, ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import CompetitionSourceAction from "../../components/CompetitionSourceAction.vue";
import { resolveWebViewSource } from "../../source/policy";

const rawUrl = ref("");
const title = ref("官方原文");
const embeddedUrl = ref("");
const failed = ref(false);
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
  failed.value = false;
  embeddedUrl.value = "";
  // #ifdef MP-WEIXIN
  embeddedUrl.value = resolveWebViewSource(url) || "";
  // #endif
});
</script>

<template>
  <view>
    <!-- #ifdef MP-WEIXIN -->
    <web-view
      v-if="embeddedUrl && !failed"
      :src="embeddedUrl"
      @error="failed = true"
    />
    <!-- #endif -->
    <view v-if="!embeddedUrl || failed" class="hhr-page">
      <view class="hhr-page__inner hhr-panel p-6">
        <text class="source-title">{{ title }}</text>
        <text class="source-explanation">{{
          failed
            ? "原文加载失败，可能因域名配置、网络或隐私限制暂不可用。请复制链接到浏览器核对。"
            : "此地址当前不在应用内打开，请使用下方原文入口或复制链接到浏览器核对。"
        }}</text>
        <CompetitionSourceAction :notice="notice" copy-only />
      </view>
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
