<script setup lang="ts">
import AuthBrandLayout from "../../layouts/AuthBrandLayout.vue";
import AuthForm from "../../components/AuthForm.vue";
/**
 * 注册页。品牌布局由 AuthBrandLayout 提供，表单与校验见 AuthForm。
 * 昵称、邮箱、密码、确认密码与邮箱验证码沿用旧 Web 规则；
 * 认证与验证码服务尚未开放，合法输入只提示未开放，不建立账号或会话。
 */
</script>

<template>
  <AuthBrandLayout>
    <AuthForm mode="register" />
  </AuthBrandLayout>
</template>
