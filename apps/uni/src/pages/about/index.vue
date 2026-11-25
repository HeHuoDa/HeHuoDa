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
    title: "核对官方来源",
    description:
      "详情中的官方来源通知可以新窗口安全打开或复制地址，再到浏览器里对照原文与核对日期。",
  },
  {
    number: "03",
    title: "留下自己的关注",
    description:
      "收藏感兴趣的比赛，在收藏页回看。收藏只在本次会话内有效，刷新或重新打开后会清空。",
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
          >四川农业大学校园比赛信息平台。当前阶段先把比赛信息讲清楚，让每次查看都能对得上官方原文。</text
        >
      </view>

      <view class="hhr-panel about-section">
        <view class="about-heading">
          <text class="about-section-title" role="heading" aria-level="2"
            >从一次发现开始</text
          >
          <text class="about-copy">现在可以这样使用禾伙搭</text>
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
          <text class="about-status">当前会话</text>
          <text class="about-item-title">收藏与示例资料</text>
          <text class="about-copy"
            >收藏与服务内的示例资料只在本次内存会话保留，页面间切换可继续使用；刷新、冷启动或进程结束后清空，不会保存到账号或服务器。</text
          >
        </view>
        <view class="about-capability">
          <text class="about-status about-status--pending">暂缓开放</text>
          <text class="about-item-title">组队与招募</text>
          <text class="about-copy"
            >站内组队、招募发布、申请与邀请、队伍治理均暂缓开放。“找队友”只说明暂缓情况，不提供可操作的虚假队伍或申请。</text
          >
        </view>
        <view class="about-capability">
          <text class="about-status">H5 已开放</text>
          <text class="about-item-title">统一身份认证登录</text>
          <text class="about-copy"
            >H5
            端已接入四川农业大学统一身份认证唯一登录，首次登录自动创建账号，默认昵称为「禾伙搭用户」，并可在个人中心修改并持久化保存昵称。</text
          >
          <text class="about-copy"
            >不登录也可以继续浏览公开比赛信息与使用会话内临时收藏；密码与验证码仅用于当次向学校校验，不在本地存储。</text
          >
        </view>
      </view>

      <view class="about-privacy about-section">
        <text class="about-section-title" role="heading" aria-level="2"
          >把联系方式的选择权留给你</text
        >
        <text class="about-copy"
          >当前版本不收集、不展示任何联系方式，也不提供联系方式授权开关。组队能力开放前，请通过比赛官方通知中的渠道联系组织单位。</text
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
