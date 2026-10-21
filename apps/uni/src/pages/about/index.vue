<script setup lang="ts">
import { ref } from "vue";
import ProjectLogo from "../../components/ProjectLogo.vue";
import FormButton from "../../components/FormButton.vue";
import { openProfileSection } from "../../navigation/navigate";

const feedback = ref("");
function returnToProfile() {
  feedback.value = "";
  openProfileSection("profile", {}, () => {
    feedback.value = "暂时无法打开个人中心，请重试。";
  });
}

const steps = [
  {
    number: "01",
    title: "发现一场比赛",
    description:
      "浏览比赛，按承办学院筛选，在详情核对赛道、赛段、时间与官方来源。承办学院不等于参赛资格范围，请以官方原文为准。",
  },
  {
    number: "02",
    title: "找到同行的伙伴",
    description:
      "在找队友中了解招募、查看队伍，或演示发布招募。平台组队不等于官方报名，也不代表已经通过参赛资格审核。",
  },
  {
    number: "03",
    title: "让合作更进一步",
    description:
      "在个人中心编辑示例资料、管理队伍，跟进申请与邀请。申请或收到邀请不代表入队，受邀者确认后才建立成员关系。",
  },
];
</script>

<template>
  <view class="hhr-page about-page">
    <view class="hhr-page__inner">
      <view class="about-brand">
        <view class="about-brand__identity">
          <ProjectLogo :size="56" />
          <view class="about-brand__name">
            <text class="hhr-eyebrow">GROW TOGETHER</text>
            <text class="about-title" role="heading" aria-level="1"
              >禾伙搭</text
            >
          </view>
        </view>
        <text class="about-tagline">一起成长，各有所长。</text>
        <text class="about-intro"
          >四川农业大学校园比赛与项目组队平台。让比赛信息更清楚，让每一份所长遇见合适的伙伴。</text
        >
      </view>

      <view class="hhr-panel about-section">
        <view class="about-heading">
          <text class="about-section-title" role="heading" aria-level="2"
            >从一次发现，到一起出发</text
          >
          <text class="about-copy">你可以这样使用禾伙搭</text>
        </view>
        <view v-for="step in steps" :key="step.number" class="about-step">
          <text class="about-step__number" aria-hidden="true">{{
            step.number
          }}</text>
          <view class="about-step__content">
            <text class="about-item-title">{{ step.title }}</text>
            <text class="about-copy">{{ step.description }}</text>
          </view>
        </view>
      </view>

      <view class="hhr-panel about-section">
        <view class="about-heading">
          <text class="about-section-title" role="heading" aria-level="2"
            >现在，哪些能力可以使用</text
          >
          <text class="about-copy">了解边界，再安心尝试。</text>
        </view>
        <view class="about-capability">
          <text class="about-status">真实公开查询</text>
          <text class="about-item-title">比赛与官方来源</text>
          <text class="about-copy"
            >比赛列表、承办学院筛选与比赛详情读取公开接口。官方来源通知是详情中的信息依据，请核对原文及核对日期，及时留意官方变更。</text
          >
        </view>
        <view class="about-capability">
          <text class="about-status about-status--demo">会话演示</text>
          <text class="about-item-title">组队、收藏与站内通知</text>
          <text class="about-copy"
            >招募、资料编辑、队伍管理、申请与邀请、比赛收藏和站内通知已提供会话演示。收藏引用的比赛信息仍从真实公开接口查询。</text
          >
          <text class="about-copy"
            >站内通知展示组队进展与平台提醒演示，与比赛的官方来源通知不同，不代表消息真实发送或投递。</text
          >
          <text class="about-copy"
            >演示变化仅保留在当前内存会话，页面间切换可继续使用；刷新、冷启动或统一重置会恢复初始示例，不会保存到账号或服务器。个人资料中的“重置示例”只重置资料与授权，不清空队伍、收藏或通知。</text
          >
        </view>
        <view class="about-capability">
          <text class="about-status about-status--pending">待开放</text>
          <text class="about-item-title">账号服务</text>
          <text class="about-copy"
            >账号、登录注册与验证码真实服务尚未开放。现有表单用于校验与交互展示，当前不能完成真实注册或登录。</text
          >
        </view>
      </view>

      <view class="about-privacy about-section">
        <text class="about-section-title" role="heading" aria-level="2"
          >把联系方式的选择权留给你</text
        >
        <text class="about-copy"
          >联系方式默认不共享。只有查看者与所有者均为同队有效成员，且获得所有者授权，才满足展示条件。申请者、未确认的受邀者、已退出或被移除的成员均不满足条件。</text
        >
        <text class="about-copy"
          >当前只演示授权判断，不收集或展示真实联系方式。</text
        >
      </view>

      <view
        v-if="feedback"
        class="hhr-notice mb-4"
        role="status"
        aria-live="polite"
        >{{ feedback }}</view
      >
      <FormButton @click="returnToProfile">返回个人中心</FormButton>
    </view>
  </view>
</template>

<style scoped>
.about-page {
  font-size: 14px;
}
.about-brand {
  padding: 0.5rem 0 1.75rem;
}
.about-brand__identity {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.about-brand__name,
.about-step__content {
  min-width: 0;
}
.about-title {
  display: block;
  margin-top: 4px;
  font-family: var(--hhr-font-display);
  font-size: 32px;
  font-weight: 600;
  line-height: 1.4;
}
.about-tagline {
  display: block;
  margin-top: 1.5rem;
  font-family: var(--hhr-font-display);
  font-size: 24px;
  line-height: 1.6;
}
.about-intro {
  display: block;
  margin-top: 0.75rem;
  color: var(--hhr-color-muted);
  font-size: 14px;
  line-height: 1.9;
}
.about-section {
  margin-bottom: 1.25rem;
}
.about-heading {
  margin-bottom: 1.25rem;
}
.about-section-title {
  display: block;
  font-family: var(--hhr-font-display);
  font-size: 20px;
  font-weight: 600;
  line-height: 1.6;
}
.about-item-title {
  display: block;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.7;
}
.about-copy {
  display: block;
  margin-top: 0.5rem;
  color: var(--hhr-color-muted);
  font-size: 14px;
  line-height: 1.9;
}
.about-step {
  display: flex;
  align-items: flex-start;
  gap: 0.875rem;
}
.about-step + .about-step {
  margin-top: 1.5rem;
}
.about-step__number {
  flex-shrink: 0;
  color: var(--hhr-color-brand);
  font-family: var(--hhr-font-display);
  font-size: 18px;
  line-height: 1.5;
}
.about-capability + .about-capability {
  margin-top: 1.25rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--hhr-color-line);
}
.about-status {
  display: inline-block;
  max-width: 100%;
  box-sizing: border-box;
  margin-bottom: 0.75rem;
  padding: 0.25rem 0.625rem;
  border-radius: var(--hhr-radius-badge);
  background: var(--hhr-color-brand-soft);
  color: var(--hhr-color-brand);
  font-size: 12px;
  line-height: 1.6;
}
.about-status--demo {
  background: var(--hhr-color-accent-soft);
  color: var(--hhr-color-accent-ink);
}
.about-status--pending {
  background: var(--hhr-color-page);
  color: var(--hhr-color-muted);
}
.about-privacy {
  padding: 1.375rem;
  border-left: 3px solid var(--hhr-color-brand);
  border-radius: 0 var(--hhr-radius-card) var(--hhr-radius-card) 0;
  background: var(--hhr-color-brand-soft);
}
</style>
