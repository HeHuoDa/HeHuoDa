<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { adminHttp } from "../runtime";
import type { Schema } from "../http";
import { errorMessage } from "../console/resource";
import { safeSourceUrl } from "../console/review";
const route = useRoute(),
  router = useRouter();
const rows = ref<Schema["AdminNoticeListItemDto"][]>([]),
  total = ref(0),
  page = ref(1);
const detail = ref<Schema["AdminNoticeDetailDto"] | null>(null);
const versions = ref<Schema["AdminNoticeVersionListItemDto"][]>([]),
  versionPage = ref(1),
  versionTotal = ref(0);
const version = ref<Schema["AdminNoticeVersionDetailDto"] | null>(null);
const error = ref(""),
  loading = ref(false);
const article = computed(() => version.value?.article ?? detail.value?.article);
let epoch = 0;
onBeforeUnmount(() => {
  epoch++;
});
async function load() {
  const current = ++epoch;
  rows.value = [];
  detail.value = null;
  version.value = null;
  versions.value = [];
  error.value = "";
  loading.value = true;
  if (route.query.preview === "1") {
    loading.value = false;
    return;
  }
  try {
    if (route.params.id) {
      const base =
        "/ingestion/notices/" + encodeURIComponent(String(route.params.id));
      const notice =
        await adminHttp.request<Schema["AdminNoticeDetailDto"]>(base);
      const history = await adminHttp.request<
        Schema["AdminNoticeVersionListDto"]
      >(base + `/versions?page=${versionPage.value}&pageSize=20`);
      const selected =
        typeof route.query.version === "string"
          ? route.query.version
          : notice.latestVersion?.id;
      const snapshot = selected
        ? await adminHttp.request<Schema["AdminNoticeVersionDetailDto"]>(
            base + "/versions/" + encodeURIComponent(selected),
          )
        : null;
      if (current !== epoch) return;
      detail.value = notice;
      versions.value = history.items;
      versionTotal.value = history.total;
      version.value = snapshot;
    } else {
      const result = await adminHttp.request<Schema["AdminNoticeListDto"]>(
        `/ingestion/notices?page=${page.value}&pageSize=20`,
      );
      if (current !== epoch) return;
      rows.value = result.items;
      total.value = result.total;
    }
  } catch (cause) {
    if (current === epoch) error.value = errorMessage(cause);
  } finally {
    if (current === epoch) loading.value = false;
  }
}
watch(
  () => route.fullPath,
  () => {
    versionPage.value = 1;
    void load();
  },
  { immediate: true },
);
</script>
<template>
  <ElAlert
    v-if="route.query.preview === '1'"
    title="通知追溯不提供固定样例；当前未查询真实通知。"
    :closable="false"
  /><RouterLink v-if="route.query.preview === '1'" :to="{ path: route.path }"
    >退出示例并查询真实通知</RouterLink
  >
  <div class="page-heading">
    <div>
      <h1>通知版本追溯</h1>
      <p>历史正文只读；审核使用候选当前版本。</p>
    </div>
    <RouterLink to="/ingestion/notices">通知列表</RouterLink>
  </div>
  <p v-if="loading" role="status">正在加载通知…</p>
  <p v-if="error" role="alert">
    {{ error }}<ElButton @click="load">重试</ElButton>
  </p>
  <section v-if="!route.params.id" class="panel console-pad">
    <ElTable :data="rows" row-key="noticeId"
      ><ElTableColumn label="标题" min-width="300"
        ><template #default="{ row }"
          ><RouterLink :to="'/ingestion/notices/' + row.noticeId">{{
            row.article?.title ?? "正文不可用"
          }}</RouterLink></template
        ></ElTableColumn
      ><ElTableColumn
        prop="sourceId"
        label="来源"
        min-width="180" /><ElTableColumn
        prop="health"
        label="来源状态" /><ElTableColumn
        prop="fetchedAt"
        label="检查时间"
        min-width="220"
    /></ElTable>
    <ElPagination
      v-model:current-page="page"
      :total="total"
      :page-size="20"
      layout="prev, pager, next"
      @current-change="load"
    />
  </section>
  <section v-if="detail" class="panel console-pad">
    <h2>{{ article?.title ?? "正文不可用" }}</h2>
    <p>
      {{ detail.source.publisher }} · 来源状态 {{ detail.health }} · 证据状态
      {{ detail.evidenceState }}
    </p>
    <a
      v-if="safeSourceUrl(detail.finalUrl)"
      :href="safeSourceUrl(detail.finalUrl)!"
      target="_blank"
      rel="noopener noreferrer"
      >查看官方原文</a
    >
    <p v-if="detail.candidate">
      <RouterLink :to="'/ingestion/candidates/' + detail.candidate.id"
        >审核当前候选</RouterLink
      >
    </p>
    <label
      >正文版本<select
        aria-label="正文版本"
        :value="version?.versionId"
        @change="
          router.replace({
            path: route.path,
            query: { version: ($event.target as HTMLSelectElement).value },
          })
        "
      >
        <option
          v-for="item in versions"
          :key="item.versionId"
          :value="item.versionId"
        >
          第 {{ item.revision }} 版 · {{ item.fetchedAt }}
        </option>
      </select></label
    >
    <ElPagination
      v-model:current-page="versionPage"
      :total="versionTotal"
      :page-size="20"
      layout="prev, pager, next"
      @current-change="load"
    />
    <p v-if="version">
      版本 {{ version.revision }} · {{ version.fetchedAt }} ·
      {{
        version.versionId === detail.latestVersion?.id
          ? "当前正文"
          : "历史正文，只读"
      }}
    </p>
    <pre class="notice-text">{{ article?.text }}</pre>
    <ul>
      <li v-for="attachment in article?.attachments" :key="attachment.url">
        <a
          v-if="safeSourceUrl(attachment.url)"
          :href="safeSourceUrl(attachment.url)!"
          target="_blank"
          rel="noopener noreferrer"
          >{{ attachment.title }}</a
        ><span v-else>{{ attachment.title }}（地址不可用）</span>
      </li>
    </ul>
    <details v-if="version?.differences.length">
      <summary>与上一版的差异</summary>
      <pre class="notice-text">{{
        JSON.stringify(version.differences, null, 2)
      }}</pre>
    </details>
  </section>
</template>
