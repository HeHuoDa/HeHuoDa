<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Search, History } from "@lucide/vue";
const showExamples = ref(false);
// 固定布局样例，无管理员身份、无真实审计含义，也不写入业务数据。
const examples = Array.from({ length: 12 }, (_, index) => ({
  id: index + 1,
  time: `2026-10-19 10:${String(index).padStart(2, "0")}:00`,
  action: index % 2 ? "核对通知" : "保存草稿",
  target: `示例比赛 ${String(index + 1).padStart(2, "0")}`,
  detail: "仅供筛选与分页预览，不代表已执行的业务操作",
}));
const search = ref("");
const type = ref("");
const page = ref(1);
const actions = computed(() => [...new Set(examples.map((row) => row.action))]);
const filtered = computed(() =>
  examples.filter(
    (row) =>
      (!type.value || row.action === type.value) &&
      (!search.value.trim() ||
        [row.target, row.detail].join(" ").includes(search.value.trim())),
  ),
);
const rows = computed(() =>
  filtered.value.slice((page.value - 1) * 8, page.value * 8),
);
watch([search, type], () => {
  page.value = 1;
});
</script>
<template>
  <div class="page-heading">
    <div>
      <h1>操作记录</h1>
      <p>管理员操作审计待服务接入；可单独查看固定布局样例。</p>
    </div>
    <span class="heading-note">时间展示采用北京时间</span>
  </div>
  <ElAlert
    title="操作记录服务未开放，无法查询真实管理员审计。"
    type="info"
    :closable="false"
  />
  <div class="example-toggle">
    <ElButton
      :aria-expanded="showExamples"
      aria-controls="operation-examples"
      @click="showExamples = !showExamples"
      >{{ showExamples ? "收起示例记录" : "查看示例记录" }}</ElButton
    ><span>示例不代表实际发生的操作</span>
  </div>
  <section v-if="showExamples" id="operation-examples" class="panel">
    <div class="filter-bar">
      <ElInput
        v-model="search"
        class="search-input"
        aria-label="搜索操作对象或理由"
        placeholder="搜索操作对象或理由"
        clearable
        ><template #prefix><Search :size="17" /></template></ElInput
      ><ElSelect
        v-model="type"
        class="college-select"
        aria-label="筛选操作类型"
        placeholder="全部操作类型"
        clearable
        ><ElOption
          v-for="action in actions"
          :key="action"
          :value="action" /></ElSelect
      ><span class="filter-total">{{ filtered.length }} 条示例记录</span>
    </div>
    <ElTable :data="rows" row-key="id"
      ><ElTableColumn
        prop="time"
        label="时间（北京时间）"
        min-width="180"
      /><ElTableColumn label="操作类型" min-width="120"
        ><template #default="{ row }"
          ><span class="status-tag draft">{{ row.action }}</span></template
        ></ElTableColumn
      ><ElTableColumn
        prop="target"
        label="操作对象"
        min-width="260"
      /><ElTableColumn
        prop="detail"
        label="处理说明"
        min-width="240"
      /><ElTableColumn label="数据性质" min-width="100"
        ><template #default>本地演示</template></ElTableColumn
      ><template #empty
        ><div class="empty-block">
          <History :size="30" /><strong>没有匹配的操作记录</strong>
          <p>请调整搜索文字或操作类型。</p>
        </div></template
      ></ElTable
    >
    <div class="table-footer">
      <span>真实管理员操作审计待后端接入</span
      ><ElPagination
        v-model:current-page="page"
        :total="filtered.length"
        :page-size="8"
        layout="prev, pager, next"
      />
    </div>
  </section>
</template>
