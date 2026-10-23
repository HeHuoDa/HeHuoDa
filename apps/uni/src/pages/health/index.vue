<script setup lang="ts">
import { computed } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import { usePageLifecycle } from "../../lifecycle/use-page-lifecycle";
import LoadingIndicator from "../../components/LoadingIndicator.vue";
import ProjectLogo from "../../components/ProjectLogo.vue";
import { useHealthStore } from "../../stores/health";

const health = useHealthStore();
const statusText = computed(
  () =>
    ({
      idle: "等待检查",
      loading: "正在连接",
      online: "服务在线",
      offline: "服务离线",
    })[health.state],
);

onLoad(() => {
  void health.refresh();
});
usePageLifecycle({
  show() {
    if (health.state === "idle") void health.refresh();
  },
  hide: () => health.cancel(),
});
</script>

<template>
  <view class="health-page">
    <view class="health-header">
      <text class="hhr-eyebrow">HEHUODA</text>
      <view class="brand-link">
        <ProjectLogo />
        <text class="health-title">禾伙搭</text>
      </view>
      <text class="health-subtitle">校园比赛与项目组队平台</text>
    </view>
    <view class="hhr-panel health-panel" aria-labelledby="health-heading">
      <view class="health-panel__header">
        <text id="health-heading" class="health-heading">服务状态</text>
        <text
          class="hhr-badge health-badge"
          :class="{
            'hhr-badge--danger': health.state === 'offline',
            'hhr-badge--muted':
              health.state === 'idle' || health.state === 'loading',
          }"
          >{{ statusText }}</text
        >
      </view>
      <view
        role="status"
        aria-live="polite"
        :aria-busy="health.state === 'loading'"
      >
        <view
          v-if="health.state === 'loading'"
          class="health-message health-loading"
        >
          <LoadingIndicator />
          <text>正在检查服务…</text>
        </view>
        <text
          v-else-if="health.errorMessage"
          class="health-message text-danger"
          >{{ health.errorMessage }}</text
        >
        <text v-else-if="health.state === 'online'" class="health-message"
          >连接正常，可以访问服务。</text
        >
        <view class="health-request">
          <text class="health-request__label">请求 ID</text>
          <text class="health-request__id">{{ health.requestId ?? "—" }}</text>
        </view>
      </view>
      <button
        class="hhr-button health-refresh"
        :aria-busy="health.state === 'loading'"
        :disabled="health.state === 'loading'"
        @click="health.refresh()"
      >
        <LoadingIndicator v-if="health.state === 'loading'" />
        {{ health.state === "offline" ? "重试连接" : "刷新状态" }}
      </button>
    </view>
    <text class="health-footnote"
      >健康检查仅表示服务进程可达，不代表数据库、认证或业务已就绪。</text
    >
  </view>
</template>

<style scoped>
/* 沿旧 Web 健康页的 576px 容器、20/48px 留白和 24px 面板；原生导航栏由平台保留。 */
.health-page {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: 100%;
  max-width: 576px;
  min-height: calc(100vh - var(--window-top, 0px));
  margin: 0 auto;
  padding: 48px 20px calc(48px + env(safe-area-inset-bottom, 0px));
  overflow-wrap: anywhere;
}
.health-header {
  margin-bottom: 32px;
}
.health-header .hhr-eyebrow {
  display: block;
  margin-bottom: 7px;
}
.brand-link {
  display: flex;
  align-items: center;
  gap: 12px;
}
.brand-link :deep(.resource-image) {
  mix-blend-mode: multiply;
}
.health-title {
  font-family: var(--hhr-font-display);
  font-size: 28px;
  font-weight: 600;
  line-height: 1.65;
  letter-spacing: -0.7px;
}
.health-subtitle {
  display: block;
  margin-top: 12px;
  font-size: 14px;
  line-height: 28px;
  color: var(--hhr-color-muted);
}
.health-panel.hhr-panel {
  padding: 24px;
  overflow: hidden;
}
.health-panel__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
}
.health-heading {
  font-size: 18px;
  font-weight: 600;
  line-height: 28px;
}
.health-badge {
  padding: 4px 12px;
  font-size: 14px;
  line-height: 20px;
}
.health-message {
  display: block;
  margin-bottom: 20px;
  color: var(--hhr-color-muted);
  font-size: 14px;
  line-height: 20px;
}
.health-message.text-danger {
  color: var(--hhr-color-danger);
}
.health-loading {
  display: flex;
  align-items: center;
  gap: 8px;
}
.health-request {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  padding: 12px 0;
  border-top: 1px solid var(--hhr-color-line);
  font-size: 14px;
  line-height: 20px;
  min-width: 0;
}
.health-request__label {
  flex-shrink: 0;
}
.health-request__id {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  text-align: right;
  color: var(--hhr-color-muted);
}
.health-refresh {
  width: 100%;
  margin-top: 24px;
  padding: 10px 18px;
  gap: 8px;
  line-height: 1.65;
}
.health-footnote {
  margin-top: 20px;
  color: var(--hhr-color-muted);
  font-size: 12px;
  line-height: 24px;
}
</style>
