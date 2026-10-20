<script setup lang="ts">
import { computed } from "vue";
import {
  applicationLabels,
  type TeamApplication,
} from "@hehuoda/client-domain/team";
import { useSessionStore } from "../stores/session";
import { openPage, openTab } from "../navigation/navigate";
import type { ProfileTeamController } from "../stores/profile-team-controller";
import FormButton from "./FormButton.vue";
import ProfileTeamConfirmDialog from "./ProfileTeamConfirmDialog.vue";

const props = defineProps<{ controller: ProfileTeamController }>();
const session = useSessionStore();
const controller = props.controller;
const state = controller.state;
const records = computed(() => controller.ownRecords());
const pendingCount = computed(
  () =>
    records.value.filter((a) => ["PENDING", "INVITED"].includes(a.state))
      .length,
);
function teamTitle(record: TeamApplication) {
  return (
    session.teams.find((t) => t.id === record.teamId)?.title ?? "队伍已不存在"
  );
}
function problem(record: TeamApplication) {
  return record.state === "INVITED"
    ? session.invitationProblem(record, state.now)
    : "";
}
</script>

<template>
  <view class="profile-applications">
    <text class="apps-summary"
      >共 {{ records.length }} 条 · 待处理与待确认 {{ pendingCount }} 条</text
    >
    <text class="apps-copy"
      >这里只保留自己的申请与收到的邀请，历史状态一并展示。队长收到的申请与发出的邀请在「我的队伍」的选中队伍管理详情里处理。</text
    >
    <view v-if="state.feedback" role="status" class="hhr-notice">{{
      state.feedback
    }}</view>
    <view v-if="!records.length" class="hhr-panel empty-panel">
      <text class="apps-copy"
        >暂无申请与邀请。前往找队友了解项目后可演示申请。</text
      >
      <FormButton variant="secondary" @click="openTab('teams')"
        >前往找队友</FormButton
      >
    </view>
    <view
      v-for="record in records"
      :key="record.id"
      class="hhr-panel record"
      :data-application="record.id"
    >
      <text class="record-title">{{ teamTitle(record) }}</text>
      <text class="apps-copy"
        >{{ applicationLabels[record.state] }} · {{ record.role }}</text
      >
      <text class="record-note">{{ record.note }}</text>
      <text v-if="record.state === 'INVITED'" class="apps-copy">{{
        problem(record) ||
        "收到有效演示邀请；确认时重新检查名额、截止与角色需求。"
      }}</text>
      <view class="action-row">
        <FormButton
          v-if="['PENDING', 'INVITED'].includes(record.state)"
          variant="secondary"
          @click="controller.beginRespond(record.id, 'withdraw')"
          >撤回申请</FormButton
        >
        <template v-if="record.state === 'INVITED'">
          <FormButton
            :disabled="!!problem(record)"
            @click="controller.beginRespond(record.id, 'accept')"
            >确认入队</FormButton
          >
          <FormButton
            variant="secondary"
            @click="controller.beginRespond(record.id, 'decline')"
            >拒绝邀请</FormButton
          >
        </template>
        <FormButton
          variant="secondary"
          @click="openPage('team-detail', { id: record.teamId })"
          >查看公开招募</FormButton
        >
      </view>
    </view>
    <text class="apps-footer"
      >撤回、确认与拒绝都只在当前会话内生效，不会向真实用户发送消息；待确认邀请不预占名额。</text
    >
    <ProfileTeamConfirmDialog :controller="controller" />
  </view>
</template>

<style scoped>
.profile-applications {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.apps-summary {
  font-size: 14px;
  font-weight: 600;
}
.apps-copy {
  display: block;
  font-size: 13px;
  line-height: 24px;
  color: var(--hhr-color-muted);
  overflow-wrap: anywhere;
}
.profile-applications .hhr-panel {
  min-width: 0;
  padding: 20px;
}
.empty-panel,
.record {
  display: grid;
  gap: 10px;
  justify-items: start;
}
.record-title {
  display: block;
  font-size: 16px;
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
.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}
.action-row :deep(.hhr-button) {
  width: auto;
  max-width: 100%;
  min-height: 44px;
  padding: 10px 16px;
  font-size: 13px;
}
.apps-footer {
  font-size: 12px;
  line-height: 22px;
  color: var(--hhr-color-muted);
  overflow-wrap: anywhere;
}
</style>
