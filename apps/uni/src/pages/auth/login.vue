<script setup lang="ts">
import { ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import AuthBrandLayout from "../../layouts/AuthBrandLayout.vue";
// #ifdef H5
import SchoolLoginPanel from "../../components/SchoolLoginPanel.vue";
// #endif
// #ifndef H5
import AuthPendingNotice from "../../components/AuthPendingNotice.vue";
// #endif
import { pageRouteQuery } from "../../navigation/h5-address";
import { parseSingleParam } from "../../navigation/params";

/**
 * 登录页：H5 接入四川农业大学统一身份认证登录；非 H5 端待对应任务接入。
 */
const returnTo = ref("");

onLoad((query) => {
  // 只接受平台内部页面；非法地址回退到“返回上一页”。
  returnTo.value = parseSingleParam(pageRouteQuery(query ?? {}).returnTo).value;
});
</script>

<template>
  <AuthBrandLayout>
    <!-- #ifdef H5 -->
    <SchoolLoginPanel entry="login" :return-to="returnTo" />
    <!-- #endif -->
    <!-- #ifndef H5 -->
    <AuthPendingNotice
      title="统一身份认证登录即将开放"
      description="当前支持免登录浏览正式比赛：比赛列表、详情、赛段与官方来源都可以直接查看。"
      :return-to="returnTo"
    />
    <!-- #endif -->
  </AuthBrandLayout>
</template>
