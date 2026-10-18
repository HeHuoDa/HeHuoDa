<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import { useRoute } from "vue-router";
import axios from "axios";
import type { CompetitionDetail } from "@hehuoda/api-types";
import { competitionApi, originLabels } from "../api/competitions";
import {
  collegeNames,
  formatTime,
  formatEvaluatedAt,
  materialDeadlineLabel,
  scopeLabel,
  statuses,
} from "../data/competition-discovery";
const route = useRoute();
const competition = ref<CompetitionDetail>();
const loading = ref(true);
const error = ref("");
const missing = ref(false);
const retry = ref(0);
const copyFeedback = ref("");
watch(
  () => [route.params.id, retry.value],
  async (_value, _old, onCleanup) => {
    const controller = new AbortController();
    let active = true;
    onCleanup(() => {
      active = false;
      controller.abort();
    });
    loading.value = true;
    error.value = "";
    missing.value = false;
    competition.value = undefined;
    copyFeedback.value = "";
    try {
      const data = await competitionApi.detail(
        String(route.params.id),
        controller.signal,
      );
      if (!active) return;
      competition.value = data;
      loading.value = false;
      await nextTick();
      if (!active) return;
      const anchor = route.hash.slice(1);
      if (anchor && data.stages.some((s) => s.id === anchor))
        document.getElementById(anchor)?.scrollIntoView?.({ block: "start" });
    } catch (failure) {
      if (active) {
        missing.value =
          axios.isAxiosError(failure) && failure.response?.status === 404;
        if (!missing.value)
          error.value = "比赛详情加载失败，请检查网络后重试。";
      }
    } finally {
      if (active) loading.value = false;
    }
  },
  { immediate: true },
);
async function copy(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    copyFeedback.value = "官方链接已复制。";
  } catch {
    copyFeedback.value = "暂时无法复制，请选中下方网址手动复制。";
  }
}
</script>
<template>
  <nav aria-label="页面相关入口" class="mb-5">
    <RouterLink
      :to="{ name: 'home', query: route.query }"
      class="inline-flex min-h-11 items-center text-sm text-brand"
      >← 返回比赛列表</RouterLink
    >
  </nav>
  <section v-if="loading" class="hhr-panel" role="status">
    正在加载比赛详情…
  </section>
  <section v-else-if="error" class="hhr-panel" role="alert">
    <p>{{ error }}</p>
    <button type="button" class="hhr-button mt-4" @click="retry++">
      重试加载
    </button>
  </section>
  <section v-else-if="missing" class="hhr-panel">
    <h1 class="font-serif text-2xl font-semibold">比赛不存在</h1>
    <p class="mt-3 text-muted">
      未找到这项比赛，链接可能已失效。请返回列表重新选择。
    </p>
  </section>
  <template v-else-if="competition">
    <header class="mb-7">
      <div class="mb-3 flex flex-wrap gap-2">
        <span class="hhr-badge">{{ competition.category }}</span
        ><span class="hhr-badge hhr-badge--muted">{{
          originLabels[competition.origin]
        }}</span>
      </div>
      <p class="mb-2 text-sm text-muted">{{ competition.edition }}</p>
      <h1 class="font-serif text-2xl font-semibold leading-relaxed">
        {{ competition.name }}
      </h1>
      <p class="mt-3 text-sm">主办 / 组织单位：{{ competition.organizer }}</p>
      <p class="mt-3 text-xs leading-6 text-muted">
        状态计算时间：{{
          formatEvaluatedAt(competition.evaluatedAt)
        }}（北京时间）。报名时段内不保证名额或资格通过；最新安排请核对官方通知。
      </p>
    </header>
    <div class="grid gap-5">
      <section class="hhr-panel" aria-labelledby="tracks-heading">
        <h2 id="tracks-heading" class="font-serif text-xl font-semibold">
          赛道与人数要求
        </h2>
        <article
          v-for="track in competition.tracks"
          :key="track.id"
          class="mt-4 border-t border-line pt-4"
        >
          <h3 class="font-semibold">{{ track.name }}</h3>
          <p class="mt-1 text-sm text-brand">{{ track.members }}</p>
          <p class="mt-2 text-sm leading-7 text-muted">{{ track.rules }}</p>
          <p v-if="track.mode === 'individual'" class="mt-2 text-xs">
            个人赛，无需组队。
          </p>
        </article>
      </section>
      <section aria-labelledby="stages-heading" class="grid gap-3">
        <h2 id="stages-heading" class="font-serif text-xl font-semibold">
          赛段与报名说明
        </h2>
        <article
          v-for="stage in competition.stages"
          :id="stage.id"
          :key="stage.id"
          class="hhr-panel scroll-mt-6"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="font-semibold">{{ stage.name }}</h3>
            <span class="hhr-badge">{{ statuses[stage.status] }}</span>
          </div>
          <p class="mt-3 text-sm">组织单位：{{ stage.organizer }}</p>
          <p class="mt-1 text-sm">承办学院：{{ collegeNames(stage.hosts) }}</p>
          <p class="mt-1 text-sm">参赛范围：{{ scopeLabel(stage.scope) }}</p>
          <p class="mt-2 text-sm leading-7 text-muted">
            {{ stage.scope.note }}
          </p>
          <dl
            class="my-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 border-y border-line py-4 text-sm"
          >
            <dt class="text-muted">报名开始</dt>
            <dd>
              {{ stage.conflict ? "时间待核对" : formatTime(stage.startsAt) }}
            </dd>
            <dt class="text-muted">报名截止</dt>
            <dd>
              {{ stage.conflict ? "时间待核对" : formatTime(stage.deadline) }}
            </dd>
            <dt class="text-muted">材料提交</dt>
            <dd>
              {{
                materialDeadlineLabel(
                  stage.materialsAt,
                  competition.evaluatedAt,
                )
              }}
            </dd>
            <dt class="text-muted">比赛时间</dt>
            <dd>
              {{ formatTime(stage.eventAt) }}
            </dd>
          </dl>
          <p v-if="stage.timeNote" class="mb-3 text-xs leading-6 text-muted">
            {{ stage.timeNote }}
          </p>
          <h4 class="text-sm font-semibold">如何报名</h4>
          <p class="mt-2 text-sm leading-7">{{ stage.registration }}</p>
          <p class="mt-3 text-xs text-brand">
            平台组队不等于官方报名；学院范围匹配不表示已通过全部资格审核。
          </p>
          <div class="mt-3 flex flex-wrap gap-x-4 gap-y-2">
            <template
              v-for="source in competition.notices.filter((n) =>
                stage.sourceIds.includes(n.id),
              )"
              :key="source.id"
            >
              <a
                :href="source.url"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex min-h-11 items-center text-xs text-brand underline"
                >{{ source.publisher }}原文（新窗口）</a
              >
            </template>
          </div>
        </article>
      </section>
      <section class="hhr-panel" aria-labelledby="sources-heading">
        <h2 id="sources-heading" class="font-serif text-xl font-semibold">
          来源与信息核对
        </h2>
        <p v-if="!competition.notices.length" class="mt-3 text-sm text-muted">
          此记录为虚构交互样例，没有官方来源或真实报名入口。
        </p>
        <article
          v-for="notice in competition.notices"
          :key="notice.id"
          class="mt-4 border-t border-line pt-4"
        >
          <h3 class="text-sm font-semibold">{{ notice.title }}</h3>
          <p class="mt-2 text-xs text-muted">
            {{ notice.publisher }} ·
            {{
              {
                registration: "报名通知",
                supplement: "补充通知",
                award: "获奖公示",
                news: "新闻回顾",
              }[notice.kind]
            }}
          </p>
          <p class="mt-1 text-xs text-muted">
            {{
              notice.publishedAt
                ? "发布：" + notice.publishedAt
                : "发布日期未注明"
            }}
            ·
            {{
              notice.checkedAt ? "核对：" + notice.checkedAt : "核对日期未记录"
            }}
          </p>
          <a
            :href="notice.url"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-2 block py-2 text-xs text-brand underline wrap-anywhere"
            >{{ notice.url }}（新窗口）</a
          >
          <button
            type="button"
            class="hhr-button hhr-button--secondary mt-1"
            @click="copy(notice.url)"
          >
            复制官方链接
          </button>
        </article>
        <p role="status" aria-live="polite" class="mt-3 text-xs text-brand">
          {{ copyFeedback }}
        </p>
      </section>
      <section class="hhr-panel" aria-labelledby="followup-heading">
        <h2 id="followup-heading" class="font-serif text-xl font-semibold">
          后续入口
        </h2>
        <p class="mt-3 text-sm text-muted">
          查看关联比赛的演示招募；收藏记录将在后续接入。平台组队不等于官方报名。
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled
            class="hhr-button hhr-button--secondary"
          >
            收藏 · 待接入
          </button>
          <RouterLink
            :to="{ name: 'teams', query: { competition: competition.id } }"
            class="hhr-button hhr-button--secondary"
          >
            查看关联演示招募
          </RouterLink>
        </div>
      </section>
    </div>
  </template>
</template>
