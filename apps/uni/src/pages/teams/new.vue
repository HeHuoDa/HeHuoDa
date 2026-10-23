<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref } from "vue";
import { onLoad, onUnload } from "@dcloudio/uni-app";
import { usePageLifecycle } from "../../lifecycle/use-page-lifecycle";
import {
  projectTypes,
  cooperationModes,
  roleOptions,
  type Role,
} from "@hehuoda/client-domain/team";
import { formatTime } from "@hehuoda/client-domain/competition-discovery";
import FormButton from "../../components/FormButton.vue";
import FormInput from "../../components/FormInput.vue";
import FormPicker from "../../components/FormPicker.vue";
import FormDateTime from "../../components/FormDateTime.vue";
import { competitionApi } from "../../api/competitions";
import {
  openPage,
  replacePage,
  returnToTeams,
} from "../../navigation/navigate";
import type { RouteQuery } from "../../navigation/params";
import {
  parseTeamRouteQuery,
  teamRouteQuery,
} from "../../navigation/team-query";
import { useSessionStore } from "../../stores/session";
import {
  createTeamPublishController,
  initialTeamPublishState,
} from "../../stores/team-publish-controller";

const session = useSessionStore();
const originLabels = {
  official: "官方通知",
  historical: "历史信息",
  demo: "演示信息",
};
const state = reactive(initialTeamPublishState());
const controller = createTeamPublishController(state, session, competitionApi);
const focusField = ref("");
let sourceQuery: RouteQuery = {};
let active = true;
const unregisterReset = session.registerReset(Symbol("team-publish"), () => {
  controller.reset();
  focusField.value = "";
});
const unique = computed(() => [
  ...new Map(
    state.items.map((item) => [item.competition.id, item.competition]),
  ).values(),
]);
const competitionOptions = computed(() => {
  const options = unique.value.map((c) => ({
    value: c.id,
    label: `${c.name} · ${c.edition} · ${originLabels[c.origin]}`,
  }));
  if (state.selectedId && !options.some((c) => c.value === state.selectedId))
    options.unshift({
      value: state.selectedId,
      label: state.draft.competition
        ? `${state.draft.competition.name} · ${state.draft.competition.edition}`
        : "所选比赛（待确认）",
    });
  return [{ value: "", label: "不关联比赛" }, ...options];
});
const trackOptions = computed(() => [
  { value: "", label: "未选赛道" },
  ...(state.draft.competition?.tracks.map((t) => ({
    value: t.id,
    label: t.name,
  })) ?? []),
]);
const selectedTrack = computed(() =>
  state.draft.competition?.tracks.find((t) => t.id === state.draft.trackId),
);
const typeOptions = [
  { value: "", label: "请选择项目类型" },
  ...Object.entries(projectTypes).map(([value, label]) => ({ value, label })),
];
const modeOptions = [
  { value: "", label: "请选择合作方式" },
  ...Object.entries(cooperationModes).map(([value, label]) => ({
    value,
    label,
  })),
];
const fields = [
  {
    key: "title",
    label: "招募标题",
    max: 60,
    section: "intro",
    placeholder: "例如：一起做校园植物图鉴",
  },
  {
    key: "goal",
    label: "目标介绍（10–2000 字）",
    max: 2000,
    section: "intro",
    multiline: true,
  },
  {
    key: "progress",
    label: "当前进度（选填）",
    max: 500,
    section: "intro",
    multiline: true,
  },
  {
    key: "skills",
    label: "技能与具体职责（选填）",
    max: 500,
    section: "needs",
    multiline: true,
  },
  {
    key: "location",
    label: "线下地点说明（线上可留空）",
    max: 200,
    section: "needs",
  },
] as const;
const sections = [
  {
    key: "intro",
    title: "01 项目介绍",
    description: "讲清你们准备做什么，以及目前走到了哪一步。",
  },
  {
    key: "needs",
    title: "02 合作需求",
    description: "让伙伴了解角色缺口、技能需求和合作方式。",
  },
  {
    key: "settings",
    title: "03 招募设置",
    description: "确定队伍人数和招募时间，也可以关联比赛。",
  },
];
function toggleRole(role: Role) {
  if (state.submitting || state.publishedId) return;
  state.draft.roles = state.draft.roles.includes(role)
    ? state.draft.roles.filter((value) => value !== role)
    : [...state.draft.roles, role];
}
async function submit() {
  const revision = session.sessionRevision;
  const team = await controller.submit();
  if (!active || revision !== session.sessionRevision) return;
  if (team) {
    // 替换发布页；导航失败时保留显式详情入口，不允许再次建队。
    replacePage("team-detail", { ...sourceQuery, id: team.id });
    return;
  }
  focusField.value = "";
  await nextTick();
  if (!active || revision !== session.sessionRevision) return;
  focusField.value = Object.keys(state.errors)[0] ?? "";
  if (focusField.value)
    uni.pageScrollTo({
      selector: `#publish-${focusField.value}`,
      duration: 200,
    });
}
function returnToList() {
  returnToTeams(sourceQuery);
}
function resetDemo() {
  session.reset();
}
function hide() {
  active = false;
  controller.cancel();
}
onLoad((query) => {
  sourceQuery = teamRouteQuery(parseTeamRouteQuery(query ?? {}));
});
usePageLifecycle({
  show() {
    active = true;
    if (state.searchStatus === "idle") void controller.retrySearch();
    if (state.selectedId && state.selectionStatus === "idle")
      void controller.select(state.selectedId);
  },
  hide,
});
function dispose() {
  hide();
  unregisterReset();
}
// 页面栈卸载与 HMR/组件卸载均清理；重复调用安全。
onUnload(dispose);
onUnmounted(dispose);
</script>

