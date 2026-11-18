<script setup lang="ts">
import { ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import AuthBrandLayout from "../../layouts/AuthBrandLayout.vue";
import AuthPendingNotice from "../../components/AuthPendingNotice.vue";
import { pageRouteQuery } from "../../navigation/h5-address";
import { parseSingleParam } from "../../navigation/params";

/**
 * 登录页。M1 不提供任何登录渠道：只说明学校统一身份认证尚未开放、
 * 当前可免登录浏览比赛。真实登录由 M2（#221）接入后替换这个提示。
 */
const returnTo = ref("");

onLoad((query) => {
  // 只接受平台内部页面；非法地址回退到“返回上一页”。
  returnTo.value = parseSingleParam(pageRouteQuery(query ?? {}).returnTo).value;
});
</script>

<template>
  <AuthBrandLayout>
    <AuthPendingNotice
      title="统一身份认证登录即将开放"
      description="当前支持免登录浏览正式比赛：比赛列表、详情、赛段与官方来源都可以直接查看。"
      :return-to="returnTo"
    />
  </AuthBrandLayout>
</template>
