<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { onHide, onLoad, onShow, onUnload } from "@dcloudio/uni-app";
import {
  cooperationModes,
  projectTypes,
  recruitmentStatus,
  roleOptions,
  teamTime,
  type Team,
  type TeamFilters,
} from "@hehuoda/client-domain/team";
import FormButton from "../../components/FormButton.vue";
import FormInput from "../../components/FormInput.vue";
import FormPicker from "../../components/FormPicker.vue";
import { competitionApi } from "../../api/competitions";
import {
  createTeamListController,
  initialTeamListState,
} from "../../stores/team-list-controller";
import { openPage } from "../../navigation/navigate";
import { copyRouteQuery } from "../../navigation/params";
import { teamRouteQuery } from "../../navigation/team-query";
import { useNavigationStore } from "../../stores/navigation";
import { useSessionStore } from "../../stores/session";

const session = useSessionStore();
const navigation = useNavigationStore();
const state = reactive(initialTeamListState());
const controller = createTeamListController(state, {
  teams: () => session.teams,
  api: competitionApi,
});
const view = computed(() => controller.view());
const keyword = ref(state.filters.q);
const typeOptions = [
  { value: "", label: "全部类型" },
  ...Object.entries(projectTypes).map(([value, label]) => ({ value, label })),
];
const roleOptionList = [
  { value: "", label: "全部角色" },
  ...roleOptions.map((role) => ({ value: role, label: role })),
];
const modeOptions = [
  { value: "", label: "全部方式" },
  ...Object.entries(cooperationModes).map(([value, label]) => ({
    value,
    label,
  })),
];
const statusOptions = [
  { value: "", label: "全部状态" },
  { value: "available", label: "当前可申请" },
  { value: "unavailable", label: "当前不可申请" },
];

// 结果集变化（发布、重置、时间推进）后同步页码，跳转始终携带有效页。
watch(
  () => view.value.pages,
  () => controller.reconcilePage(),
);

function update(patch: Partial<TeamFilters>) {
  controller.update(patch);
  keyword.value = state.filters.q;
}
function submit() {
  update({ q: keyword.value.trim() });
}
function clearFilters() {
  controller.reset();
  keyword.value = "";
}
function clearCompetition() {
  update({ competition: "" });
}
function retryCompetition() {
  void controller.loadCompetition();
}
function resetDemo() {
  session.reset();
  controller.syncClock();
}
function statusLabel(team: Team) {
  return recruitmentStatus(team, state.now).label;
}
function trackName(team: Team) {
  return (
    team.competition?.tracks.find((track) => track.id === team.trackId)?.name ||
    "未选赛道"
  );
}
function openDetail(team: Team) {
  openPage("team-detail", { ...teamRouteQuery(state.filters), id: team.id });
}
function openPublish() {
  openPage("team-new", teamRouteQuery(state.filters));
}

onLoad((query) => {
  controller.restore(copyRouteQuery(query ?? {}));
  keyword.value = state.filters.q;
});
onShow(() => {
  const query = navigation.consumeTabQuery("teams");
  if (query) {
    controller.restore(query);
    keyword.value = state.filters.q;
  }
  controller.startClock();
  controller.syncClock();
  // 只补发被中断的请求；已落定的资料在返回时直接复用。
  if (state.filters.competition && state.competitionStatus === "idle")
    void controller.loadCompetition();
});
onHide(() => {
  controller.stopClock();
  controller.cancel();
});
onUnload(() => {
  controller.stopClock();
  controller.cancel();
});
</script>

