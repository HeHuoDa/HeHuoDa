<script setup lang="ts">
import { ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import AuthBrandLayout from "../../layouts/AuthBrandLayout.vue";
import { pageRouteQuery } from "../../navigation/h5-address";
import { parseSingleParam } from "../../navigation/params";
import { replacePage } from "../../navigation/navigate";
// #ifdef MP-WEIXIN
import FormButton from "../../components/FormButton.vue";
// #endif
// #ifndef MP-WEIXIN
import AuthForm from "../../components/AuthForm.vue";
// #endif

/**
 * 注册页。H5 保留原邮箱注册表单与“服务未开放”反馈。
 * 小程序不再提供邮箱密码注册：旧入口自动跳转统一登录页，首次微信登录即创建账号。
 * 返回目标只沿用登录页的注册表内校验，不接受任意地址。
 */
const returnTo = ref("");

onLoad((query) => {
  returnTo.value = parseSingleParam(pageRouteQuery(query ?? {}).returnTo).value;
  // #ifdef MP-WEIXIN
  redirectToLogin();
  // #endif
});

function redirectToLogin() {
  replacePage(
    "login",
    returnTo.value ? { returnTo: returnTo.value } : undefined,
  );
}
</script>

<template>
  <AuthBrandLayout>
    <!-- #ifdef MP-WEIXIN -->
    <view
      class="hhr-panel hhr-auth-panel"
      role="region"
      aria-label="前往微信登录"
    >
      <text class="hhr-eyebrow">WECHAT SIGN IN</text>
      <text class="auth-heading">已改为微信登录</text>
      <text class="auth-intro"
        >小程序不再提供邮箱密码注册；首次微信登录会自动创建平台账号，昵称默认为「微信用户」。</text
      >
      <FormButton class="auth-submit" @click="redirectToLogin"
        >前往微信登录</FormButton
      >
      <text class="auth-service-note"
        >如果页面没有自动跳转，请点击上面的按钮；也可以先返回浏览公开内容。</text
      >
    </view>
    <!-- #endif -->
    <!-- #ifndef MP-WEIXIN -->
    <AuthForm mode="register" />
    <!-- #endif -->
  </AuthBrandLayout>
</template>

<style scoped>
.auth-heading {
  display: block;
  margin-top: 8px;
  color: var(--hhr-color-ink);
  font-family: var(--hhr-font-display);
  font-size: 30px;
  font-weight: 600;
  line-height: 36px;
  letter-spacing: -0.025em;
}

.auth-intro {
  display: block;
  margin-top: 8px;
  color: var(--hhr-color-muted);
  font-size: 13px;
  line-height: 1.6;
}

.auth-submit {
  margin-top: 20px;
  font-weight: 600;
}

.auth-service-note {
  display: block;
  margin-top: 12px;
  color: var(--hhr-color-muted);
  font-size: 12px;
  line-height: 1.6;
}
</style>
