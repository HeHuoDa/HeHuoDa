<script setup lang="ts">
import { computed } from "vue";
import {
  cooperationModes,
  projectTypes,
  roleOptions,
  type Role,
} from "@hehuoda/client-domain/team";
import FormButton from "./FormButton.vue";
import FormInput from "./FormInput.vue";
import FormPicker from "./FormPicker.vue";
import FormDateTime from "./FormDateTime.vue";
import type { ProfileTeamController } from "../stores/profile-team-controller";

const props = defineProps<{ controller: ProfileTeamController }>();
const state = props.controller.state;
// 弹层只在草稿存在时渲染，这里只做类型收窄，不复制草稿。
const draft = computed(() => state.draft!);
const typeOptions = Object.entries(projectTypes).map(([value, label]) => ({
  value,
  label,
}));
const modeOptions = Object.entries(cooperationModes).map(([value, label]) => ({
  value,
  label,
}));
const fields = [
  { key: "title", label: "招募标题（2–60 字）", max: 60 },
  { key: "goal", label: "目标介绍（10–2000 字）", max: 2000, multiline: true },
  { key: "progress", label: "当前进度（选填）", max: 500, multiline: true },
  { key: "skills", label: "技能与职责（选填）", max: 500, multiline: true },
  { key: "location", label: "合作地点（线上可留空）", max: 200 },
] as const;
function toggleRole(role: Role) {
  if (state.saving) return;
  draft.value.roles = draft.value.roles.includes(role)
    ? draft.value.roles.filter((value) => value !== role)
    : [...draft.value.roles, role];
}
</script>

<template>
  <view class="profile-team-editor">
    <text class="editor-copy"
      >编辑只更新这支队伍的会话内招募信息，保存后仅在当前会话生效。</text
    >
    <view id="profile-team-type-field">
      <FormPicker
        id="profile-team-type-control"
        v-model="draft.type"
        label="项目类型"
        :options="typeOptions"
        :error="state.errors.type"
        :disabled="state.saving"
      />
    </view>
    <template v-for="field in fields" :key="field.key">
      <view :id="`profile-team-${field.key}-field`">
        <FormInput
          :id="`profile-team-${field.key}-control`"
          v-model="draft[field.key]"
          :label="field.label"
          :maxlength="field.max"
          :multiline="'multiline' in field"
          :error="state.errors[field.key]"
          :disabled="state.saving"
        />
      </view>
      <view v-if="field.key === 'location'" id="profile-team-mode-field">
        <FormPicker
          id="profile-team-mode-control"
          v-model="draft.mode"
          label="合作方式"
          :options="modeOptions"
          :error="state.errors.mode"
          :disabled="state.saving"
        />
      </view>
    </template>
    <view id="profile-team-roles-field" class="roles-field">
      <text class="editor-label">角色需求（至少一项）</text>
      <view class="role-options">
        <FormButton
          v-for="role in roleOptions"
          :key="role"
          class="role-option"
          variant="secondary"
          :disabled="state.saving"
          :aria-label="`角色需求：${role}`"
          :aria-pressed="draft.roles.includes(role)"
          @click="toggleRole(role)"
        >
          <text
            class="role-check"
            :class="{ 'is-checked': draft.roles.includes(role) }"
            aria-hidden="true"
            >{{ draft.roles.includes(role) ? "✓" : "" }}</text
          >{{ role }}
        </FormButton>
      </view>
      <text v-if="state.errors.roles" role="alert" class="hhr-form-error">{{
        state.errors.roles
      }}</text>
    </view>
    <view id="profile-team-capacity-field">
      <FormInput
        id="profile-team-capacity-control"
        v-model="draft.capacity"
        label="队伍容量（含队长，2–20 人）"
        type="number"
        :error="state.errors.capacity"
        :disabled="state.saving"
      />
    </view>
    <view id="profile-team-deadline-field">
      <FormDateTime
        id="profile-team-deadline-control"
        v-model="draft.deadline"
        label="招募截止"
        :error="state.errors.deadline"
        :disabled="state.saving"
      />
    </view>
    <view id="profile-team-competition-field" class="editor-note">
      <text
        v-if="state.errors.competition || state.errors.trackId"
        role="alert"
        class="hhr-form-error"
        >{{ state.errors.competition || state.errors.trackId }}</text
      >
      <text class="editor-copy"
        >关联比赛与赛道沿用原招募，普通项目无需关联比赛；需要新建关联请回到发布流程。</text
      >
    </view>
    <text
      v-if="Object.keys(state.errors).length"
      role="alert"
      class="editor-error"
      >请修正字段错误后重试，已保留本次填写内容。</text
    >
  </view>
</template>

<style scoped>
.profile-team-editor {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.profile-team-editor :deep(.hhr-form-field) {
  margin-bottom: 0;
}
.editor-copy {
  display: block;
  font-size: 12px;
  line-height: 24px;
  color: var(--hhr-color-muted);
  overflow-wrap: anywhere;
}
.editor-label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
}
.role-options {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.profile-team-editor :deep(.role-option) {
  display: flex;
  align-items: center;
  gap: 8px;
  width: auto;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--hhr-color-line);
  border-radius: var(--hhr-radius-control);
  font-size: 14px;
  font-weight: 400;
  color: var(--hhr-color-ink);
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
.editor-note {
  display: grid;
  gap: 8px;
}
.editor-error {
  font-size: 14px;
  color: var(--hhr-color-danger);
}
</style>
