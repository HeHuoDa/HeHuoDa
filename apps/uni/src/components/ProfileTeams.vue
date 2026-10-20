<script setup lang="ts">
import { computed } from "vue";
import {
  applicationLabels,
  DEMO_PARTICIPANT,
  recruitmentStatus,
  teamTime,
  type Team,
} from "@hehuoda/client-domain/team";
import { useSessionStore } from "../stores/session";
import { openPage, openTab } from "../navigation/navigate";
import type { ProfileTeamController } from "../stores/profile-team-controller";
import FormButton from "./FormButton.vue";
import FormDialog from "./FormDialog.vue";
import FormPicker from "./FormPicker.vue";
import ProfileTeamEditor from "./ProfileTeamEditor.vue";

const props = defineProps<{ controller: ProfileTeamController }>();
const session = useSessionStore();
const controller = props.controller;
const state = controller.state;
const teams = computed(() => controller.mine());
const team = computed(() => controller.selectedTeam());
const captain = computed(() => controller.isCaptain(team.value));
const incoming = computed(() => controller.incoming(team.value));
const captainCount = computed(
  () => teams.value.filter((t) => controller.isCaptain(t)).length,
);
const successorOptions = computed(() => [
  { value: "", label: "请选择其他成员" },
  ...(team.value?.members
    .filter((m) => !m.captain)
    .map((m) => ({
      value: m.id,
      label: session.memberNickname(m.id, m.nickname),
    })) ?? []),
]);
function roleLabel(target: Team) {
  return controller.isCaptain(target) ? "队长" : "普通成员";
}
function authorized(memberId: string) {
  return memberId === DEMO_PARTICIPANT.id
    ? session.contactShared
    : session.contactAuthorizations[memberId] === true;
}
function toggleAuthorization(memberId: string, event: unknown) {
  const value = (event as { detail?: { value?: unknown } })?.detail?.value;
  if (typeof value !== "boolean") return;
  if (memberId === DEMO_PARTICIPANT.id) session.contactShared = value;
  else session.contactAuthorizations[memberId] = value;
}
function authorizationKey(
  memberId: string,
  event: { key?: string; repeat?: boolean; preventDefault?: () => void },
) {
  if (event.key !== " " && event.key !== "Enter") return;
  event.preventDefault?.();
  if (!event.repeat)
    toggleAuthorization(memberId, { detail: { value: !authorized(memberId) } });
}
function openTeam(id: string) {
  openPage("team-detail", { id });
}
function invitationHint(recordId: string) {
  const record = session.records.find((a) => a.id === recordId);
  // 只有仍在邀请中的记录才提示不可确认的原因；终态记录直接看状态文案。
  return record?.state === "INVITED"
    ? session.invitationProblem(record, state.now)
    : "";
}
</script>

