<script setup lang="ts">
import FormButton from "../../components/FormButton.vue";
import { openTab } from "../../navigation/navigate";
/**
 * 统一身份认证入口。
 *
 * M1 只说明学校统一身份认证尚未开放，当前免登录浏览比赛；
 * 页面不渲染认证表单、不读取凭据、也不发送认证请求。
 * M2（#221）在同一路由接入真实认证流程后替换本说明。
 */
</script>

<template>
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
