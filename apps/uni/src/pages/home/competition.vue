<script setup lang="ts">
import { pageRouteQuery } from "../../navigation/h5-address";
import { computed, nextTick, onScopeDispose, reactive, ref } from "vue";
import { onLoad, onReady } from "@dcloudio/uni-app";
import { usePageLifecycle } from "../../lifecycle/use-page-lifecycle";
import {
  collegeNames,
  formatTime,
  formatEvaluatedAt,
  materialDeadlineLabel,
  parseFilters,
  writeFilters,
  scopeLabel,
  statuses,
} from "@hehuoda/client-domain/competition-discovery";
import CompetitionSourceAction from "../../components/CompetitionSourceAction.vue";
import FormButton from "../../components/FormButton.vue";
import { useSessionStore } from "../../stores/session";
import { competitionApi } from "../../api/competitions";
import {
  createDetailController,
  initialDetailState,
} from "../../stores/detail-controller";
import {
  openTabWithQuery,
  returnToCompetitions,
} from "../../navigation/navigate";
import { resolveStageTarget } from "../../navigation/competition-detail";
import {
  copyRouteQuery,
  paramMessage,
  parseBusinessId,
  type RouteQuery,
} from "../../navigation/params";

const state = reactive(initialDetailState());
const session = useSessionStore();
const favoriteFeedback = ref("");
function toggleFavorite() {
  if (!state.detail) return;
  const target = state.detail.id;
  if (session.isFavorite(target)) {
    session.removeFavorite(target);
    favoriteFeedback.value = "已取消收藏。";
  } else {
    session.addFavorite(target);
    favoriteFeedback.value = "已收藏，仅在当前会话保留。";
  }
}
const controller = createDetailController(state, competitionApi);
const id = ref("");
const parameterError = ref("");
const stageFeedback = ref("");
const competition = computed(() => state.detail);
const originLabels = {
  official: "官方通知",
  historical: "官方历史信息",
  demo: "虚构交互样例",
};
const noticeLabels = {
  registration: "报名通知",
  supplement: "补充通知",
  award: "获奖公示",
  news: "新闻回顾",
};
let stage: unknown;
let sourceQuery: RouteQuery = {};
let ready = false;
let visible = false;
let positioning = 0;

async function locate() {
  if (!ready || !visible || !state.detail) return;
  const current = ++positioning;
  const target = resolveStageTarget(state.detail, stage);
  stageFeedback.value = target.message;
  if (!target.selector) return;
  await nextTick();
  if (current !== positioning || !visible || state.status !== "ready") return;
  uni.pageScrollTo({
    selector: target.selector,
    duration: 0,
    fail() {
      if (current === positioning && visible)
        stageFeedback.value =
          "暂时无法自动定位赛段，请在下方查看完整赛段说明。";
    },
  });
}
async function load() {
  if (!id.value) return;
  const current = ++positioning;
  stageFeedback.value = "";
  await controller.load(id.value);
  if (current === positioning) await locate();
}
function leave() {
  visible = false;
  favoriteFeedback.value = "";
  ++positioning;
  controller.cancel();
}
function returnToList() {
  returnToCompetitions(sourceQuery);
}
onLoad((platformQuery) => {
  const query = pageRouteQuery(platformQuery ?? {});
  ++positioning;
  controller.cancel();
  state.detail = null;
  state.status = "idle";
  const parsed = parseBusinessId(query?.id);
  parameterError.value = parsed.issue ? paramMessage(parsed.issue, "比赛") : "";
  id.value = parsed.issue ? "" : parsed.value;
  stage = query?.stage;
  sourceQuery = copyRouteQuery(
    writeFilters(query ?? {}, parseFilters(query ?? {})),
  );
  delete sourceQuery.id;
  delete sourceQuery.stage;
});
usePageLifecycle({
  show() {
    visible = true;
    if (state.status === "idle") void load();
  },
  hide: leave,
});
onReady(() => {
  ready = true;
  void locate();
});
const unregisterReset = session.registerReset(
  Symbol("competition-detail"),
  () => {
    ++positioning;
    controller.cancel();
    state.detail = null;
    state.status = "idle";
    favoriteFeedback.value = stageFeedback.value = "";
  },
);
onScopeDispose(unregisterReset);
</script>

