<script setup lang="ts">
import FormButton from "./FormButton.vue";
import { backOrHome, replacePage } from "../navigation/navigate";
import { resolveReturnTarget } from "../navigation/return-target";

/**
 * 登录/注册页在 M1 的统一说明：学校统一身份认证尚未开放，当前免登录浏览。
 * 不渲染任何可提交的凭据表单，也不发起认证请求；M2（#221）接入后替换本组件。
 */
const props = defineProps<{
  title: string;
  description: string;
  returnTo?: string;
}>();

function goBack() {
  const target = resolveReturnTarget(props.returnTo);
  if (target) {
    replacePage(target);
    return;
  }
  backOrHome();
}
</script>

<template>
  <view
    class="hhr-panel hhr-auth-panel"
    role="region"
    aria-label="账号登录说明"
  >
    <text class="hhr-eyebrow">SICAU SIGN IN</text>
    <text class="auth-heading">{{ title }}</text>
    <text class="auth-intro">{{ description }}</text>
    <view class="auth-next">
      <text class="auth-next__title">接下来可以做什么</text>
      <text class="auth-next__item"
        >· 在首页按承办学院筛选，并搜索比赛名称或届次。</text
      >
      <text class="auth-next__item"
        >· 打开比赛详情核对赛道、赛段时间、参赛范围与官方原文。</text
      >
      <text class="auth-next__item"
        >· 收藏感兴趣的比赛，收藏仅在本次会话内保留。</text
      >
    </view>
    <text class="auth-service-note"
      >登录统一使用四川农业大学统一身份认证，开放前不需要注册账号，也不会收集邮箱、密码或验证码。</text
    >
    <FormButton class="auth-submit" @click="goBack">返回继续浏览</FormButton>
  </view>
</template>

<style scoped>
/* 间距写固定 px：uni-app H5 的根字号随视口缩放，rem 会让留白在各档宽度波动。 */
.auth-heading {
  display: block;
  margin-top: 8px;
  color: var(--hhr-color-ink);
  font-family: var(--hhr-font-display);
  font-size: 26px;
  font-weight: 600;
  line-height: 36px;
  letter-spacing: -0.025em;
}

.auth-intro {
  display: block;
  margin-top: 8px;
  color: var(--hhr-color-muted);
  font-size: 14px;
  line-height: 1.7;
}

.auth-next {
  display: grid;
  gap: 6px;
  margin-top: 20px;
  padding: 16px;
  border: 1px solid var(--hhr-color-line);
  border-radius: var(--hhr-radius-control);
  background: var(--hhr-color-page);
}

.auth-next__title {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--hhr-color-ink);
}

.auth-next__item {
  display: block;
  font-size: 13px;
  line-height: 1.7;
  color: var(--hhr-color-muted);
  overflow-wrap: anywhere;
}

.auth-service-note {
  display: block;
  margin-top: 16px;
  color: var(--hhr-color-muted);
  font-size: 12px;
  line-height: 1.7;
}

.auth-submit {
  display: block;
  width: auto;
  max-width: 100%;
  margin-top: 20px;
  font-weight: 600;
}
</style>