<template>
  <view class="hhr-page hhr-page--tab team-page">
    <view class="team-inner">
      <view class="team-header">
        <view class="team-heading">
          <text class="hhr-eyebrow">GROW TOGETHER</text>
          <text class="team-title">找队友</text>
          <text class="team-intro"
            >从一个想法开始，找到愿意一起投入的伙伴。</text
          >
        </view>
        <FormButton class="team-publish" @click="openPublish"
          >发布招募</FormButton
        >
      </view>

      <view class="hhr-panel team-filters" role="search" aria-label="招募筛选">
        <view class="team-search">
          <FormInput
            id="team-search"
            v-model="keyword"
            label="关键词"
            class="team-search-field"
            :maxlength="100"
            placeholder="搜索标题、目标或角色"
            @confirm="submit"
          />
          <FormButton class="team-search-button" @click="submit"
            >搜索</FormButton
          >
        </view>
        <view class="team-filter-grid">
          <FormPicker
            id="team-type"
            label="项目类型"
            :model-value="state.filters.type"
            :options="typeOptions"
            @change="update({ type: $event })"
          />
          <FormPicker
            id="team-role"
            label="所需角色"
            :model-value="state.filters.role"
            :options="roleOptionList"
            @change="update({ role: $event })"
          />
          <FormPicker
            id="team-mode"
            label="合作方式"
            :model-value="state.filters.mode"
            :options="modeOptions"
            @change="update({ mode: $event })"
          />
          <FormPicker
            id="team-status"
            label="招募状态"
            :model-value="state.filters.status"
            :options="statusOptions"
            @change="update({ status: $event })"
          />
        </view>
        <view class="team-filter-footer">
          <text class="team-count" role="status" aria-live="polite"
            >{{ view.results.length }} 条演示招募 · 按发布时间倒序</text
          >
          <FormButton variant="secondary" @click="clearFilters"
            >清空筛选</FormButton
          >
        </view>
      </view>

      <view v-if="state.filters.competition" class="team-competition">
        <text
          v-if="state.competitionStatus === 'loading'"
          class="team-competition-text"
          role="status"
          >正在加载关联比赛…</text
        >
        <template v-else-if="state.competitionStatus === 'missing'">
          <text class="team-competition-text" role="alert"
            >{{ state.competitionError }} </text
          ><FormButton
            variant="secondary"
            class="team-competition-action"
            @click="clearCompetition"
            >清除比赛条件</FormButton
          >
        </template>
        <template v-else-if="state.competitionStatus === 'error'">
          <text class="team-competition-text" role="alert">{{
            state.competitionError
          }}</text>
          <text v-if="state.competitionRequestId" class="team-competition-meta"
            >请求编号：{{ state.competitionRequestId }}</text
          >
          <view class="team-competition-actions">
            <FormButton
              variant="secondary"
              class="team-competition-action"
              @click="retryCompetition"
              >重试比赛查询</FormButton
            >
            <FormButton
              variant="reveal"
              class="team-competition-action"
              @click="clearCompetition"
              >清除比赛条件</FormButton
            >
          </view>
        </template>
        <template v-else-if="state.competition">
          <text class="team-competition-text"
            >关联比赛资料：{{ state.competition.name }} ·
            {{ state.competition.edition }}；下方招募均为演示。</text
          >
          <FormButton
            variant="secondary"
            class="team-competition-action"
            @click="clearCompetition"
            >清除比赛条件</FormButton
          >
        </template>
      </view>

      <view v-if="view.visible.length" class="team-cards">
        <view
          v-for="team in view.visible"
          :key="team.id"
          class="hhr-card team-card"
          data-team-card
        >
          <view class="team-tags">
            <text class="hhr-badge">{{ projectTypes[team.type] }}</text>
            <text class="hhr-badge hhr-badge--warning"
              >{{ statusLabel(team) }} · 演示</text
            >
          </view>
          <FormButton
            variant="reveal"
            class="team-card-title"
            @click="openDetail(team)"
            >{{ team.title }}</FormButton
          >
          <text class="team-goal">{{ team.goal }}</text>
          <text class="team-line">角色缺口：{{ team.roles.join("、") }}</text>
          <text
            v-if="session.applications[team.id]"
            class="team-line team-line--brand"
            >演示申请待处理 · 成员人数不变</text
          >
          <text class="team-line">{{ cooperationModes[team.mode] }}</text>
          <text class="team-line"
            >成员 {{ team.members.length }}/{{ team.capacity }}（含队长） · 剩余
            {{ Math.max(0, team.capacity - team.members.length) }} 人</text
          >
          <text
            v-if="team.competition"
            class="team-line team-line--brand team-line--caption"
            >比赛资料：{{ team.competition.name }} ·
            {{ team.competition.edition }} · {{ trackName(team) }}</text
          >
          <text class="team-deadline"
            >招募截止：{{ teamTime(team.deadline) }}</text
          >
        </view>
      </view>
      <view v-else class="hhr-panel team-empty">
        <text class="team-empty-title">暂时没有匹配的演示招募</text>
        <text class="team-empty-description"
          >可以清空筛选，继续浏览普通项目。</text
        >
        <FormButton class="team-empty-action" @click="clearFilters"
          >清空筛选</FormButton
        >
      </view>

      <view
        v-if="view.pages > 1"
        class="team-pagination"
        role="navigation"
        aria-label="招募分页"
      >
        <FormButton
          variant="secondary"
          :disabled="view.page <= 1"
          @click="controller.page(view.page - 1)"
          >上一页</FormButton
        >
        <text>第 {{ view.page }} / {{ view.pages }} 页</text>
        <FormButton
          variant="secondary"
          :disabled="view.page >= view.pages"
          @click="controller.page(view.page + 1)"
          >下一页</FormButton
        >
      </view>

      <view class="team-reset">
        <text class="team-reset-note"
          >重置会恢复队伍、申请、邀请，以及资料与联系方式授权。</text
        >
        <FormButton
          variant="secondary"
          class="team-reset-button"
          @click="resetDemo"
          >重置演示</FormButton
        >
      </view>
    </view>
  </view>
