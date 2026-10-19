<script setup lang="ts">
import AuthBrandLayout from "../../layouts/AuthBrandLayout.vue";
import AuthForm from "../../components/AuthForm.vue";
/**
 * 登录页。品牌布局由 AuthBrandLayout 提供，表单与校验见 AuthForm。
 * 账号服务尚未开放，合法提交只提示未开放，不建立登录态。
 */
</script>

<template>
  <AuthBrandLayout>
    <AuthForm mode="login" />
  </AuthBrandLayout>
</template>