<template>
  <view class="hhr-page detail-page">
    <view class="detail-inner">
      <view class="detail-navigation"
        ><FormButton variant="reveal" @click="returnToList"
          >← 返回比赛列表</FormButton
        ></view
      >
      <view v-if="parameterError" class="hhr-panel detail-panel" role="alert">
        <text class="detail-title">无法打开比赛详情</text
        ><text class="detail-paragraph">{{ parameterError }}</text>
      </view>
      <view
        v-else-if="state.status === 'loading' || state.status === 'idle'"
        class="hhr-panel detail-panel"
        role="status"
        >正在加载比赛详情…</view
      >
      <view
        v-else-if="state.status === 'error'"
        class="hhr-panel detail-panel"
        role="alert"
      >
        <text class="detail-paragraph">{{ state.error }}</text>
        <text v-if="state.requestId" class="detail-note"
          >请求编号：{{ state.requestId }}</text
        >
        <FormButton class="detail-retry" @click="load">重试加载</FormButton>
      </view>
      <view
        v-else-if="state.status === 'missing'"
        class="hhr-panel detail-panel"
      >
        <text class="detail-title">比赛不存在</text
        ><text class="detail-paragraph muted"
          >未找到这项比赛，比赛可能未公开或链接已失效。请返回列表重新选择。</text
        >
      </view>
      <template v-else-if="competition">
        <view class="detail-header">
          <view class="detail-tags"
            ><text class="hhr-badge">{{ competition.category }}</text
            ><text class="hhr-badge hhr-badge--muted">{{
              originLabels[competition.origin]
            }}</text></view
          >
          <text class="detail-edition muted">{{ competition.edition }}</text>
          <text class="detail-title">{{ competition.name }}</text>
          <text class="detail-paragraph"
            >主办 / 组织单位：{{ competition.organizer }}</text
          >
          <text class="detail-note"
            >状态计算时间：{{
              formatEvaluatedAt(competition.evaluatedAt)
            }}（北京时间）。报名时段内不保证名额或资格通过；最新安排请核对官方通知。</text
          >
        </view>
        <text
          v-if="stageFeedback"
          class="detail-location-feedback"
          role="status"
          >{{ stageFeedback }}</text
        >
        <view class="detail-sections">
          <view class="hhr-panel detail-panel">
            <text class="detail-heading" role="heading" aria-level="2"
              >赛道与人数要求</text
            >
            <text
              v-if="!competition.tracks.length"
              class="detail-paragraph muted"
              >赛道与人数要求待公布，请核对官方通知。</text
            >
            <view
              v-for="track in competition.tracks"
              :key="track.id"
              class="detail-article"
            >
              <text class="detail-subheading">{{ track.name }}</text
              ><text class="detail-members">{{ track.members }}</text>
              <text class="detail-rules muted">{{ track.rules }}</text
              ><text v-if="track.mode === 'individual'" class="detail-small"
                >个人赛，无需组队。</text
              >
            </view>
          </view>
          <view class="detail-stages">
            <text class="detail-heading" role="heading" aria-level="2"
              >赛段与报名说明</text
            >
            <text
              v-if="!competition.stages.length"
              class="detail-paragraph muted"
              >赛段安排待公布，请核对官方通知。</text
            >
            <view
              v-for="(item, index) in competition.stages"
              :id="`competition-stage-${index}`"
              :key="item.id"
              class="hhr-panel detail-panel"
            >
              <view class="detail-stage-header"
                ><text class="detail-subheading">{{ item.name }}</text
                ><text class="hhr-badge">{{
                  statuses[item.status]
                }}</text></view
              >
              <text class="detail-paragraph"
                >组织单位：{{ item.organizer }}</text
              >
              <text class="detail-fact"
                >承办学院：{{ collegeNames(item.hosts) }}</text
              >
              <text class="detail-fact"
                >参赛范围：{{ scopeLabel(item.scope) }}</text
              >
              <text class="detail-rules muted">{{ item.scope.note }}</text>
              <view class="detail-times">
                <text class="muted">报名开始</text
                ><text>{{
                  item.conflict ? "时间待核对" : formatTime(item.startsAt)
                }}</text>
                <text class="muted">报名截止</text
                ><text>{{
                  item.conflict ? "时间待核对" : formatTime(item.deadline)
                }}</text>
                <text class="muted">材料提交</text
                ><text>{{
                  materialDeadlineLabel(
                    item.materialsAt,
                    competition.evaluatedAt,
                  )
                }}</text>
                <text class="muted">比赛时间</text
                ><text>{{ formatTime(item.eventAt) }}</text>
              </view>
              <text v-if="item.timeNote" class="detail-note">{{
                item.timeNote
              }}</text>
              <text class="detail-registration-title">如何报名</text
              ><text class="detail-registration">{{ item.registration }}</text>
              <text class="detail-disclaimer"
                >平台组队不等于官方报名；学院范围匹配不表示已通过全部资格审核。</text
              >
              <view class="detail-stage-sources"
                ><CompetitionSourceAction
                  v-for="source in competition.notices.filter((n) =>
                    item.sourceIds.includes(n.id),
                  )"
                  :key="source.id"
                  :notice="source"
                  compact
              /></view>
            </view>
          </view>
          <view class="hhr-panel detail-panel">
            <text class="detail-heading" role="heading" aria-level="2"
              >来源与信息核对</text
            >
            <text
              v-if="!competition.notices.length"
              class="detail-paragraph muted"
              >{{
                competition.origin === "demo"
                  ? "此记录为虚构交互样例，没有官方来源或真实报名入口。"
                  : "暂未记录来源通知，请向组织单位核对报名安排。"
              }}</text
            >
            <view
              v-for="notice in competition.notices"
              :key="notice.id"
              class="detail-article"
            >
              <text class="detail-registration-title">{{ notice.title }}</text>
              <text class="detail-small muted"
                >{{ notice.publisher }} · {{ noticeLabels[notice.kind] }}</text
              >
              <text class="detail-source-date muted"
                >{{
                  notice.publishedAt
                    ? "发布：" + notice.publishedAt
                    : "发布日期未注明"
                }}
                ·
                {{
                  notice.checkedAt
                    ? "核对：" + notice.checkedAt
                    : "核对日期未记录"
                }}</text
              >
              <CompetitionSourceAction :notice="notice" />
            </view>
          </view>
          <view class="hhr-panel detail-panel">
            <text class="detail-heading" role="heading" aria-level="2"
              >收藏与组队</text
            >
            <text class="detail-paragraph muted"
              >收藏仅在当前会话保留，刷新、冷启动或重置后清空。平台组队不等于官方报名。</text
            >
            <text
              v-if="favoriteFeedback"
              class="detail-paragraph"
              role="status"
              aria-live="polite"
              >{{ favoriteFeedback }}</text
            >
            <view class="detail-actions"
              ><FormButton
                :variant="
                  session.isFavorite(competition.id) ? 'soft' : 'secondary'
                "
                :aria-pressed="session.isFavorite(competition.id)"
                @click="toggleFavorite"
                >{{
                  session.isFavorite(competition.id)
                    ? "已收藏 · 取消收藏"
                    : "收藏比赛"
                }}</FormButton
              ><FormButton
                variant="secondary"
                @click="
                  openTabWithQuery('teams', { competition: competition.id })
                "
                >查看关联演示招募</FormButton
              ></view
            >
          </view>
        </view>
      </template>
    </view>
  </view>
