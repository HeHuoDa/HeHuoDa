<script setup lang="ts">
import { ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import AuthBrandLayout from "../../layouts/AuthBrandLayout.vue";
import { pageRouteQuery } from "../../navigation/h5-address";
import { parseSingleParam } from "../../navigation/params";
// #ifdef MP-WEIXIN
import WechatLoginPanel from "../../components/WechatLoginPanel.vue";
// #endif
// #ifndef MP-WEIXIN
import AuthForm from "../../components/AuthForm.vue";
// #endif

/**
 * 登录页。品牌布局由 AuthBrandLayout 提供。
 * 小程序为微信一键登录；H5 保留原公开浏览与“服务未开放”的准确反馈，
 * 不尝试调用微信接口，也不建立假的正式登录态。
 */
const returnTo = ref("");

onLoad((query) => {
  // 只接受平台内部页面；非法地址由面板回退到“返回上一页”。
  returnTo.value = parseSingleParam(pageRouteQuery(query ?? {}).returnTo).value;
});
</script>

<template>
  <AuthBrandLayout>
    <!-- #ifdef MP-WEIXIN -->
    <WechatLoginPanel :return-to="returnTo" />
    <!-- #endif -->
    <!-- #ifndef MP-WEIXIN -->
    <AuthForm mode="login" />
    <!-- #endif -->
  </AuthBrandLayout>
</template>