<template>
  <view class="profile-teams">
    <text class="teams-summary"
      >共 {{ teams.length }} 支 · 带领 {{ captainCount }} 支 · 加入
      {{ teams.length - captainCount }} 支</text
    >
    <text class="teams-copy"
      >以下为当前会话演示队伍，刷新或重置后恢复示例。人数包含队长，待处理申请与邀请不预占名额。</text
    >
    <view v-if="state.feedback" role="status" class="hhr-notice">{{
      state.feedback
    }}</view>
    <view v-if="!teams.length" class="hhr-panel empty-panel">
      <text class="teams-copy">暂无队伍。可以前往找队友申请，或发布招募。</text>
      <FormButton variant="secondary" @click="openTab('teams')"
        >前往找队友</FormButton
      >
    </view>
    <view
      v-for="item in teams"
      :key="item.id"
      class="hhr-panel team-row"
      :data-my-team="item.id"
    >
      <text class="team-title">{{ item.title }}</text>
      <text class="teams-copy"
        >{{ roleLabel(item) }} · {{ item.members.length }}/{{
          item.capacity
        }}
        人 · {{ recruitmentStatus(item, state.now).label }}</text
      >
      <FormButton
        variant="secondary"
        class="row-action"
        :disabled="state.selectedId === item.id"
        @click="controller.select(item.id)"
        >{{
          state.selectedId === item.id ? "正在管理" : "查看与管理"
        }}</FormButton
      >
    </view>
    <view
      v-if="team"
      class="hhr-panel management-detail"
      aria-label="队伍管理详情"
    >
      <text class="detail-title"
        >{{ team.title }} · {{ captain ? "队长管理" : "成员详情" }}</text
      >
      <text class="teams-copy"
        >{{ recruitmentStatus(team, state.now).label }} · 截止
        {{ teamTime(team.deadline) }}</text
      >
      <FormButton
        variant="secondary"
        class="row-action"
        @click="openTeam(team.id)"
        >查看公开招募</FormButton
      >
      <view class="action-row">
        <template v-if="captain">
          <FormButton @click="controller.beginEdit()">编辑招募</FormButton>
          <FormButton
            v-if="team.state !== 'closed'"
            variant="secondary"
            @click="
              controller.beginManage(
                team.state === 'paused' ? 'open' : 'paused',
              )
            "
            >{{ team.state === "paused" ? "恢复招募" : "暂停招募" }}</FormButton
          >
          <FormButton
            v-if="team.state !== 'closed'"
            variant="secondary"
            @click="controller.beginManage('closed')"
            >关闭招募</FormButton
          >
          <FormButton
            variant="secondary"
            @click="controller.beginManage('dissolve')"
            >解散队伍</FormButton
          >
        </template>
        <FormButton
          v-else
          variant="secondary"
          @click="controller.beginManage('leave')"
          >退出队伍</FormButton
        >
      </view>
      <text v-if="captain" class="teams-copy"
        >队长不能直接退出，须先移交或解散。关闭招募后不能暂停或恢复。</text
      >
      <text class="detail-subtitle">有效成员与联系方式示例</text>
      <view
        v-for="member in team.members"
        :key="member.id"
        class="record"
        :data-member="member.id"
      >
        <text class="record-title"
          >{{ session.memberNickname(member.id, member.nickname) }} ·
          {{ member.captain ? "队长" : member.role }}</text
        >
        <view class="auth-row">
          <text class="auth-label">{{
            member.id === DEMO_PARTICIPANT.id
              ? "我的联系方式授权（复用资料设置）"
              : "预览此成员已授权（示例）"
          }}</text>
          <switch
            :id="`profile-team-auth-${member.id}`"
            class="auth-switch"
            :checked="authorized(member.id)"
            color="var(--hhr-color-brand)"
            role="switch"
            tabindex="0"
            :aria-checked="authorized(member.id)"
            :aria-label="
              member.id === DEMO_PARTICIPANT.id
                ? '允许同队有效成员查看（演示）'
                : '预览此成员授权状态（示例）'
            "
            @change="toggleAuthorization(member.id, $event)"
            @keydown="authorizationKey(member.id, $event)"
          />
        </view>
        <text class="teams-copy">{{
          session.canViewContact(team.id, member.id)
            ? "联系方式示例：已授权可见（无真实值）"
            : "联系方式隐藏：须同队有效成员且所有者授权"
        }}</text>
        <FormButton
          v-if="captain && !member.captain"
          variant="secondary"
          class="row-action"
          @click="controller.beginManage('remove', member.id)"
          >移除成员</FormButton
        >
      </view>
      <view v-if="captain" class="transfer">
        <FormPicker
          id="profile-team-successor"
          v-model="state.successor"
          label="移交给其他有效成员"
          :options="successorOptions"
        />
        <FormButton
          variant="secondary"
          class="row-action"
          :disabled="!state.successor"
          @click="controller.beginManage('transfer', state.successor)"
          >移交队长</FormButton
        >
      </view>
      <template v-if="captain">
        <text class="detail-subtitle">申请与发出的邀请</text>
        <text v-if="!incoming.length" class="teams-copy">暂无申请。</text>
        <view
          v-for="record in incoming"
          :key="record.id"
          class="record"
          :data-incoming="record.id"
        >
          <text class="record-title"
            >{{ record.nickname }} · {{ record.role }} ·
            {{ applicationLabels[record.state] }}</text
          >
          <text class="record-note">{{ record.note }}</text>
          <text v-if="invitationHint(record.id)" class="teams-copy"
            >当前邀请无法确认：{{ invitationHint(record.id) }}</text
          >
          <view class="action-row">
            <template v-if="record.state === 'PENDING'">
              <FormButton @click="controller.beginProcess(record.id, 'invite')"
                >邀请</FormButton
              >
              <FormButton
                variant="secondary"
                @click="controller.beginProcess(record.id, 'reject')"
                >拒绝申请</FormButton
              >
            </template>
            <FormButton
              v-if="record.state === 'INVITED'"
              variant="secondary"
              @click="controller.beginProcess(record.id, 'revoke')"
              >撤销邀请</FormButton
            >
          </view>
        </view>
      </template>
      <FormButton
        variant="secondary"
        class="row-action"
        @click="controller.select('')"
        >收起管理</FormButton
      >
    </view>
    <view class="teams-footer">
      <text
        >仅在当前会话内演示，刷新或重置恢复示例。申请与邀请不增加成员，邀请不预占名额；不会送达真实队长，也没有服务器事务与并发保障。</text
      >
      <FormButton
        variant="secondary"
        class="row-action"
        @click="controller.resetAll()"
        >重置全部组队示例</FormButton
      >
    </view>
    <FormDialog
      id="profile-team-editor"
      class="profile-team-editor-dialog"
      :open="!!state.draft"
      title="编辑演示招募"
      save-label="保存演示招募"
      :saving="state.saving"
      :error-target="state.errorTarget"
      @save="controller.saveEdit()"
      @cancel="controller.cancelEdit()"
    >
      <ProfileTeamEditor v-if="state.draft" :controller="props.controller" />
    </FormDialog>
    <FormDialog
      id="profile-team-confirm"
      class="profile-team-confirm-dialog"
      :open="!!state.confirm"
      :title="state.confirm?.title ?? '确认操作'"
      save-label="确认操作"
      :saving="state.saving"
      @save="controller.submit()"
      @cancel="controller.cancelConfirm()"
    >
      <text class="dialog-copy">{{ state.confirm?.description }}</text>
      <text class="dialog-copy"
        >本次操作只更新当前会话内示例，不会送达真实用户，也不会写入服务器。</text
      >
    </FormDialog>
  </view>