</template>

<style scoped>
/* 固定 px 对齐旧 Web 正文字号与留白；导航沿用 ADR 0005 的双端原生导航。 */
.detail-page {
  padding: 24px 20px calc(24px + env(safe-area-inset-bottom, 0px));
  font-size: 14px;
  line-height: 1.65;
}
.detail-inner {
  max-width: 1020px;
  margin: 0 auto;
}
.detail-navigation {
  margin-bottom: 20px;
}
.detail-navigation :deep(.hhr-button) {
  display: inline-flex;
  width: auto;
  margin: 0;
  padding: 0;
  min-height: 44px;
  font-size: 14px;
}
.detail-panel {
  padding: 22px;
  min-width: 0;
}
.detail-header {
  margin-bottom: 28px;
}
.detail-tags,
.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.detail-tags {
  margin-bottom: 12px;
}
.detail-tags .hhr-badge,
.detail-stage-header .hhr-badge {
  padding: 3px 8px;
  font-size: 11px;
  line-height: 1.65;
  white-space: normal;
}
.detail-edition {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  line-height: 20px;
}
.detail-title {
  display: block;
  font-family: var(--hhr-font-display);
  font-size: 24px;
  font-weight: 600;
  line-height: 1.625;
}
.detail-heading {
  display: block;
  font-family: var(--hhr-font-display);
  font-size: 20px;
  font-weight: 600;
  line-height: 1.4;
}
.detail-subheading {
  display: block;
  font-size: 14px;
  font-weight: 600;
  min-width: 0;
}
.detail-paragraph {
  display: block;
  margin-top: 12px;
  font-size: 14px;
  line-height: 20px;
}
.detail-fact {
  display: block;
  margin-top: 4px;
  font-size: 14px;
  line-height: 20px;
}
.detail-note {
  display: block;
  margin-top: 12px;
  font-size: 12px;
  line-height: 24px;
  color: var(--hhr-color-muted);
}
.detail-sections {
  display: grid;
  gap: 20px;
}
.detail-stages {
  display: grid;
  gap: 12px;
}
.detail-article {
  margin-top: 16px;
  border-top: 1px solid var(--hhr-color-line);
  padding-top: 16px;
}
.detail-members {
  display: block;
  margin-top: 4px;
  font-size: 14px;
  line-height: 20px;
  color: var(--hhr-color-brand);
}
.detail-rules,
.detail-registration {
  display: block;
  margin-top: 8px;
  font-size: 14px;
  line-height: 28px;
}
.detail-small {
  display: block;
  margin-top: 8px;
  font-size: 12px;
  line-height: 16px;
}
.detail-stage-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.detail-times {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px 16px;
  margin: 16px 0;
  padding: 16px 0;
  border-top: 1px solid var(--hhr-color-line);
  border-bottom: 1px solid var(--hhr-color-line);
  font-size: 14px;
  line-height: 20px;
}
.detail-registration-title {
  display: block;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
}
.detail-disclaimer {
  display: block;
  margin-top: 12px;
  font-size: 12px;
  line-height: 16px;
  color: var(--hhr-color-brand);
}
.detail-stage-sources {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 12px;
}
.detail-source-date {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  line-height: 16px;
}
.detail-actions {
  margin-top: 12px;
}
.detail-actions :deep(.hhr-button) {
  display: inline-flex;
  width: auto;
  font-size: 13px;
}
.detail-retry {
  margin-top: 16px;
}
.detail-location-feedback {
  display: block;
  margin-bottom: 20px;
  color: var(--hhr-color-brand);
  font-size: 14px;
}
.muted {
  color: var(--hhr-color-muted);
}
@media (min-width: 768px) {
  .detail-page {
    padding: 40px;
  }
}
</style>
