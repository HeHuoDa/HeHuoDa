<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import {
  adminServicesKey,
  unavailableServices,
  ServiceUnavailable,
  type OverviewSummary,
} from "../services";
const services = inject(adminServicesKey, unavailableServices);
const status = ref<"loading" | "ready" | "unavailable" | "error">("loading");
const summary = ref<OverviewSummary | null>(null);
const metrics = computed(() => [
  { label: "待审核通知", value: summary.value?.pending },
  { label: "待完善草稿", value: summary.value?.drafts },
  { label: "已发布比赛", value: summary.value?.published },
  { label: "采集来源", value: summary.value?.sources },
]);
const moduleLabels: Record<string, string> = {
  pending: "待审核通知",
  drafts: "待完善草稿",
  published: "已发布比赛",
  sources: "采集来源",
};
function displayTime(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
async function load() {
  status.value = "loading";
  summary.value = null;
  try {
    summary.value = await services.getOverview();
    status.value = "ready";
  } catch (cause) {
    status.value =
      cause instanceof ServiceUnavailable ? "unavailable" : "error";
  }
}
onMounted(load);
</script>
<template>
  <section
    class="panel service-overview"
    :aria-busy="status === 'loading'"
    aria-label="工作台服务状态"
  >
    <p v-if="status === 'loading'" role="status">正在加载工作台…</p>
    <template v-else>
      <ElAlert
        v-if="status === 'unavailable'"
        title="工作台服务未开放，统计待接入。"
        type="info"
        :closable="false"
      />
      <ElAlert
        v-else-if="status === 'error'"
        title="工作台加载失败，请重试。"
        type="error"
        :closable="false"
      />
      <dl class="summary-grid">
        <div v-for="metric in metrics" :key="metric.label">
          <dt>{{ metric.label }}</dt>
          <dd>{{ metric.value ?? "待接入" }}</dd>
        </div>
      </dl>
      <p v-if="status === 'ready' && summary?.pending === 0" role="status">
        暂无待审核通知
      </p>
      <ul v-if="summary?.modules?.length" class="module-scope">
        <li v-for="item in summary.modules" :key="item.module">
          <strong>{{ moduleLabels[item.module] ?? item.module }}</strong>
          <span>范围：{{ item.available ? item.scope : "不可用" }}</span>
          <span>统计截至：{{ displayTime(item.asOf) }}（北京时间）</span>
        </li>
      </ul>
      <p v-if="status !== 'ready'">
        当前无法查询真实统计，可查看单独标注的布局示例。
      </p>
    </template>
    <ElButton :disabled="status === 'loading'" @click="load"
      >重新加载工作台</ElButton
    >
  </section>
</template>
