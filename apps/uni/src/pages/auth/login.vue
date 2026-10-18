<script setup lang="ts">
import AuthBrandLayout from "../../layouts/AuthBrandLayout.vue";
</script>

<template>
  <AuthBrandLayout>
    <view class="hhr-panel hhr-auth-panel">
      <text class="hhr-eyebrow">WELCOME BACK</text>
      <text
        class="mt-2 block font-serif text-[30px] leading-[36px] font-semibold tracking-tight text-ink"
      >
        登录
      </text>
      <text class="mt-2 block text-label text-muted">
        欢迎回来，继续寻找你的校园伙伴。
      </text>
      <text class="mt-6 block text-caption leading-[20px] text-muted">
        账号服务暂未开放，当前可先浏览首页与找队友。
      </text>
      <view class="mt-4 flex flex-wrap items-center gap-2">
        <view class="hhr-badge hhr-badge--warning">待开发</view>
        <text class="text-caption text-muted">登录表单将在后续任务迁移</text>
      </view>
      <view class="hhr-auth-switch">
        <text>还没有账号？</text>
        <navigator
          class="hhr-auth-switch__link"
          url="/pages/auth/register"
          open-type="redirect"
        >
          <text>前往注册 →</text>
        </navigator>
      </view>
    </view>
  </AuthBrandLayout>
</template>
