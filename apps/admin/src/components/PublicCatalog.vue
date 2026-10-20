<script setup lang="ts">
import { inject, onMounted, onUnmounted, ref } from "vue";
import type {
  College,
  CompetitionList,
  CompetitionDetail,
} from "@hehuoda/api-types";
import {
  createPublicCatalog,
  publicCatalogKey,
} from "../console/public-catalog";
const emit = defineEmits<{
  colleges: [value: College[]];
  select: [id: string];
}>();
const api = inject(publicCatalogKey, createPublicCatalog());
const colleges = ref<College[]>([]),
  result = ref<CompetitionList | null>(null),
  selected = ref<CompetitionDetail | null>(null),
  error = ref(""),
  collegeError = ref(""),
  collegeLoading = ref(false),
  detailError = ref(""),
  q = ref(""),
  page = ref(1),
  loading = ref(false),
  detailLoading = ref(false);
let request: AbortController | undefined,
  collegeRequest: AbortController | undefined,
  detailRequest: AbortController | undefined;
async function loadColleges() {
  collegeRequest?.abort();
  const current = new AbortController();
  collegeRequest = current;
  collegeError.value = "";
  collegeLoading.value = true;
  try {
    const value = await api.colleges(current.signal);
    if (!current.signal.aborted) {
      colleges.value = value;
      emit("colleges", value);
    }
  } catch {
    if (!current.signal.aborted)
      collegeError.value = "公开学院查询失败，不能将未知学院自动补齐。";
  } finally {
    if (!current.signal.aborted) collegeLoading.value = false;
  }
}
async function search(next = 1) {
  request?.abort();
  detailRequest?.abort();
  selected.value = null;
  detailLoading.value = false;
  detailError.value = "";
  const current = new AbortController();
  request = current;
  page.value = next;
  loading.value = true;
  error.value = "";
  result.value = null;
  try {
    const value = await api.list(q.value, next, current.signal);
    if (!current.signal.aborted) result.value = value;
  } catch {
    if (!current.signal.aborted)
      error.value = "公开比赛查询失败，请检查 API 服务后重试。";
  } finally {
    if (!current.signal.aborted) loading.value = false;
  }
}
async function detail(id: string) {
  detailRequest?.abort();
  const current = new AbortController();
  detailRequest = current;
  selected.value = null;
  detailLoading.value = true;
  detailError.value = "";
  try {
    const value = await api.detail(id, current.signal);
    if (!current.signal.aborted) selected.value = value;
  } catch {
    if (!current.signal.aborted)
      detailError.value = "公开比赛详情查询失败，未选择目标。";
  } finally {
    if (!current.signal.aborted) detailLoading.value = false;
  }
}
onMounted(() => {
  loadColleges();
  search();
});
onUnmounted(() => {
  request?.abort();
  collegeRequest?.abort();
  detailRequest?.abort();
});
</script>
<template>
  <section class="public-catalog">
    <h3>公开学院与比赛查询</h3>
    <p class="field-help">
      连接现有公开
      API。这里只包含公开比赛，不是全部管理目录；选中后仍须重新载入该目标的核对材料及基线。
    </p>
    <p v-if="collegeLoading" role="status">正在查询公开学院…</p>
    <p v-else-if="collegeError" role="alert">
      {{ collegeError }} <ElButton @click="loadColleges">重试学院查询</ElButton>
    </p>
    <p v-else class="field-help">公开学院：{{ colleges.length }} 个</p>
    <form class="console-actions catalog-search" @submit.prevent="search()">
      <ElInput
        v-model="q"
        aria-label="搜索公开比赛"
        placeholder="搜索公开比赛"
      /><ElButton native-type="submit" :loading="loading"
        >查询公开比赛</ElButton
      >
    </form>
    <p v-if="loading" role="status">正在查询公开比赛…</p>
    <p v-else-if="error" role="alert">{{ error }}</p>
    <template v-else-if="result"
      ><p v-if="!result.items.length">
        暂无匹配的公开比赛，不代表管理目录为空。
      </p>
      <ul class="catalog-list">
        <li
          v-for="entry in result.items"
          :key="entry.competition.id + '-' + entry.stage.id"
        >
          <button
            type="button"
            class="record-link"
            @click="detail(entry.competition.id)"
          >
            {{ entry.competition.name }} · {{ entry.competition.edition }}
          </button>
        </li>
      </ul>
      <ElPagination
        :current-page="page"
        :page-count="Math.max(1, result.totalPages)"
        layout="prev,pager,next"
        @update:current-page="search"
    /></template>
    <p v-if="detailLoading" role="status">正在查询公开详情…</p>
    <p v-if="detailError" role="alert">{{ detailError }}</p>
    <div v-if="selected" class="public-detail">
      <strong>{{ selected.name }} · {{ selected.edition }}</strong>
      <p>
        公开赛段 {{ selected.stages.length }} 个，来源通知
        {{ selected.notices.length }} 条。
      </p>
      <ElButton @click="emit('select', selected.id)"
        >选为关联目标并重新载入核对材料</ElButton
      >
    </div>
  </section>
</template>
