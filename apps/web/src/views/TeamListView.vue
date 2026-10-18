<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter, stringifyQuery } from "vue-router";
import type { CompetitionDetail } from "@hehuoda/api-types";
import { competitionApi } from "../api/competitions";
import TeamDemoReset from "../components/TeamDemoReset.vue";
import { useTeamClock } from "../data/team-clock";
import {
  useTeamDemoStore,
  projectTypes,
  cooperationModes,
  roleOptions,
  parseTeamFilters,
  writeTeamFilters,
  filterTeams,
  recruitmentStatus,
  teamTime,
  TEAM_PAGE_SIZE,
  type TeamFilters,
} from "../data/team-demo";
const route = useRoute(),
  router = useRouter(),
  store = useTeamDemoStore(),
  now = useTeamClock();
const filters = computed(() => parseTeamFilters(route.query));
const keyword = ref(filters.value.q);
watch(
  () => filters.value.q,
  (v) => {
    keyword.value = v;
  },
);
const results = computed(() =>
  filterTeams(store.teams, filters.value, now.value),
);
const pages = computed(() =>
  Math.max(1, Math.ceil(results.value.length / TEAM_PAGE_SIZE)),
);
const page = computed(() => Math.min(filters.value.page, pages.value));
const visible = computed(() =>
  results.value.slice(
    (page.value - 1) * TEAM_PAGE_SIZE,
    page.value * TEAM_PAGE_SIZE,
  ),
);
watch(
  [() => filters.value.page, pages],
  () => {
    if (filters.value.page !== page.value)
      void router.replace({
        query: writeTeamFilters(route.query, {
          ...filters.value,
          page: page.value,
        }),
      });
  },
  { immediate: true },
);
function update(patch: Partial<TeamFilters>) {
  const next = writeTeamFilters(route.query, {
    ...filters.value,
    page: 1,
    ...patch,
  });
  if (stringifyQuery(next) !== stringifyQuery(route.query))
    void router.push({ query: next });
}
const competition = ref<CompetitionDetail>(),
  competitionError = ref(""),
  competitionLoading = ref(false),
  retry = ref(0);