<template>
  <view class="hhr-page publish-page">
    <view class="publish-inner">
      <FormButton class="back-link" variant="soft" @click="returnToList"
        >← 返回找队友列表</FormButton
      >
      <view class="publish-header">
        <text class="hhr-eyebrow">START SOMETHING</text>
        <text class="publish-title">发布招募</text>
        <text class="header-copy">把想法写下来，邀请伙伴一起完成。</text>
      </view>
      <view v-if="state.publishedId" class="hhr-notice">
        <text>已在当前会话演示发布，请勿重复提交。</text>
        <FormButton
          @click="
            openPage('team-detail', { ...sourceQuery, id: state.publishedId })
          "
          >查看已发布队伍</FormButton
        >
      </view>
      <view class="publish-form">
        <view
          v-for="section in sections"
          :key="section.key"
          class="hhr-panel publish-panel"
        >
          <text class="section-title">{{ section.title }}</text>
          <text class="section-copy">{{ section.description }}</text>
          <view v-if="section.key === 'intro'" id="publish-type">
            <FormPicker
              id="publish-type-control"
              v-model="state.draft.type"
              label="项目类型"
              :options="typeOptions"
              :error="state.errors.type"
              :focus="focusField === 'type'"
              :disabled="state.submitting || !!state.publishedId"
            />
          </view>
          <view
            v-if="section.key === 'needs'"
            id="publish-roles"
            class="roles-field"
          >
            <text class="field-label">角色需求（至少一项）</text>
            <view class="role-options">
              <FormButton
                v-for="role in roleOptions"
                :key="role"
                class="role-option"
                variant="secondary"
                :disabled="state.submitting || !!state.publishedId"
                :aria-label="`角色需求：${role}`"
                :aria-pressed="state.draft.roles.includes(role)"
                @click="toggleRole(role)"
              >
                <text
                  class="role-check"
                  :class="{ 'is-checked': state.draft.roles.includes(role) }"
                  aria-hidden="true"
                  >{{ state.draft.roles.includes(role) ? "✓" : "" }}</text
                >{{ role }}
              </FormButton>
            </view>
            <text
              v-if="state.errors.roles"
              class="hhr-form-error"
              role="alert"
              >{{ state.errors.roles }}</text
            >
          </view>
          <template
            v-for="field in fields.filter((f) => f.section === section.key)"
            :key="field.key"
          >
            <view v-if="field.key === 'location'" id="publish-mode">
              <FormPicker
                id="publish-mode-control"
                v-model="state.draft.mode"
                label="合作方式"
                :options="modeOptions"
                :error="state.errors.mode"
                :focus="focusField === 'mode'"
                :disabled="state.submitting || !!state.publishedId"
              />
            </view>
            <view :id="`publish-${field.key}`" :class="`field-${field.key}`">
              <FormInput
                :id="`publish-${field.key}-control`"
                v-model="state.draft[field.key]"
                :label="field.label"
                :maxlength="field.max"
                :multiline="'multiline' in field"
                :placeholder="'placeholder' in field ? field.placeholder : ''"
                :error="state.errors[field.key]"
                :focus="focusField === field.key"
                :disabled="state.submitting || !!state.publishedId"
              />
            </view>
          </template>
          <template v-if="section.key === 'settings'">
            <view id="publish-capacity"
              ><FormInput
                id="publish-capacity-control"
                v-model="state.draft.capacity"
                label="队伍容量（含队长，2–20 人）"
                type="number"
                :error="state.errors.capacity"
                :focus="focusField === 'capacity'"
                :disabled="state.submitting || !!state.publishedId"
            /></view>
            <view id="publish-deadline"
              ><FormDateTime
                id="publish-deadline-control"
                v-model="state.draft.deadline"
                label="招募截止"
                :error="state.errors.deadline"
                :focus="focusField === 'deadline'"
                :disabled="state.submitting || !!state.publishedId"
            /></view>
            <view id="publish-competition" class="competition-picker">
              <text class="picker-title"
                >关联比赛{{
                  state.draft.type === "competition" ? "（必填）" : "（选填）"
                }}</text
              >
              <text class="picker-copy"
                >普通项目可直接发布。真实比赛资料来自公开接口；关联比赛不代表参赛资格通过。</text
              >
              <view class="search-row">
                <FormInput
                  id="competition-search"
                  v-model="state.keyword"
                  label="查找比赛"
                  :maxlength="100"
                  placeholder="比赛名称关键词"
                  :disabled="state.submitting || !!state.publishedId"
                  @confirm="controller.search()"
                />
                <FormButton
                  :disabled="state.submitting || !!state.publishedId"
                  @click="controller.search()"
                  >查询比赛</FormButton
                >
              </view>
              <text
                v-if="state.searchStatus === 'loading'"
                class="picker-copy"
                role="status"
                >正在查询真实比赛…</text
              >
              <view
                v-else-if="state.searchStatus === 'error'"
                class="picker-feedback"
              >
                <text class="hhr-form-error" role="alert">{{
                  state.searchError
                }}</text>
                <text
                  v-if="state.searchRequestId"
                  class="picker-copy picker-request-id"
                  >请求编号：{{ state.searchRequestId }}</text
                >
                <FormButton
                  variant="secondary"
                  @click="controller.retrySearch()"
                  >重试比赛查询</FormButton
                >
              </view>
              <text
                v-else-if="state.searchStatus === 'ready' && !unique.length"
                class="picker-copy"
                >没有找到比赛，请更换关键词。</text
              >
              <FormPicker
                id="competition-select"
                :model-value="state.selectedId"
                label="比赛届次"
                :options="competitionOptions"
                :error="state.errors.competition"
                :focus="focusField === 'competition'"
                :disabled="state.submitting || !!state.publishedId"
                @change="controller.select($event)"
              />
              <FormButton
                v-if="state.hasMore"
                variant="secondary"
                :disabled="state.searchStatus !== 'ready'"
                @click="controller.more()"
                >加载更多比赛</FormButton
              >
              <text
                v-if="state.selectionStatus === 'loading'"
                class="picker-copy"
                role="status"
                >正在加载所选比赛详情…</text
              >
              <view
                v-if="state.selectionStatus === 'error'"
                class="picker-feedback"
              >
                <text class="hhr-form-error" role="alert">{{
                  state.selectionError
                }}</text>
                <text
                  v-if="state.selectionRequestId"
                  class="picker-copy picker-request-id"
                  >请求编号：{{ state.selectionRequestId }}</text
                >
                <FormButton
                  variant="secondary"
                  @click="controller.select(state.selectedId)"
                  >重试比赛详情</FormButton
                >
              </view>
              <template v-if="state.draft.competition">
                <view id="publish-trackId"
                  ><FormPicker
                    id="publish-track-control"
                    v-model="state.draft.trackId"
                    label="赛道（选填）"
                    :options="trackOptions"
                    :error="state.errors.trackId"
                    :focus="focusField === 'trackId'"
                    :disabled="state.submitting || !!state.publishedId"
                /></view>
                <text v-if="selectedTrack" class="track-copy"
                  >{{ selectedTrack.members }} · {{ selectedTrack.rules }}</text
                >
                <text
                  v-for="stage in state.draft.competition.stages"
                  :key="stage.id"
                  class="picker-copy"
                  >{{ stage.name }}官方报名截止：{{
                    stage.conflict ? "时间待核对" : formatTime(stage.deadline)
                  }}</text
                >
                <text class="picker-copy"
                  >以上官方时间不自动用作招募截止，平台组队不等于官方比赛报名。</text
                >
              </template>
              <FormButton
                v-if="state.selectedId"
                variant="secondary"
                :disabled="state.submitting || !!state.publishedId"
                @click="controller.select('')"
                >清除比赛</FormButton
              >
            </view>
          </template>
        </view>
        <view class="submit-panel">
          <text class="submit-copy"
            >演示发布仅在当前页面会话内创建队伍。\n你将作为演示队长计为首名成员。</text
          >
          <FormButton
            :loading="state.submitting"
            :disabled="
              !!state.publishedId ||
              (!!state.selectedId && state.selectionStatus === 'loading')
            "
            @click="submit"
            >{{
              state.submitting ? "正在演示发布…" : "演示发布招募"
            }}</FormButton
          >
        </view>
        <text
          v-if="Object.keys(state.errors).length"
          role="alert"
          class="form-summary"
          >请检查表单标注的错误，已保留填写内容。</text
        >
        <text v-if="state.submitError" role="alert" class="form-summary">{{
          state.submitError
        }}</text>
      </view>
      <view class="demo-footer">
        <text>招募、申请与队伍均为当前会话内演示，刷新或重置后恢复示例。</text>
        <FormButton variant="secondary" @click="resetDemo"
          >重置会话演示</FormButton
        >
      </view>
    </view>
  </view>
