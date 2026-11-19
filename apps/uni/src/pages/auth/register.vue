<script setup lang="ts">
import { ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import AuthBrandLayout from "../../layouts/AuthBrandLayout.vue";
import AuthPendingNotice from "../../components/AuthPendingNotice.vue";
import { pageRouteQuery } from "../../navigation/h5-address";
import { parseSingleParam } from "../../navigation/params";

/**
 * 注册页。M1 不提供邮箱密码或验证码注册：已确定只使用川农统一身份认证
 * （ADR 0011），真实注册随 M2（#221）接入，届时首次认证即创建账号。
 */
const returnTo = ref("");

onLoad((query) => {
  returnTo.value = parseSingleParam(pageRouteQuery(query ?? {}).returnTo).value;
});
</script>

<template>
  <AuthBrandLayout>
    <AuthPendingNotice
      title="暂不开放单独注册"
      description="后续只通过学校统一身份认证登录，首次认证时自动创建账号；当前可以免登录浏览正式比赛。"
      :return-to="returnTo"
    />
  </AuthBrandLayout>
</template>
