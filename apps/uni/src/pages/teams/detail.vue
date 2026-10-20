<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { onHide, onLoad, onShow, onUnload } from "@dcloudio/uni-app";
import {
  projectTypes,
  cooperationModes,
  recruitmentStatus,
  teamTime,
  applicationLabels,
} from "@hehuoda/client-domain/team";
import { formatTime } from "@hehuoda/client-domain/competition-discovery";
import FormButton from "../../components/FormButton.vue";
import FormDialog from "../../components/FormDialog.vue";
import FormInput from "../../components/FormInput.vue";
import FormPicker from "../../components/FormPicker.vue";
import ParamFeedback from "../../components/ParamFeedback.vue";
import { openPage, returnToTeams } from "../../navigation/navigate";
import {
  paramMessage,
  parseBusinessId,
  type RouteQuery,
} from "../../navigation/params";
import {
  parseTeamRouteQuery,
  teamRouteQuery,
} from "../../navigation/team-query";
import { useSessionStore } from "../../stores/session";
import {
  createTeamDetailController,
  initialTeamDetailState,
} from "../../stores/team-detail-controller";

const session = useSessionStore();
const state = reactive(initialTeamDetailState());
const controller = createTeamDetailController(state, session);
const view = computed(() => controller.view());
const team = computed(() => view.value.team);
const track = computed(() =>
  team.value?.competition?.tracks.find((t) => t.id === team.value?.trackId),
);
const parameterError = ref("");
let sourceQuery: RouteQuery = {};
let timer: ReturnType<typeof globalThis.setInterval> | undefined;
const roleChoices = computed(() =>
  (state.action === "report"
    ? ["信息不实", "不当内容", "其他问题"]
    : (team.value?.roles ?? [])
  ).map((value) => ({ value, label: value })),
);
const titles = {
  apply: "演示申请",
  report: "演示举报",
  withdraw: "确认撤回申请？",
  accept: "确认接受邀请并入队？",
  decline: "确认拒绝邀请？",
};
const title = computed(() => (state.action ? titles[state.action] : ""));
const isForm = computed(
  () => state.action === "apply" || state.action === "report",
);
function returnToList() {
  returnToTeams(sourceQuery);
}
function leave() {
  if (timer !== undefined) globalThis.clearInterval(timer);
  timer = undefined;
  controller.cancel();
}
onLoad((query) => {
  sourceQuery = teamRouteQuery(parseTeamRouteQuery(query ?? {}));
  const parsed = parseBusinessId(query?.id);
  parameterError.value = parsed.issue ? paramMessage(parsed.issue, "队伍") : "";
  controller.load(parsed.issue ? "" : parsed.value);
});
onShow(() => {
  controller.syncClock();
  if (timer === undefined)
    timer = globalThis.setInterval(controller.syncClock, 1000);
});
onHide(leave);
onUnload(leave);
watch(team, (value) => {
  if (!value) controller.cancel();
});
</script>