</template>

<style scoped>
.publish-page {
  padding: 24px 20px calc(32px + env(safe-area-inset-bottom, 0px));
}
.publish-inner {
  width: 100%;
  max-width: 1020px;
  margin: 0 auto;
  min-width: 0;
}
.back-link {
  width: auto;
  justify-content: flex-start;
  min-height: 44px;
  margin-bottom: 20px;
  padding: 0;
  background: transparent;
  color: var(--hhr-color-brand);
  font-size: 14px;
}
.publish-header {
  margin-bottom: 24px;
}
.publish-title {
  display: block;
  margin-top: 8px;
  font-family: var(--hhr-font-display);
  font-size: 30px;
  line-height: 36px;
  font-weight: 600;
}
.header-copy {
  display: block;
  margin-top: 12px;
  color: var(--hhr-color-muted);
  font-size: 14px;
}
.publish-form {
  display: grid;
  gap: 20px;
}
.publish-panel {
  min-width: 0;
  padding: 22px;
}
.section-title {
  display: block;
  font-family: var(--hhr-font-display);
  font-size: 20px;
  line-height: 28px;
  font-weight: 600;
}
.section-copy {
  display: block;
  margin: 8px 0 20px;
  font-size: 14px;
  color: var(--hhr-color-muted);
}
.publish-panel :deep(.hhr-form-field) {
  margin-bottom: 20px;
}
.publish-panel :deep(.hhr-form-label),
.field-label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  line-height: 20px;
  font-weight: 400;
}
.publish-panel :deep(.hhr-input) {
  padding: 11px 12px;
  font-size: 14px;
  line-height: 1.65;
}
.publish-panel :deep(.hhr-form-textarea) {
  box-sizing: border-box;
  height: calc(4.95em + 24px);
  min-height: calc(4.95em + 24px);
}
.field-goal :deep(.hhr-form-textarea) {
  height: calc(9.9em + 24px);
  min-height: calc(9.9em + 24px);
}
.roles-field {
  margin-bottom: 20px;
}
.role-options {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.publish-page :deep(.role-option) {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--hhr-color-line);
  border-radius: var(--hhr-radius-control);
  font-size: 14px;
  font-weight: 400;
  color: var(--hhr-color-ink);
  width: auto;
}
.role-check {
  box-sizing: border-box;
  width: 13px;
  height: 13px;
  border: 1px solid var(--hhr-color-input-line);
  border-radius: 2px;
  font-size: 11px;
  line-height: 11px;
}
.role-check.is-checked {
  background: var(--hhr-color-brand);
  border-color: var(--hhr-color-brand);
  color: var(--hhr-color-surface);
}
.competition-picker {
  padding: 16px;
  border: 1px solid var(--hhr-color-line);
  border-radius: var(--hhr-radius-control);
}
.picker-title {
  display: block;
  font-size: 16px;
  font-weight: 600;
}
.picker-copy {
  display: block;
  margin: 8px 0 12px;
  font-size: 12px;
  line-height: 24px;
  color: var(--hhr-color-muted);
}
.search-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 12px 0 16px;
}
.search-row :deep(.hhr-form-field) {
  margin-bottom: 0;
  min-width: 0;
  flex: 1;
}
.publish-page :deep(.hhr-button) {
  font-size: 13px;
  padding: 10px 18px;
}
.picker-feedback {
  display: grid;
  gap: 8px;
  margin: 12px 0;
}
.picker-request-id {
  overflow-wrap: anywhere;
  word-break: break-all;
}
.competition-picker :deep(.hhr-button) {
  width: auto;
  max-width: 100%;
  margin-bottom: 12px;
}
.track-copy {
  display: block;
  margin: 12px 0;
  font-size: 14px;
  line-height: 28px;
}
.submit-panel {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px;
  border-radius: var(--hhr-radius-panel);
  background: var(--hhr-color-brand-soft);
}
.submit-copy {
  font-size: 14px;
  line-height: 28px;
  white-space: pre-line;
}
.submit-panel :deep(.hhr-button) {
  width: auto;
  max-width: 100%;
}
.form-summary {
  font-size: 14px;
  color: var(--hhr-color-danger);
}
.demo-footer {
  display: grid;
  justify-items: end;
  gap: 12px;
  margin-top: 24px;
  font-size: 12px;
  color: var(--hhr-color-muted);
}
.demo-footer :deep(.hhr-button) {
  width: auto;
}
@media (min-width: 640px) {
  .search-row {
    flex-direction: row;
    align-items: end;
  }
  .search-row :deep(.hhr-button) {
    margin: 0;
  }
}
@media (min-width: 768px) {
  .publish-page {
    padding: 40px;
  }
}
@media (max-width: 767px) {
  .publish-panel :deep(.hhr-input) {
    font-size: 16px;
  }
}
</style>