watch(
  () => [filters.value.competition, retry.value],
  async (_, _old, onCleanup) => {
    const controller = new AbortController();
    let active = true;
    onCleanup(() => {
      active = false;
      controller.abort();
    });
    competition.value = undefined;
    competitionError.value = "";
    competitionLoading.value = false;
    if (!filters.value.competition) return;
    competitionLoading.value = true;
    try {
      const data = await competitionApi.detail(
        filters.value.competition,
        controller.signal,
      );
      if (active) competition.value = data;
    } catch {
      if (active)
        competitionError.value = "关联比赛加载失败或不存在，可重试或清除条件。";
    } finally {
      if (active) competitionLoading.value = false;
    }
  },
  { immediate: true },
);
</script>
<template>
  <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div>
      <p class="hhr-eyebrow mb-2">GROW TOGETHER</p>
      <h1 class="font-serif text-3xl font-semibold">找队友</h1>
      <p class="mt-3 text-sm text-muted">
        从一个想法开始，找到愿意一起投入的伙伴。
      </p>
    </div>
    <RouterLink
      :to="{ name: 'team-new', query: route.query }"
      class="hhr-button"
      >发布招募</RouterLink
    >
  </header>

  <section class="hhr-panel mb-4 p-3 sm:mb-6 sm:p-6" aria-label="招募筛选">
    <form class="flex gap-2" @submit.prevent="update({ q: keyword.trim() })">
      <div class="min-w-0 flex-1">
        <label
          for="team-search"
          class="sr-only sm:mb-2 sm:block sm:not-sr-only sm:text-sm"
          >关键词</label
        ><input
          id="team-search"
          v-model="keyword"
          class="hhr-input h-11 py-2 sm:h-auto sm:py-[11px]"
          placeholder="搜索标题、目标或角色"
          maxlength="100"
        />
      </div>
      <button type="submit" class="hhr-button self-end">搜索</button>
    </form>
    <div class="mt-2 grid grid-cols-2 gap-2 sm:mt-4 sm:gap-4 lg:grid-cols-4">
      <label class="text-sm"
        ><span class="sr-only sm:not-sr-only">项目类型</span
        ><select
          class="hhr-input h-11 py-2 sm:mt-2 sm:h-auto sm:py-[11px]"
          :value="filters.type"
          @change="update({ type: ($event.target as HTMLSelectElement).value })"
        >
          <option value="">全部类型</option>
          <option v-for="(label, key) in projectTypes" :key="key" :value="key">
            {{ label }}
          </option>
        </select></label
      >
      <label class="text-sm"
        ><span class="sr-only sm:not-sr-only">所需角色</span
        ><select
          class="hhr-input h-11 py-2 sm:mt-2 sm:h-auto sm:py-[11px]"
          :value="filters.role"
          @change="update({ role: ($event.target as HTMLSelectElement).value })"
        >
          <option value="">全部角色</option>
          <option v-for="role in roleOptions" :key="role">{{ role }}</option>
        </select></label
      >
      <label class="text-sm"
        ><span class="sr-only sm:not-sr-only">合作方式</span
        ><select
          class="hhr-input h-11 py-2 sm:mt-2 sm:h-auto sm:py-[11px]"
          :value="filters.mode"
          @change="update({ mode: ($event.target as HTMLSelectElement).value })"
        >
          <option value="">全部方式</option>
          <option
            v-for="(label, key) in cooperationModes"
            :key="key"
            :value="key"
          >
            {{ label }}
          </option>
        </select></label
      >
      <label class="text-sm"
        ><span class="sr-only sm:not-sr-only">招募状态</span
        ><select
          class="hhr-input h-11 py-2 sm:mt-2 sm:h-auto sm:py-[11px]"
          :value="filters.status"
          @change="
            update({ status: ($event.target as HTMLSelectElement).value })
          "
        >
          <option value="">全部状态</option>
          <option value="available">当前可申请</option>
          <option value="unavailable">当前不可申请</option>
        </select></label
      >
    </div>
    <div class="mt-2 flex items-center justify-between gap-2 sm:mt-4">
      <p role="status" aria-live="polite" class="text-xs text-muted sm:text-sm">
        {{ results.length }} 条演示招募<span class="hidden sm:inline">
          · 按发布时间倒序</span
        >
      </p>
      <button
        type="button"
        class="hhr-button hhr-button--secondary"
        @click="
          update({
            q: '',
            type: '',
            role: '',
            mode: '',
            status: '',
            competition: '',
          })
        "
      >
        清空筛选
      </button>
    </div>
  </section>
  <div
    v-if="filters.competition"
    class="mb-4 rounded-control border border-line bg-surface p-3 text-sm"
  >
    <p v-if="competitionLoading" role="status">正在加载关联比赛…</p>
    <div v-else-if="competitionError" role="alert">
      <p>{{ competitionError }}</p>
      <button
        type="button"
        class="hhr-button hhr-button--secondary mt-2"
        @click="retry++"
      >
        重试比赛查询
      </button>
    </div>
    <p v-else-if="competition">
      关联比赛资料：{{ competition.name }} ·
      {{ competition.edition }}；下方招募均为演示。
    </p>
    <button
      type="button"
      class="hhr-button hhr-button--secondary mt-2"
      @click="update({ competition: '' })"
    >
      清除比赛条件
    </button>
  </div>

  <div v-if="visible.length" class="grid gap-4 lg:grid-cols-2">
    <article
      v-for="team in visible"
      :key="team.id"
      class="hhr-card min-w-0 p-5"
      data-team-card
    >
      <div class="mb-3 flex flex-wrap justify-between gap-2">
        <span class="hhr-badge">{{ projectTypes[team.type] }}</span
        ><span class="hhr-badge hhr-badge--warning"
          >{{ recruitmentStatus(team, now).label }} · 演示</span
        >
      </div>
      <h2 class="font-serif text-xl font-semibold wrap-anywhere">
        <RouterLink
          :to="{
            name: 'team-detail',
            params: { id: team.id },
            query: route.query,
          }"
          class="text-brand underline decoration-line underline-offset-4"
          >{{ team.title }}</RouterLink
        >
      </h2>
      <p class="mt-3 line-clamp-2 text-sm leading-7 text-muted wrap-anywhere">
        {{ team.goal }}
      </p>
      <p class="mt-3 text-sm">角色缺口：{{ team.roles.join("、") }}</p>
      <p v-if="store.applications[team.id]" class="mt-2 text-sm text-brand">
        演示申请待处理 · 成员人数不变
      </p>
      <p class="mt-2 text-sm">
        {{ cooperationModes[team.mode] }}
      </p>
      <p class="mt-2 text-sm">
        成员 {{ team.members.length }}/{{ team.capacity }}（含队长） · 剩余
        {{ Math.max(0, team.capacity - team.members.length) }} 人
      </p>
      <p v-if="team.competition" class="mt-2 text-xs text-brand">
        比赛资料：{{ team.competition.name }} · {{ team.competition.edition }} ·
        {{
          team.competition.tracks.find((t) => t.id === team.trackId)?.name ||
          "未选赛道"
        }}
      </p>
      <p class="mt-4 border-t border-line pt-3 text-xs text-muted">
        招募截止：{{ teamTime(team.deadline) }}
      </p>
    </article>
  </div>
  <section v-else class="hhr-panel py-10 text-center">
    <h2 class="font-serif text-xl">暂时没有匹配的演示招募</h2>
    <p class="mt-3 text-sm text-muted">可以清空筛选，继续浏览普通项目。</p>
    <button
      type="button"
      class="hhr-button mt-4"
      @click="
        update({
          q: '',
          type: '',
          role: '',
          mode: '',
          status: '',
          competition: '',
        })
      "
    >
      清空筛选
    </button>
  </section>
  <nav
    v-if="pages > 1"
    aria-label="招募分页"
    class="mt-6 flex flex-wrap items-center justify-center gap-3"
  >
    <button
      type="button"
      class="hhr-button hhr-button--secondary"
      :disabled="page === 1"
      @click="update({ page: page - 1 })"
    >
      上一页
    </button>
    <span class="text-sm">第 {{ page }} / {{ pages }} 页</span>
    <button
      type="button"
      class="hhr-button hhr-button--secondary"
      :disabled="page === pages"
      @click="update({ page: page + 1 })"
    >
      下一页
    </button>
  </nav>
  <TeamDemoReset />
</template>