<template>
  <view class="hhr-page team-detail">
    <view class="hhr-page__inner team-detail-inner">
      <view
        class="return-link"
        role="link"
        tabindex="0"
        @click="returnToList"
        @keydown.enter="returnToList"
        >← 返回找队友列表</view
      >
      <ParamFeedback
        v-if="parameterError"
        title="无法打开队伍详情"
        :message="parameterError"
      />
      <view v-else-if="!team" class="hhr-panel">
        <text class="detail-heading">队伍不存在</text>
        <text class="detail-copy muted">{{
          state.id.startsWith("session-")
            ? "会话内演示数据已重置，刷新或重置后新建队伍不再保留。"
            : "未找到这支队伍，或队伍已解散，请返回列表重新选择。"
        }}</text>
      </view>
      <template v-else>
        <view v-if="team.id.startsWith('session-')" class="hhr-notice mb-4"
          >演示招募已发布，仅在当前页面会话内保留。你是这支队伍的演示队长。</view
        >
        <view class="detail-header">
          <view class="detail-badges"
            ><text class="hhr-badge">{{ projectTypes[team.type] }}</text
            ><text class="hhr-badge hhr-badge--warning"
              >{{ recruitmentStatus(team, state.now).label }} · 演示招募</text
            ></view
          >
          <text class="detail-title">{{ team.title }}</text>
        </view>
        <view class="detail-grid">
          <view class="detail-column">
            <view class="hhr-panel">
              <text class="detail-heading">项目目标</text>
              <text class="detail-copy goal-copy">{{ team.goal }}</text>
              <text class="detail-subheading">当前进度</text>
              <text class="detail-copy">{{
                team.progress || "当前进度待沟通"
              }}</text>
            </view>
            <view class="hhr-panel">
              <text class="detail-heading">合作需求</text>
              <text class="detail-copy"
                >所需角色：{{ team.roles.join("、") || "暂无角色需求" }}</text
              >
              <text class="detail-copy"
                >技能与职责：{{ team.skills || "具体职责与技能共同沟通" }}</text
              >
              <text class="detail-copy"
                >合作方式：{{ cooperationModes[team.mode] }}</text
              >
              <text v-if="team.mode !== 'online'" class="detail-copy"
                >地点：{{ team.location }}</text
              >
            </view>
            <view v-if="team.competition" class="hhr-panel">
              <text class="detail-heading">关联比赛资料</text>
              <view
                class="competition-link"
                role="link"
                tabindex="0"
                @click="
                  openPage('competition-detail', { id: team.competition.id })
                "
                @keydown.enter="
                  openPage('competition-detail', { id: team.competition.id })
                "
                >{{ team.competition.name }} ·
                {{ team.competition.edition }}</view
              >
              <text class="detail-copy"
                >赛道：{{ track?.name || "未选赛道" }}</text
              >
              <text v-if="track" class="detail-copy"
                >{{ track.members }} · {{ track.rules }}</text
              >
              <text
                v-for="stage in team.competition.stages"
                :key="stage.id"
                class="detail-small"
                >{{ stage.name }}官方报名截止：{{
                  stage.conflict ? "时间待核对" : formatTime(stage.deadline)
                }}</text
              >
              <text class="detail-small"
                >比赛资料来自公开接口，招募是会话内演示；官方报名截止与招募截止分别计算。</text
              >
            </view>
          </view>
          <view class="detail-column">
            <view class="hhr-panel">
              <text class="detail-heading">队伍成员</text>
              <text class="detail-copy" data-testid="member-count"
                >当前 {{ team.members.length }}/{{ team.capacity }} 人（含队长）
                · 剩余
                {{ Math.max(0, team.capacity - team.members.length) }} 人</text
              >
              <view class="member-list"
                ><view
                  v-for="member in team.members"
                  :key="member.id"
                  class="member-row"
                  ><text>{{
                    session.memberNickname(member.id, member.nickname)
                  }}</text
                  ><text class="member-role"
                    >{{ member.captain ? "队长" : "成员" }} ·
                    {{ member.role }}</text
                  ></view
                ></view
              >
            </view>
            <view class="hhr-panel">
              <text class="detail-heading">招募与申请</text>
              <text class="detail-copy"
                >招募截止：{{ teamTime(team.deadline) }}</text
              >
              <text class="detail-copy status-label">{{
                view.invited ? "演示已邀请，等待确认入队" : view.status.label
              }}</text>
              <text v-if="view.record" class="detail-copy"
                >我的申请：{{ applicationLabels[view.record.state] }}</text
              >
              <text v-if="view.invitationProblem" class="detail-small"
                >当前无法确认：{{ view.invitationProblem }}</text
              >
              <text class="detail-small"
                >平台组队不等于官方比赛报名；关联比赛不代表参赛资格通过。公开页面不展示真实联系方式。</text
              >
              <view class="detail-actions">
                <FormButton
                  :disabled="!view.status.available"
                  @click="controller.begin('apply')"
                  >{{
                    view.status.available
                      ? "演示申请"
                      : view.invited
                        ? "演示已邀请"
                        : view.status.label
                  }}</FormButton
                >
                <FormButton
                  v-if="view.canWithdraw"
                  variant="secondary"
                  @click="controller.begin('withdraw')"
                  >撤回申请</FormButton
                >
                <FormButton
                  v-if="view.invited"
                  :disabled="!!view.invitationProblem"
                  @click="controller.begin('accept')"
                  >接受邀请并入队</FormButton
                >
                <FormButton
                  v-if="view.invited"
                  variant="secondary"
                  @click="controller.begin('decline')"
                  >拒绝邀请</FormButton
                >
                <FormButton
                  variant="secondary"
                  @click="controller.begin('report')"
                  >演示举报</FormButton
                >
              </view>
              <text
                v-if="state.feedback"
                role="status"
                aria-live="polite"
                class="detail-feedback"
                >{{ state.feedback }}</text
              >
            </view>
          </view>
        </view>
        <FormDialog
          id="team-action"
          :class="isForm ? 'team-action-form' : 'team-action-confirm'"
          :open="!!state.action"
          :title="title"
          :save-label="isForm ? `提交${title}` : '确认操作'"
          :error-target="state.errorTarget"
          @cancel="controller.cancel"
          @save="controller.submit"
        >
          <text class="dialog-copy">{{
            state.action === "report"
              ? "举报不会外发，也没有实际进入审核。"
              : state.action === "apply"
                ? "仅创建会话内待处理申请，不增加成员，不会送达真实队长。"
                : state.action === "accept"
                  ? "确认成功才加入队伍并增加人数，仅在当前会话内生效。"
                  : "仅处理自己的会话内申请或邀请，不会向真实用户发送消息。"
          }}</text>
          <template v-if="isForm">
            <FormPicker
              id="team-action-role"
              v-model="state.role"
              :label="state.action === 'apply' ? '角色意向' : '举报原因'"
              :options="roleChoices"
              :error="state.error"
            />
            <FormInput
              id="team-action-note"
              v-model="state.note"
              label="补充说明（选填，最多 500 字，请勿填写联系方式）"
              multiline
              :maxlength="500"
              :adjust-position="false"
            />
          </template>
          <text v-else-if="state.error" role="alert" class="hhr-form-error">{{
            state.error
          }}</text>
        </FormDialog>
      </template>
      <view class="demo-footer"
        ><text
          >以上招募、申请与成员关系均为会话演示，刷新或重置后恢复示例。</text
        ><FormButton variant="secondary" @click="controller.reset"
          >重置演示</FormButton
        ></view
      >
    </view>
  </view>
