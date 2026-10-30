<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { adminHttp } from "../runtime";
import type { Schema } from "../http";
import { errorMessage } from "../console/resource";
const rows = ref<Schema["AdminOperationDto"][]>([]),
  total = ref(0),
  page = ref(1);
const detail = ref<Schema["AdminOperationDto"] | null>(null),
  action = ref("");
const loading = ref(false),
  error = ref("");
let epoch = 0,
  detailEpoch = 0;
onBeforeUnmount(() => {
  epoch++;
  detailEpoch++;
});
async function load() {
  const current = ++epoch;
  detailEpoch++;
  detail.value = null;
  rows.value = [];
  error.value = "";
  loading.value = true;
  try {
    const params = new URLSearchParams({
      page: String(page.value),
      pageSize: "20",
    });
    if (action.value) params.set("action", action.value);
    const result = await adminHttp.request<Schema["AdminOperationsDto"]>(
      "/operations?" + params,
    );
    if (current === epoch) {
      rows.value = result.items;
      total.value = result.total;
    }
  } catch (cause) {
    if (current === epoch) error.value = errorMessage(cause);
  } finally {
    if (current === epoch) loading.value = false;
  }
}
async function select(id: string) {
  const current = ++detailEpoch;
  detail.value = null;
  try {
    const result = await adminHttp.request<Schema["AdminOperationDto"]>(
      "/operations/" + encodeURIComponent(id),
    );
    if (current === detailEpoch) detail.value = result;
  } catch (cause) {
    if (current === detailEpoch) error.value = errorMessage(cause);
  }
}
watch([page, action], load, { immediate: true });
</script>
<template>
  <div class="page-heading">
    <div>
      <h1>操作记录</h1>
      <p>查询服务端管理审计；成功与失败分别记录。</p>
    </div>
  </div>
  <section class="panel console-pad">
    <label
      >操作类型<select
        v-model="action"
        aria-label="操作类型"
        @change="page = 1"
      >
        <option value="">全部操作</option>
        <option
          v-for="item in [
            'auth.login',
            'auth.logout',
            'ingestion.scan',
            'ingestion.configure',
            'ingestion.resume',
            'candidate.review',
            'candidate.import',
            'competition.publish',
          ]"
          :key="item"
          :value="item"
        >
          {{ item }}
        </option>
      </select></label
    >
    <ElButton :disabled="loading" @click="load">刷新记录</ElButton>
    <p v-if="loading" role="status">正在查询审计…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <ElTable :data="rows" row-key="operationId"
      ><ElTableColumn
        prop="createdAt"
        label="时间"
        min-width="220"
      /><ElTableColumn
        prop="action"
        label="操作"
        min-width="180"
      /><ElTableColumn
        prop="objectId"
        label="对象"
        min-width="260"
      /><ElTableColumn
        prop="reason"
        label="理由"
        min-width="220"
      /><ElTableColumn prop="result" label="结果" /><ElTableColumn label="详情"
        ><template #default="{ row }"
          ><ElButton @click="select(row.operationId)">查看</ElButton></template
        ></ElTableColumn
      ></ElTable
    >
    <ElPagination
      v-model:current-page="page"
      :total="total"
      :page-size="20"
      layout="prev, pager, next"
    />
  </section>
  <section v-if="detail" class="panel console-pad">
    <h2>操作详情</h2>
    <dl>
      <template v-for="(value, key) in detail" :key="key"
        ><dt>{{ key }}</dt>
        <dd>{{ value ?? "—" }}</dd></template
      >
    </dl>
  </section>
</template>
