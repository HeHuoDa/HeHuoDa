<script setup lang="ts">
import { ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
// #ifdef H5
import AuthBrandLayout from "../../layouts/AuthBrandLayout.vue";
import SchoolLoginPanel from "../../components/SchoolLoginPanel.vue";
// #endif
// #ifndef H5
import FormButton from "../../components/FormButton.vue";
import { openTab } from "../../navigation/navigate";
// #endif
import { pageRouteQuery } from "../../navigation/h5-address";
import { parseSingleParam } from "../../navigation/params";

/**
 * 统一身份认证入口：H5 接入学校唯一登录流程；非 H5 端待对应任务接入。
 */
const returnTo = ref("");

onLoad((query) => {
  returnTo.value = parseSingleParam(pageRouteQuery(query ?? {}).returnTo).value;
});
</script>

<template>
  <!-- #ifdef H5 -->
  <AuthBrandLayout>
    <SchoolLoginPanel entry="campus" :return-to="returnTo" />
  </AuthBrandLayout>
  <!-- #endif -->
  <!-- #ifndef H5 -->
  <view class="campus-page">
    <view class="campus-pending">
      <text class="hhr-eyebrow">SICAU UNIFIED AUTH</text>
      <text class="campus-title" role="heading" aria-level="1"
        >统一身份认证尚未开放</text
      >
      <text class="campus-copy"
        >M1
        只开放正式比赛信息浏览，不需要登录也不需要认证学籍。后续将只使用四川农业大学统一身份认证完成登录，届时不会要求另设邮箱密码。</text
      >
      <text class="campus-copy"
        >公开浏览不会收集姓名、学号、统一身份认证密码或验证码；如果收到此类页面，请不要填写。</text
      >
      <FormButton class="campus-action" @click="openTab('profile')"
        >返回个人中心</FormButton
      >
    </view>
  </view>
  <!-- #endif -->
</template>
<style scoped>
.campus-page {
  min-height: 100vh;
  background: var(--hhr-color-page);
}
.campus-pending {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  max-width: 600px;
  margin: 0 auto;
  padding: 32px 20px calc(32px + env(safe-area-inset-bottom));
  font-size: 14px;
  color: var(--hhr-color-ink);
  line-height: 1.7;
}
.campus-title {
  font-family: var(--hhr-font-display);
  font-size: 24px;
  font-weight: 600;
  line-height: 1.4;
}
.campus-copy {
  color: var(--hhr-color-muted);
  overflow-wrap: anywhere;
}
.campus-action {
  width: auto;
  max-width: 100%;
  margin-top: 12px;
}
</style>
