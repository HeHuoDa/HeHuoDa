<script setup lang="ts">
import ProjectLogo from "../components/ProjectLogo.vue";
/**
 * 认证品牌布局：品牌标识、品牌故事与表单区容器。
 * 只负责布局与返回入口，登录/注册表单由认证任务实现。
 */
</script>

<template>
  <view class="auth-layout">
    <view class="auth-header">
      <navigator
        class="brand-link"
        url="/pages/index/index"
        open-type="switchTab"
        aria-label="禾伙搭，返回首页"
      >
        <ProjectLogo />
        <view class="brand-copy">
          <text class="brand-name">禾伙搭</text>
          <text class="brand-subtitle">校园比赛与项目组队平台</text>
        </view>
      </navigator>
      <view class="auth-story">
        <view class="hhr-badge hhr-badge--warning">在川农，找到同行的人</view>
        <view class="auth-story__title">
          <text class="block">一粒想法，</text>
          <text class="block">一群伙伴。</text>
        </view>
        <view class="auth-story__text">
          <text class="block">发现值得投入的比赛与项目，</text>
          <text class="block">和志同道合的伙伴，一起慢慢成长。</text>
        </view>
        <view class="auth-story__line" aria-hidden="true"></view>
        <text class="auth-story__footnote">比赛发现 · 项目组队 · 校园协作</text>
      </view>
    </view>
    <view class="auth-body">
      <navigator
        class="auth-home-link"
        url="/pages/index/index"
        open-type="switchTab"
      >
        ← 返回首页
      </navigator>
      <slot />
    </view>
  </view>
</template>

<style scoped>
/*
 * 移动优先：320–430px 与旧 Web 认证页同一结构（品牌、故事、表单卡片）。
 * 桌面端在 768px 以上切为两列，沿用旧 Web 的 1080px / 460px 与 80px 间距。
 */
.auth-layout {
  box-sizing: border-box;
  display: grid;
  align-content: start;
  gap: 1.25rem;
  width: 100%;
  max-width: 500px;
  min-height: calc(100vh - var(--window-top, 0px));
  margin: 0 auto;
  padding: 1.5rem 1.25rem calc(1.5rem + env(safe-area-inset-bottom, 0px));
}

.auth-header {
  display: flex;
  flex-direction: column;
}

.brand-link {
  display: flex;
  align-self: flex-start;
  align-items: center;
  gap: 0.75rem;
}

.brand-copy {
  display: flex;
  flex-direction: column;
}

.brand-name {
  color: var(--hhr-color-ink);
  font-family: var(--hhr-font-display);
  font-size: 21px;
  font-weight: 700;
  line-height: 1.4;
  letter-spacing: 2px;
}

.brand-subtitle {
  color: var(--hhr-color-muted);
  font-size: 12px;
  line-height: 1.6;
}

.auth-story {
  /* 旧 Web 在 767px 以下隐藏品牌故事，移动端只保留品牌与表单卡片 */
  display: none;
}

.auth-story__title {
  margin-block: 1.5rem;
  color: var(--hhr-color-brand);
  font-family: var(--hhr-font-display);
  font-size: clamp(38px, 4.5vw, 60px);
  line-height: 1.4;
  letter-spacing: 2px;
}

.auth-story__text {
  color: var(--hhr-color-muted);
  font-size: 14px;
  line-height: 2;
}

.auth-story__line {
  width: 64px;
  height: 3px;
  margin-block: 2rem 1.125rem;
  background-color: var(--hhr-color-accent);
}

.auth-story__footnote {
  color: var(--hhr-color-muted);
  font-size: 12px;
  line-height: 1.6;
  letter-spacing: 2px;
}

.auth-body {
  min-width: 0;
}

.auth-home-link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  margin-bottom: 0.75rem;
  color: var(--hhr-color-brand);
  font-size: 14px;
}

@media (min-width: 768px) {
  .auth-layout {
    grid-template-columns: minmax(0, 1fr) minmax(0, 460px);
    align-content: center;
    align-items: center;
    gap: 5rem;
    max-width: 1080px;
    padding: 3rem 2.5rem;
  }

  .auth-story {
    display: block;
    margin-block: auto;
    padding-block: 60px;
  }
}
</style>
