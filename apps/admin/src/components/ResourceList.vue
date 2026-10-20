<script setup lang="ts">
import { reactive, watch } from "vue";
import type { LoadStatus, PageQuery } from "../console/resource";
const props = defineProps<{
  items: {
    id: string;
    title: string;
    status: string;
    date: string;
    secondary?: string;
  }[];
  total: number;
  status: LoadStatus;
  error: string;
  query: PageQuery;
  states: Record<string, string>;
}>();
const emit = defineEmits<{
  query: [value: PageQuery];
  open: [id: string];
  retry: [];
}>();
const filter = reactive({ ...props.query });
const validation = reactive({ error: "" });
watch(
  () => props.query,
  (value) => Object.assign(filter, value),
  { deep: true },
);
function apply() {
  validation.error =
    filter.from && filter.to && filter.from > filter.to
      ? "开始日期不能晚于结束日期"
      : "";
  if (!validation.error) emit("query", { ...filter, page: 1 });
}
</script>
<template>
  <section class="panel">
    <form class="console-filters" @submit.prevent="apply">
      <label
        >搜索<ElInput
          v-model="filter.q"
          aria-label="搜索标题或昵称"
          placeholder="搜索标题或昵称"
          clearable
      /></label>
      <label
        >状态<ElSelect
          v-model="filter.status"
          aria-label="筛选状态"
          clearable
          placeholder="全部状态"
          ><ElOption
            v-for="(label, key) in states"
            :key="key"
            :label="label"
            :value="key" /></ElSelect
      ></label>
      <label
        >开始日期<input
          v-model="filter.from"
          type="date"
          aria-label="开始日期" /></label
      ><label
        >结束日期<input v-model="filter.to" type="date" aria-label="结束日期"
      /></label>
      <ElButton native-type="submit" type="primary">查询</ElButton>
    </form>
    <p v-if="validation.error" role="alert" class="form-error console-pad">
      {{ validation.error }}
    </p>
    <div v-if="status === 'loading'" class="empty-block" role="status">
      正在加载列表…
    </div>
    <div v-else-if="status === 'error'" class="empty-block">
      <p role="alert">{{ error }}</p>
      <ElButton @click="emit('retry')">重新加载列表</ElButton>
    </div>
    <template v-else-if="status === 'ready'">
      <ElTable :data="items" row-key="id"
        ><ElTableColumn label="对象" min-width="300"
          ><template #default="{ row }"
            ><button
              type="button"
              class="record-link"
              @click="emit('open', row.id)"
            >
              {{ row.title }}</button
            ><small class="record-id">{{ row.id }}</small></template
          ></ElTableColumn
        ><ElTableColumn label="状态" min-width="140"
          ><template #default="{ row }"
            ><span class="status-tag">{{
              states[row.status] || row.status
            }}</span></template
          ></ElTableColumn
        ><ElTableColumn label="独立业务状态 / 来源" min-width="190"
          ><template #default="{ row }">{{
            row.secondary || "独立页面示例"
          }}</template></ElTableColumn
        ><ElTableColumn
          prop="date"
          label="日期（北京时间）"
          min-width="160"
        /><template #empty
          ><div class="empty-block">
            <strong>{{
              query.q || query.status || query.from || query.to
                ? "筛选无结果"
                : "当前列表为空"
            }}</strong>
            <p>请调整条件或重新加载。</p>
          </div></template
        ></ElTable
      >
      <div class="table-footer">
        <span>共 {{ total }} 条</span
        ><label
          >每页<select
            :value="query.pageSize"
            aria-label="每页条数"
            @change="
              emit('query', {
                ...query,
                page: 1,
                pageSize: Number(($event.target as HTMLSelectElement).value),
              })
            "
          >
            <option :value="5">5 条</option>
            <option :value="10">10 条</option>
          </select></label
        ><ElPagination
          :current-page="query.page"
          :page-size="query.pageSize"
          :total="total"
          layout="prev, pager, next"
          @update:current-page="emit('query', { ...query, page: $event })"
        />
      </div>
    </template>
  </section>
</template>