</template>

<style scoped>
/* 固定 px 对齐旧 Web 的字号与留白；移动端优先，桌面端只扩列。 */
.team-page {
  padding: 24px 20px calc(24px + env(safe-area-inset-bottom, 0px));
  font-size: 14px;
  line-height: 1.65;
}
.team-inner {
  max-width: 1020px;
  margin: 0 auto;
}
.team-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 20px;
}
.team-heading {
  min-width: 0;
}
.team-title {
  display: block;
  margin-top: 8px;
  font-family: var(--hhr-font-display);
  font-size: 28px;
  font-weight: 600;
  line-height: 1.35;
}
.team-intro {
  display: block;
  margin-top: 12px;
  font-size: 14px;
  line-height: 1.65;
  color: var(--hhr-color-muted);
}
.team-publish {
  width: fit-content;
}
.team-filters {
  padding: 12px;
  margin-bottom: 16px;
}
.team-search {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.team-search-field {
  flex: 1;
  min-width: 0;
}
.team-search :deep(.hhr-button) {
  flex-shrink: 0;
  width: auto;
  padding: 0 18px;
}
.team-filter-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 8px;
}
.team-filter-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
}
.team-filter-footer :deep(.hhr-button) {
  width: auto;
  padding: 10px 18px;
  font-size: 13px;
}
.team-count {
  font-size: 12px;
  line-height: 1.6;
  color: var(--hhr-color-muted);
}
.team-competition {
  margin-bottom: 16px;
  border: 1px solid var(--hhr-color-line);
  border-radius: var(--hhr-radius-control);
  background: var(--hhr-color-surface);
  padding: 12px;
  font-size: 14px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}
.team-competition-text {
  display: block;
}
.team-competition-meta {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: var(--hhr-color-muted);
}
.team-competition-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.team-competition-action {
  width: fit-content;
  margin-top: 8px;
  padding: 10px 18px;
  font-size: 13px;
}
.team-competition-actions .team-competition-action {
  margin-top: 0;
}
.team-cards {
  display: grid;
  gap: 16px;
}
.team-card {
  min-width: 0;
  padding: 20px;
  overflow-wrap: anywhere;
}
.team-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.team-card-title {
  display: block;
  min-height: 44px;
  margin: 0;
  padding: 4px 0;
  font-family: var(--hhr-font-display);
  font-size: 18px;
  font-weight: 600;
  line-height: 1.5;
  text-align: left;
  white-space: normal;
  color: var(--hhr-color-brand);
  text-decoration: underline;
  text-underline-offset: 4px;
}
.team-goal {
  display: -webkit-box;
  margin-top: 12px;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 14px;
  line-height: 28px;
  color: var(--hhr-color-muted);
  overflow-wrap: anywhere;
}
.team-line {
  display: block;
  margin-top: 12px;
  font-size: 14px;
  line-height: 1.65;
}
.team-line--brand {
  color: var(--hhr-color-brand);
}
.team-line--caption {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.6;
}
.team-deadline {
  display: block;
  margin-top: 16px;
  border-top: 1px solid var(--hhr-color-line);
  padding-top: 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--hhr-color-muted);
}
.team-empty {
  padding: 40px 24px;
  text-align: center;
}
.team-empty-title {
  display: block;
  font-family: var(--hhr-font-display);
  font-size: 20px;
  font-weight: 600;
}
.team-empty-description {
  display: block;
  margin-top: 12px;
  font-size: 14px;
  color: var(--hhr-color-muted);
}
.team-empty-action {
  width: fit-content;
  margin: 16px auto 0;
}
.team-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 24px;
  font-size: 14px;
  color: var(--hhr-color-muted);
}
.team-pagination :deep(.hhr-button) {
  width: auto;
  padding: 10px 18px;
  font-size: 14px;
}
.team-reset {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  margin-top: 20px;
}
.team-reset-note {
  font-size: 12px;
  line-height: 1.6;
  color: var(--hhr-color-muted);
  text-align: right;
}
.team-reset-button {
  width: fit-content;
}
@media (min-width: 640px) {
  .team-filters {
    padding: 24px;
    margin-bottom: 24px;
  }
  .team-filter-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
    margin-top: 16px;
  }
  .team-filter-footer {
    margin-top: 16px;
  }
  .team-header {
    flex-direction: row;
    align-items: flex-end;
    justify-content: space-between;
  }
}
@media (min-width: 900px) {
  .team-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