</template>

<style scoped>
.team-detail {
  padding: 24px 20px calc(32px + env(safe-area-inset-bottom, 0px));
}
.team-detail-inner {
  max-width: 1020px;
}
.return-link {
  display: flex;
  align-items: center;
  min-height: 44px;
  margin-bottom: 20px;
  font-size: 14px;
  color: var(--hhr-color-brand);
  cursor: pointer;
}
.detail-header {
  margin-bottom: 24px;
}
.detail-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.detail-title {
  display: block;
  font-family: var(--hhr-font-display);
  font-size: 30px;
  font-weight: 600;
  line-height: 36px;
}
.detail-grid,
.detail-column {
  display: grid;
  gap: 20px;
  min-width: 0;
  align-content: start;
}
.team-detail .hhr-panel {
  min-width: 0;
  padding: 22px;
}
.detail-heading {
  display: block;
  font-family: var(--hhr-font-display);
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
}
.detail-subheading {
  display: block;
  margin-top: 24px;
  font-size: 16px;
  font-weight: 600;
}
.detail-copy {
  display: block;
  margin-top: 12px;
  font-size: 14px;
  line-height: 28px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.goal-copy {
  margin-top: 16px;
  line-height: 32px;
}
.muted,
.detail-small,
.member-role {
  color: var(--hhr-color-muted);
}
.detail-small {
  display: block;
  margin-top: 12px;
  font-size: 12px;
  line-height: 24px;
  overflow-wrap: anywhere;
}
.status-label {
  font-weight: 600;
}
.member-list {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}
.member-row {
  padding: 12px;
  border-radius: var(--hhr-radius-control);
  background: var(--hhr-color-page);
  font-size: 14px;
  overflow-wrap: anywhere;
}
.member-role {
  display: block;
  margin-top: 4px;
  font-size: 12px;
}
.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}
.detail-actions :deep(.hhr-button),
.demo-footer :deep(.hhr-button) {
  width: auto;
  max-width: 100%;
  padding: 10px 18px;
  font-size: 13px;
}
.team-action-form :deep(.hhr-dialog-panel) {
  max-width: 512px;
  max-height: 560px;
}
.team-action-confirm :deep(.hhr-dialog-panel) {
  max-width: 512px;
  max-height: 260px;
}
.detail-feedback {
  display: block;
  margin-top: 12px;
  font-size: 14px;
  color: var(--hhr-color-brand);
}
.competition-link {
  margin-top: 12px;
  color: var(--hhr-color-brand);
  text-decoration: underline;
  cursor: pointer;
  min-height: 44px;
  overflow-wrap: anywhere;
}
.dialog-copy {
  display: block;
  margin-bottom: 16px;
  font-size: 14px;
  color: var(--hhr-color-muted);
}
.demo-footer {
  display: grid;
  gap: 12px;
  margin-top: 24px;
  font-size: 12px;
  color: var(--hhr-color-muted);
  justify-items: end;
}
@media (min-width: 1024px) {
  .detail-grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 0.65fr);
  }
}
</style>
