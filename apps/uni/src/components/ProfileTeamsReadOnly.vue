<script setup lang="ts">
import { computed } from "vue";
import { DEMO_PARTICIPANT, projectTypes } from "@hehuoda/client-domain/team";
import { useSessionStore } from "../stores/session";
import { openPage } from "../navigation/navigate";
import FormButton from "./FormButton.vue";
const session = useSessionStore();
const teams = computed(() =>
  session.teams.filter(
    (t) => !t.dissolved && t.members.some((m) => m.id === DEMO_PARTICIPANT.id),
  ),
);
const captainCount = computed(
  () =>
    teams.value.filter((t) =>
      t.members.some((m) => m.id === DEMO_PARTICIPANT.id && m.captain),
    ).length,
);
</script>
<template>
  <view class="my-teams">
    <text class="teams-title">我的队伍</text>
    <text class="teams-copy"
      >共 {{ teams.length }} 支 · 带领 {{ captainCount }} 支 · 加入
      {{ teams.length - captainCount }} 支</text
    >
    <text class="teams-copy"
      >以下为当前会话演示队伍，刷新或重置后恢复示例。</text
    >
    <view v-if="!teams.length" class="hhr-panel"
      >暂时没有加入或带领的队伍。</view
    >
    <view v-for="team in teams" :key="team.id" class="hhr-panel team-card">
      <text class="team-title">{{ team.title }}</text>
      <text class="teams-copy"
        >{{ projectTypes[team.type] }} ·
        {{
          team.members.some((m) => m.id === DEMO_PARTICIPANT.id && m.captain)
            ? "演示队长"
            : "演示成员"
        }}
        · {{ team.members.length }}/{{ team.capacity }} 人</text
      >
      <FormButton
        variant="secondary"
        @click="openPage('team-detail', { id: team.id })"
        >查看队伍详情</FormButton
      >
    </view>
  </view>
</template>
<style scoped>
.my-teams {
  display: grid;
  gap: 16px;
}
.teams-title {
  font-family: var(--hhr-font-display);
  font-size: 26px;
  font-weight: 600;
}
.team-title {
  display: block;
  font-size: 18px;
  font-weight: 600;
}
.teams-copy {
  display: block;
  color: var(--hhr-color-muted);
  font-size: 14px;
  line-height: 26px;
  overflow-wrap: anywhere;
}
.team-card {
  min-width: 0;
  padding: 20px;
}
.team-card :deep(.hhr-button) {
  width: auto;
  margin-top: 12px;
  max-width: 100%;
}
</style>
