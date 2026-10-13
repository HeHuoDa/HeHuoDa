<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import type { CompetitionDetail, CompetitionList } from "@hehuoren/api-types";
import { competitionApi, originLabels } from "../api/competitions";
import { formatTime } from "../data/competition-discovery";
const props = defineProps<{
  competition?: CompetitionDetail;
  trackId: string;
}>();
const emit = defineEmits<{
  select: [competition: CompetitionDetail | undefined];
  track: [id: string];
  busy: [value: boolean];
}>();
const keyword = ref(""),
  query = ref(""),
  page = ref(1),
  retry = ref(0);
const items = ref<CompetitionList["items"]>([]),
  hasMore = ref(false),
  searched = ref(false),
  loading = ref(false),
  error = ref("");
const selecting = ref(false),
  selectionError = ref(""),
  selectedId = ref("");
let selectionController: AbortController | undefined,
  selectionVersion = 0;
const unique = computed(() => [
  ...new Map(
    items.value.map((i) => [i.competition.id, i.competition]),
  ).values(),
]);
watch(
  () => selecting.value || (!!selectedId.value && !props.competition),
  (busy) => emit("busy", busy),
  { flush: "sync" },
);
watch(
  () => [query.value, page.value, retry.value],
  async (_, _old, onCleanup) => {
    const controller = new AbortController();
    let active = true;
    onCleanup(() => {
      active = false;
      controller.abort();
    });
    loading.value = true;
    error.value = "";
    if (page.value === 1) {
      items.value = [];
      hasMore.value = false;
    }
    try {
      const result = await competitionApi.list(
        { hosts: "all", q: query.value, status: "", page: page.value },
        controller.signal,
      );
      if (active) {
        items.value =
          page.value === 1 ? result.items : [...items.value, ...result.items];
        hasMore.value = result.hasMore;
        searched.value = true;
      }
    } catch {
      if (active) error.value = "比赛查询失败，没有使用样例替代。请重试。";
    } finally {
      if (active) loading.value = false;
    }
  },
  { immediate: true },
);
function search() {
  query.value = keyword.value.trim();
  page.value = 1;
  retry.value++;
}
async function select(id: string) {
  selectedId.value = id;
  selectionController?.abort();
  const version = ++selectionVersion;
  selecting.value = false;
  selectionError.value = "";
  emit("select", undefined);
  emit("track", "");
  if (!id) return;
  const controller = (selectionController = new AbortController());
  selecting.value = true;
  try {
    const detail = await competitionApi.detail(id, controller.signal);
    if (version === selectionVersion) emit("select", detail);
  } catch {
    if (version === selectionVersion)
      selectionError.value = "比赛详情加载失败，请重试或清除比赛。";
  } finally {
    if (version === selectionVersion) selecting.value = false;
  }
}
onUnmounted(() => {
  ++selectionVersion;
  selectionController?.abort();
  emit("busy", false);
});
</script>
<template>
  <section
    class="rounded-control border border-line p-4"
    aria-labelledby="competition-picker-heading"
  >
    <h3 id="competition-picker-heading" class="font-semibold">
      关联比赛（选填）
    </h3>
    <p class="mt-2 text-xs leading-6 text-muted">
      普通项目可直接发布。真实比赛资料来自公开接口；关联比赛不代表参赛资格通过。
    </p>
    <div class="mt-3 flex flex-col gap-2 sm:flex-row">
      <div class="min-w-0 flex-1">
        <label for="competition-search" class="text-sm">查找比赛</label
        ><input
          id="competition-search"
          v-model="keyword"
          class="hhr-input mt-2"
          maxlength="100"
          placeholder="比赛名称关键词"
          @keydown.enter.prevent="search"
        />
      </div>
      <button type="button" class="hhr-button sm:self-end" @click="search">
        查询比赛
      </button>
    </div>
    <div v-if="error" role="alert" class="mt-3 text-sm text-danger">
      <p>{{ error }}</p>
      <button
        type="button"
        class="hhr-button hhr-button--secondary mt-2"
        @click="retry++"
      >
        重试比赛查询
      </button>
    </div>
    <p v-if="loading" role="status" class="mt-3 text-sm">正在查询真实比赛…</p>
    <p
      v-else-if="searched && !error && !unique.length"
      class="mt-3 text-sm text-muted"
    >
      没有找到比赛，请更换关键词。
    </p>
    <label for="competition-select" class="mt-4 block text-sm">比赛届次</label
    ><select
      id="competition-select"
      class="hhr-input mt-2"
      :value="selectedId"
      @change="select(($event.target as HTMLSelectElement).value)"
    >
      <option value="">不关联比赛</option>
      <option
        v-if="
          props.competition &&
          !unique.some((c) => c.id === props.competition?.id)
        "
        :value="props.competition.id"
      >
        {{ props.competition.name }} · {{ props.competition.edition }}
      </option>
      <option v-for="c in unique" :key="c.id" :value="c.id">
        {{ c.name }} · {{ c.edition }} · {{ originLabels[c.origin] }}
      </option>
    </select>
    <button
      v-if="hasMore"
      type="button"
      class="hhr-button hhr-button--secondary mt-3"
      :disabled="loading || !!error"
      @click="page++"
    >
      加载更多比赛
    </button>
    <p v-if="selecting" role="status" class="mt-3 text-sm">
      正在加载所选比赛详情…
    </p>
    <div v-if="selectionError" role="alert" class="mt-3 text-sm text-danger">
      <p>{{ selectionError }}</p>
      <button
        type="button"
        class="hhr-button hhr-button--secondary mt-2"
        @click="select(selectedId)"
      >
        重试比赛详情</button
      ><button
        type="button"
        class="hhr-button hhr-button--secondary mt-2 ml-2"
        @click="select('')"
      >
        清除比赛
      </button>
    </div>
    <template v-if="props.competition">
      <label for="trackId" class="mt-4 block text-sm">赛道（选填）</label
      ><select
        id="trackId"
        class="hhr-input mt-2"
        :value="trackId"
        @change="emit('track', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">未选赛道</option>
        <option v-for="t in props.competition.tracks" :key="t.id" :value="t.id">
          {{ t.name }}
        </option>
      </select>
      <p
        v-for="track in props.competition.tracks.filter(
          (t) => t.id === trackId,
        )"
        :key="track.id"
        class="mt-3 text-sm leading-7"
      >
        {{ track.members }} · {{ track.rules }}
      </p>
      <p
        v-for="stage in props.competition.stages"
        :key="stage.id"
        class="mt-2 text-xs text-muted"
      >
        {{ stage.name }}官方报名截止：{{
          stage.conflict ? "时间待核对" : formatTime(stage.deadline)
        }}
      </p>
      <p class="mt-2 text-xs text-muted">
        以上官方时间不自动用作招募截止，平台组队不等于官方比赛报名。
      </p>
      <button
        type="button"
        class="hhr-button hhr-button--secondary mt-3"
        @click="select('')"
      >
        清除比赛
      </button>
    </template>
  </section>
</template>
