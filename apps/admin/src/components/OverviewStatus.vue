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
      <p v-for="item in summary?.modules" :key="item.module">
        {{ item.module }} · {{ item.available ? item.scope : "不可用" }} ·
        {{ item.asOf }}
      </p>
      <p v-if="status !== 'ready'">
        当前无法查询真实统计，可查看单独标注的布局示例。
      </p>
    </template>
    <ElButton :disabled="status === 'loading'" @click="load"
      >重新加载工作台</ElButton
    >
  </section>
</template>
