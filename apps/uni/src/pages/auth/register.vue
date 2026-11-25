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
 * 注册页：不开放单独注册；H5 直接进入学校统一身份认证统一登录流程（首次登录自动建号）。
 */
const returnTo = ref("");

onLoad((query) => {
  returnTo.value = parseSingleParam(pageRouteQuery(query ?? {}).returnTo).value;
});
</script>

<template>
  <AuthBrandLayout>
    <!-- #ifdef H5 -->
    <SchoolLoginPanel entry="register" :return-to="returnTo" />
    <!-- #endif -->
    <!-- #ifndef H5 -->
    <AuthPendingNotice
      title="暂不开放单独注册"
      description="后续只通过学校统一身份认证登录，首次认证时自动创建账号；当前可以免登录浏览正式比赛。"
      :return-to="returnTo"
    />
    <!-- #endif -->
  </AuthBrandLayout>
</template>
