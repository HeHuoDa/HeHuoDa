<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { CompetitionList } from "@hehuoren/api-types";
import CollegePicker from "../components/CollegePicker.vue";
import { colleges } from "../data/colleges";
import { competitionApi, originLabels } from "../api/competitions";
import {
  collegeNames,
  formatTime,
  formatEvaluatedAt,
  materialDeadlineLabel,
  parseFilters,
  scopeLabel,
  statuses,
  writeFilters,
  type Filters,
} from "../data/competition-discovery";
const route = useRoute();
const router = useRouter();
const filters = computed(() => parseFilters(route.query));
const search = ref(filters.value.q);
watch(
  () => filters.value.q,
  (value) => {
    search.value = value;
  },
);
const response = ref<CompetitionList>();
const loading = ref(true);
const error = ref("");
const retry = ref(0);
let directoryValidated = false;
async function ensureDirectory(signal: AbortSignal) {
  if (directoryValidated) return;
  const directory = await competitionApi.colleges(signal);
  if (signal.aborted) return;
  if (
    directory.length !== colleges.length ||
    directory.some(
      (c, i) =>
        c.id !== colleges[i]?.id ||
        c.name !== colleges[i]?.name ||
        c.order !== i,
    )
  )
    throw new Error("学院目录与页面资源不一致，请重试或联系维护人员。");
  directoryValidated = true;
}
let skipKey = "";
const filterKey = (value: Filters) => JSON.stringify(value);
watch(
  () => [filterKey(filters.value), retry.value],
  async (_value, _old, onCleanup) => {
    const key = filterKey(filters.value);
    if (key === skipKey && response.value) {
      skipKey = "";
      return;
    }
    const controller = new AbortController();
    let active = true;
    onCleanup(() => {
      active = false;
      controller.abort();
    });
    loading.value = true;
    error.value = "";
    response.value = undefined;
    try {
      const [, data] = await Promise.all([
        ensureDirectory(controller.signal),
        competitionApi.list(filters.value, controller.signal),
      ]);
      if (!active) return;
      response.value = data;
      loading.value = false;
      if (data.page !== filters.value.page) {
        const corrected = { ...filters.value, page: data.page };
        skipKey = filterKey(corrected);
        await router.replace({
          path: route.path,
          query: writeFilters(route.query, corrected),
          hash: route.hash,
        });
      }
    } catch (failure) {
      if (active)
        error.value =
          failure instanceof Error && failure.message.startsWith("学院目录")
            ? failure.message
            : "比赛或学院目录加载失败，请检查网络后重试。";
    } finally {
      if (active) loading.value = false;
    }
  },
  { immediate: true },
);
const entries = computed(() => response.value?.items ?? []);
const visible = entries;
const pages = computed(() => response.value?.totalPages ?? 1);
const noCollegesSelected = computed(
  () => filters.value.hosts !== "all" && !filters.value.hosts.length,
);
function update(patch: Partial<Filters>, page = 1) {
  void router.push({
    name: "home",
    query: writeFilters(route.query, { ...filters.value, ...patch, page }),
  });
}
function choice(event: Event) {
  return (event.target as HTMLSelectElement).value;
}
function reset() {
  search.value = "";
  update({ ...parseFilters({}) });
}
</script>
<template>
  <header class="mb-7">
    <p class="hhr-eyebrow">校园里的每一种可能</p>
    <h1 class="discovery-heading font-serif text-3xl font-semibold">
      发现比赛，找到同路人
    </h1>
    <p class="mt-3 text-sm text-muted">
      从一场比赛开始，让想法生根，让各有所长的伙伴相遇。
    </p>
  </header>
  <div
    class="grid items-start gap-5 min-[1100px]:grid-cols-[340px_minmax(0,1fr)]"
  >
    <CollegePicker
      compact
      :model-value="filters.hosts"
      @update:model-value="update({ hosts: $event })"
    >
      <template #footer>
        <form
          aria-label="比赛筛选"
          class="discovery-filters grid grid-cols-[minmax(0,1fr)_auto] gap-0.5"
          @submit.prevent="update({ q: search.trim().slice(0, 100) })"
        >
          <div class="col-span-2 flex min-w-0 gap-1.5">
            <input
              v-model="search"
              type="search"
              class="hhr-input discovery-filter-control h-8 min-h-0 min-w-0 px-2 py-0 text-xs"
              placeholder="搜索比赛名称、届次"
              maxlength="100"
              aria-label="搜索比赛"
            />
            <button
              type="submit"
              class="hhr-button discovery-search-button h-8 min-h-0 shrink-0 px-3 py-0 text-xs"
            >
              搜索
            </button>
          </div>
          <select
            class="hhr-input discovery-filter-control discovery-status-select h-8 min-h-0 min-w-0 px-2 py-0 text-xs"
            aria-label="报名状态"
            :value="filters.status"
            @change="update({ status: choice($event) as Filters['status'] })"
          >
            <option value="">全部状态</option>
            <option
              v-for="(label, status) in statuses"
              :key="status"
              :value="status"
            >
              {{ label }}
            </option>
          </select>
          <div
            class="discovery-filter-actions flex items-center justify-end text-[11px]"
          >
            <div class="flex gap-2">
              <button
                type="button"
                class="min-h-8 text-brand"
                @click="update({ hosts: [] })"
              >
                取消全部学院
              </button>
              <button type="button" class="min-h-8 text-brand" @click="reset">
                重置所有筛选
              </button>
            </div>
          </div>
        </form>
      </template>
    </CollegePicker>
    <section class="min-w-0" aria-label="比赛发现">
      <div class="mb-3 flex items-center justify-between gap-3">
        <h2 class="font-serif text-xl font-semibold">比赛一览</h2>
        <p
          v-if="loading || (!error && response)"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          class="text-xs text-brand"
        >
          <template v-if="loading">统计中…</template>
          <template v-else-if="response">
            {{ response.totalCompetitions }} 项比赛 ·
            {{ response.totalStages }} 个赛段
          </template>
        </p>
      </div>
      <div v-if="loading" class="hhr-panel" role="status">
        正在加载比赛与学院目录…
      </div>
      <div v-else-if="error" class="hhr-panel" role="alert">
        <p>{{ error }}</p>
        <button type="button" class="hhr-button mt-4" @click="retry++">
          重试加载
        </button>
      </div>
      <div v-else-if="!entries.length" class="hhr-panel py-10 text-center">
        <h3 class="font-semibold">
          {{ noCollegesSelected ? "尚未选择学院" : "暂时没有匹配的比赛" }}
        </h3>
        <p class="mt-2 text-sm text-muted">
          {{
            noCollegesSelected
              ? "已取消全部学院，请选择承办学院或点击全部学院查看比赛。"
              : "试试其他学院或放宽筛选，学院入口仍可继续选择。"
          }}
        </p>
        <button
          type="button"
          class="hhr-button hhr-button--soft mt-4"
          @click="reset"
        >
          重置所有筛选
        </button>
      </div>
      <div v-else class="grid gap-3">
        <article
          v-for="{ competition, stage } in visible"
          :key="stage.id"
          class="hhr-card p-4"
          data-competition-card
        >
          <div class="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <span class="hhr-badge">{{ competition.category }}</span
            ><span class="text-muted">{{ competition.edition }}</span>
            <span class="hhr-badge hhr-badge--muted">{{
              originLabels[competition.origin]
            }}</span>
          </div>
          <h3 class="font-serif text-lg font-semibold">
            <RouterLink
              :to="{
                name: 'competition-detail',
                params: { id: competition.id },
                query: route.query,
                hash: '#' + stage.id,
              }"
              class="inline-block py-1 text-brand hover:underline"
              >{{ competition.name }}</RouterLink
            >
          </h3>
          <p class="mt-1 text-sm">{{ stage.name }}</p>
          <dl
            class="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs leading-5"
          >
            <dt class="text-muted">承办学院</dt>
            <dd>{{ collegeNames(stage.hosts) }}</dd>
            <dt class="text-muted">参赛范围</dt>
            <dd>{{ scopeLabel(stage.scope) }}</dd>
          </dl>
          <p class="mt-1 text-xs leading-5 text-muted">
            {{ stage.scope.note }}
          </p>
          <div class="mt-2 border-t border-line pt-2 text-xs">
            <span class="font-semibold text-brand">{{
              statuses[stage.status]
            }}</span>
            <p class="mt-1">
              报名截止：{{
                stage.conflict ? "时间待核对" : formatTime(stage.deadline)
              }}
            </p>
            <p v-if="stage.materialsAt.value">
              材料截止：{{
                materialDeadlineLabel(stage.materialsAt, response?.evaluatedAt)
              }}
            </p>
          </div>
        </article>
      </div>
      <nav
        v-if="entries.length"
        aria-label="比赛分页"
        class="mt-5 flex flex-wrap items-center justify-between gap-2"
      >
        <button
          type="button"
          class="hhr-button hhr-button--secondary"
          :disabled="filters.page <= 1"
          @click="update({}, filters.page - 1)"
        >
          上一页
        </button>
        <span class="text-xs text-muted"
          >第 {{ filters.page }} / {{ pages }} 页</span
        >
        <button
          type="button"
          class="hhr-button hhr-button--secondary"
          :disabled="filters.page >= pages"
          @click="update({}, filters.page + 1)"
        >
          下一页
        </button>
      </nav>
      <p class="mt-4 text-xs leading-6 text-muted">
        状态计算时间：{{
          formatEvaluatedAt(response?.evaluatedAt)
        }}（北京时间）。报名时段内不保证名额或资格通过，最新安排以官方通知为准。
      </p>
    </section>
  </div>
</template>

<style scoped>
.discovery-filter-control:focus-visible {
  outline-width: 2px;
  outline-offset: -2px;
}
.discovery-filter-control::placeholder {
  color: var(--hhr-color-muted);
  opacity: 1;
}
.discovery-status-select {
  color: var(--hhr-color-muted);
}
@media (max-width: 767px) {
  .discovery-heading {
    font-size: clamp(24px, 6vw, 30px);
    line-height: 1.5;
    text-wrap: balance;
  }
  .discovery-filters {
    gap: 8px;
  }
  .discovery-filter-control,
  .discovery-search-button {
    height: auto;
    min-height: 44px;
  }
  .discovery-filter-control {
    font-size: 16px;
  }
  .discovery-search-button {
    font-size: 14px;
  }
  .discovery-status-select,
  .discovery-filter-actions {
    grid-column: 1 / -1;
  }
  .discovery-filter-actions > div {
    width: 100%;
    gap: 12px;
  }
  .discovery-filter-actions button {
    flex: 1;
    min-height: 44px;
    font-size: 13px;
  }
}
</style>
