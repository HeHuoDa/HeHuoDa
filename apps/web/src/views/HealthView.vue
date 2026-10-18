<script setup lang="ts">
import { computed, onMounted } from "vue";
import LoadingIndicator from "../components/LoadingIndicator.vue";
import ProjectLogo from "../components/ProjectLogo.vue";
import { useHealthStore } from "../stores/health";
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
onMounted(() => {
  void health.refresh();
});
</script>
<template>
  <main
    class="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-5 py-12"
  >
    <header class="mb-8">
      <p class="hhr-eyebrow">HEHUOREN</p>
      <div class="brand-link">
        <ProjectLogo />
        <h1 class="font-serif text-[28px] font-semibold tracking-tight">
          禾伙搭
        </h1>
      </div>
      <p class="mt-3 text-sm leading-7 text-muted">校园比赛与项目组队平台</p>
    </header>
    <section
      aria-labelledby="health-heading"
      class="hhr-panel overflow-hidden p-6"
    >
      <div class="mb-6 flex items-center justify-between gap-4">
        <h2 id="health-heading" class="text-lg font-semibold">服务状态</h2>
        <span
          class="hhr-badge px-3 py-1 text-sm"
          :class="{
            'hhr-badge--danger': health.state === 'offline',
            'hhr-badge--muted':
              health.state === 'idle' || health.state === 'loading',
          }"
          >{{ statusText }}</span
        >
      </div>
      <div
        role="status"
        aria-live="polite"
        :aria-busy="health.state === 'loading'"
      >
        <p
          v-if="health.state === 'loading'"
          class="mb-5 flex items-center gap-2 text-sm text-muted"
        >
          <LoadingIndicator />正在检查服务…
        </p>
        <p v-else-if="health.errorMessage" class="mb-5 text-sm text-danger">
          {{ health.errorMessage }}
        </p>
        <p
          v-else-if="health.state === 'online'"
          class="mb-5 text-sm text-muted"
        >
          连接正常，可以访问服务。
        </p>
        <dl
          class="flex min-w-0 flex-wrap gap-x-4 gap-y-1 border-t border-line py-3 text-sm"
        >
          <dt class="shrink-0">请求 ID</dt>
          <dd class="min-w-0 flex-1 wrap-anywhere text-right text-muted">
            {{ health.requestId ?? "—" }}
          </dd>
        </dl>
      </div>
      <button
        type="button"
        class="hhr-button mt-6 w-full"
        :aria-busy="health.state === 'loading'"
        :disabled="health.state === 'loading'"
        @click="health.refresh()"
      >
        <LoadingIndicator v-if="health.state === 'loading'" />
        {{ health.state === "offline" ? "重试连接" : "刷新状态" }}
      </button>
    </section>
    <p class="mt-5 text-xs leading-6 text-muted">
      工程初始化阶段 · 比赛、招募与申请功能将在后续阶段开放。
    </p>
  </main>
</template>