</template>

<style scoped>
.profile-teams {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.teams-summary {
  font-size: 14px;
  font-weight: 600;
}
.teams-copy {
  display: block;
  font-size: 13px;
  line-height: 24px;
  color: var(--hhr-color-muted);
  overflow-wrap: anywhere;
}
.profile-teams .hhr-panel {
  min-width: 0;
  padding: 20px;
}
.empty-panel,
.team-row {
  display: grid;
  gap: 10px;
  justify-items: start;
}
.team-title {
  display: block;
  font-size: 18px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.row-action {
  width: auto;
  max-width: 100%;
  min-height: 44px;
}
.management-detail {
  display: grid;
  gap: 12px;
  justify-items: start;
}
.detail-title {
  display: block;
  font-family: var(--hhr-font-display);
  font-size: 20px;
  line-height: 28px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.detail-subtitle {
  display: block;
  margin-top: 8px;
  font-size: 15px;
  font-weight: 600;
}
.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}
.action-row :deep(.hhr-button) {
  width: auto;
  max-width: 100%;
  padding: 10px 16px;
  font-size: 13px;
}
.record {
  display: grid;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--hhr-color-line);
  border-radius: var(--hhr-radius-control);
}
.record-title {
  display: block;
  font-size: 14px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.record-note {
  display: block;
  font-size: 12px;
  line-height: 22px;
  color: var(--hhr-color-muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.auth-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.auth-label {
  flex: 1 1 160px;
  min-width: 0;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.auth-switch {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  min-height: 44px;
}
.transfer {
  display: grid;
  gap: 8px;
  width: 100%;
  margin-top: 8px;
}
.teams-footer {
  display: grid;
  gap: 10px;
  justify-items: start;
  font-size: 12px;
  line-height: 22px;
  color: var(--hhr-color-muted);
  overflow-wrap: anywhere;
}
.profile-team-editor-dialog :deep(.hhr-dialog-panel) {
  max-width: 560px;
  max-height: 640px;
}
.profile-team-confirm-dialog :deep(.hhr-dialog-panel) {
  max-width: 480px;
  max-height: 320px;
}
@media (max-width: 600px) {
  .profile-team-editor-dialog :deep(.hhr-dialog-panel) {
    max-height: calc(100% - 24px);
  }
}
.dialog-copy {
  display: block;
  margin-bottom: 12px;
  font-size: 14px;
  line-height: 26px;
  color: var(--hhr-color-muted);
}
</style>
