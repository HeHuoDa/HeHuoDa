<script setup lang="ts">
// 队伍管理与申请分区共用同一个确认弹层，文案与提交契约只维护一份。
import type { ProfileTeamController } from "../stores/profile-team-controller";
import FormDialog from "./FormDialog.vue";

const props = defineProps<{ controller: ProfileTeamController }>();
const controller = props.controller;
const state = controller.state;
</script>

<template>
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
</template>

<style scoped>
.profile-team-confirm-dialog :deep(.hhr-dialog-panel) {
  max-width: 480px;
  max-height: 320px;
}
.dialog-copy {
  display: block;
  margin-bottom: 12px;
  font-size: 14px;
  line-height: 26px;
  color: var(--hhr-color-muted);
}
</style>
