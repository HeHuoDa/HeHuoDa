<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  campusOptions,
  profileSkills,
  validateProfile,
  type DemoProfile,
} from "@hehuoda/client-domain/profile";
import { colleges } from "@hehuoda/client-domain/colleges";
import { useSessionStore } from "../stores/session";
import { useDraftForm } from "../forms/use-draft-form";
import { openPage } from "../navigation/navigate";
import AppIcon from "./AppIcon.vue";
import FormInput from "./FormInput.vue";
import FormPicker from "./FormPicker.vue";
import FormDialog from "./FormDialog.vue";
import FormButton from "./FormButton.vue";
import ProfileMenu from "./ProfileMenu.vue";

const session = useSessionStore();
const stats = computed(() => [
  { label: "收藏比赛", count: session.favoriteCount, note: "当前会话" },
]);
const feedback = ref("");
const focusField = ref("");
const {
  opened,
  draft,
  errors,
  firstError,
  submitting,
  submitError,
  begin,
  cancel,
  submit,
} = useDraftForm<DemoProfile>({
  read: () => session.profile,
  clone: (value) => ({ ...value }),
  validate: validateProfile,
  save: session.saveProfile,
});
/** 昵称与其它资料均为会话内示例：登录未开放，不提供账号写入入口。 */
const displayNickname = computed(() => session.profile.nickname);
const collegeName = computed(
  () =>
    colleges.find((c) => c.id === session.profile.collegeId)?.name ??
    "学院待选择",
);
const campusChoices = campusOptions.map((value) => ({ value, label: value }));
const collegeChoices = colleges.map((c) => ({ value: c.id, label: c.name }));
const fields: {
  key: "major" | "grade" | "skills";
  label: string;
  max: number;
  hint?: string;
}[] = [
  { key: "major", label: "专业", max: 60 },
  {
    key: "grade",
    label: "入学年级",
    max: 4,
    hint: "四位年份，例如 2024；自填，不代表学籍认证。",
  },
  {
    key: "skills",
    label: "技能（选填）",
    max: 168,
    hint: "用顿号或逗号分隔，最多 8 项，每项 20 字。",
  },
];
const links = [
  {
    label: "我的收藏",
    description: "回看心动的比赛",
    icon: "star" as const,
    action: () => openPage("favorites"),
  },
  {
    label: "站内通知",
    description: "组队恢复后开放",
    icon: "bell" as const,
    action: () => openPage("notifications"),
  },
];
async function edit() {
  feedback.value = "";
  focusField.value = "";
  begin();
  await nextTick();
  if (opened.value) focusField.value = "nickname";
}
async function save() {
  focusField.value = "";
  if (submit()) {
    feedback.value =
      "示例资料已更新，仅保留在当前会话内；未保存到服务器，刷新恢复初始示例。";
    return;
  }
  await nextTick();
  if (opened.value) focusField.value = firstError.value;
}
// 外部统一重置、页面切换均丢弃编辑草稿，避免旧资料再次写回。
const unregister = session.registerReset("profile-editor", () => {
  cancel();
  feedback.value = "会话已重置，示例资料回到初始状态。";
});
watch(
  () => session.profile,
  () => {
    if (!submitting.value) cancel();
  },
);
onBeforeUnmount(unregister);
</script>

<template>
  <view class="profile-page">
    <view class="profile-heading">
      <text class="block mb-2 text-xs tracking-[0.2em] text-brand"
        >A LITTLE SPACE FOR YOU</text
      >
      <view class="flex flex-wrap items-center justify-between gap-3">
        <text class="profile-title font-serif font-semibold">个人中心</text>
        <!-- 账号与设置入口：登录说明、编辑资料与关于都收在这个下拉里。 -->
        <ProfileMenu @edit="edit" @notice="feedback = $event" />
      </view>
      <text class="block mt-2 text-sm text-muted"
        >把自己介绍给伙伴，也把下一次相遇留给可能。</text
      >
    </view>
    <view v-if="feedback" role="status" class="hhr-notice mb-4">{{
      feedback
    }}</view>
    <view class="profile-panel" aria-label="示例个人资料">
      <view class="profile-identity">
        <view class="profile-avatar" aria-hidden="true">苗</view>
        <view class="profile-identity-text">
          <text class="profile-name font-serif">{{ displayNickname }}</text>
          <text class="block mt-2 text-xs text-muted"
            >四川农业大学 · {{ session.profile.campus }} · {{ collegeName }} ·
            {{ session.profile.grade }} 级</text
          >
          <text class="block mt-1 text-xs text-muted">{{
            session.profile.major
          }}</text>
          <view class="mt-3 flex flex-wrap gap-2">
            <text
              v-for="skill in profileSkills(session.profile.skills)"
              :key="skill"
              class="rounded-badge bg-brand-soft px-2 py-1 text-xs text-brand"
              >{{ skill }}</text
            >
            <text class="rounded-badge bg-accent-soft px-2 py-1 text-xs"
              >愿意一起学习</text
            >
          </view>
        </view>
      </view>
      <text class="block mt-5 whitespace-pre-wrap text-sm text-muted">{{
        session.profile.bio || "还没有填写简介，期待和伙伴一起成长。"
      }}</text>
      <view class="profile-stats" aria-label="个人业务统计，收藏为当前会话数量">
        <view v-for="stat in stats" :key="stat.label" class="profile-stat">
          <text class="profile-stat-number">{{ stat.count }}</text
          ><text class="block text-xs text-muted">{{ stat.label }}</text
          ><text class="block text-xs text-muted">{{ stat.note }}</text>
        </view>
      </view>
    </view>
    <view class="profile-shortcuts">
      <FormButton
        v-for="link in links"
        :key="link.label"
        class="profile-shortcut"
        variant="secondary"
        @click="link.action"
      >
        <view class="profile-tile-icon"
          ><AppIcon :name="link.icon" :size="20"
        /></view>
        <view class="profile-link-text"
          ><text class="block text-sm font-semibold">{{ link.label }}</text
          ><text class="block text-xs text-muted">{{
            link.description
          }}</text></view
        >
      </FormButton>
    </view>
    <view class="mt-6 text-xs text-muted">
      <text>当前免登录浏览，展示的是示例资料；编辑仅影响本次会话。</text>
    </view>
    <FormDialog
      id="profile-editor"
      :open="opened"
      title="编辑资料"
      save-label="保存资料"
      :saving="submitting"
      :error-target="firstError ? `profile-${firstError}-field` : ''"
      @save="save"
      @cancel="cancel"
    >
      <text class="block mb-4 text-xs text-muted"
        >以下为示例资料，请勿填写真实联系方式。校区为示例选项，学院复用本地业务目录稳定
        ID。</text
      >
      <FormInput
        id="profile-nickname"
        :model-value="displayNickname"
        label="昵称"
        disabled
        hint="统一身份认证开放后可修改昵称。"
      />
      <view class="profile-form">
        <FormInput
          v-for="field in fields"
          :id="`profile-${field.key}`"
          :key="field.key"
          v-model="draft[field.key]"
          :label="field.label"
          :maxlength="field.max"
          :hint="field.hint"
          :error="errors[field.key]"
          :focus="focusField === field.key"
        />
        <FormPicker
          id="profile-campus"
          v-model="draft.campus"
          label="校区（自填示例）"
          :options="campusChoices"
          :error="errors.campus"
          :focus="focusField === 'campus'"
        />
        <FormPicker
          id="profile-collegeId"
          v-model="draft.collegeId"
          label="学院（本地业务目录）"
          :options="collegeChoices"
          :error="errors.collegeId"
          :focus="focusField === 'collegeId'"
        />
      </view>
      <FormInput
        id="profile-bio"
        v-model="draft.bio"
        label="简介（选填，最多 200 字）"
        multiline
        :maxlength="200"
        :error="errors.bio"
        :focus="focusField === 'bio'"
      />
      <text v-if="submitError" role="alert" class="block text-sm text-danger">{{
        submitError
      }}</text>
      <text class="block my-4 text-xs text-muted"
        >保存仅更新当前会话内的示例资料，不表示服务器保存；刷新后恢复初始示例。</text
      >
    </FormDialog>
  </view>
</template>

<style scoped>
.profile-page {
  min-width: 0;
  overflow-wrap: anywhere;
}
.profile-page .text-sm {
  font-size: 14px;
}
.profile-page .text-xs {
  font-size: 12px;
}
.profile-stat .text-xs {
  font-size: 11px;
}
.profile-heading {
  margin-bottom: 28px;
}
.profile-title {
  font-size: 30px;
}
.profile-name {
  display: block;
  font-size: 24px;
}
.profile-panel {
  background: var(--hhr-color-surface);
  border: 1px solid var(--hhr-color-line);
  border-radius: var(--hhr-radius-panel);
  padding: 26px;
  min-width: 0;
}
.profile-identity {
  display: flex;
  align-items: center;
  gap: 20px;
}
.profile-identity-text {
  min-width: 0;
}
.profile-avatar {
  display: grid;
  place-items: center;
  width: 78px;
  height: 78px;
  flex-shrink: 0;
  border-radius: 24px;
  background: var(--hhr-color-brand-soft);
  color: var(--hhr-color-brand);
  font-family: var(--hhr-font-display);
  font-size: 38px;
}
.profile-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-top: 24px;
  text-align: center;
}
.profile-stat + .profile-stat {
  border-left: 1px solid var(--hhr-color-line);
}
.profile-stat-number {
  display: block;
  padding: 8px 0 5px;
  color: var(--hhr-color-brand);
  font: 30px var(--hhr-font-display);
}
.profile-shortcuts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin: 24px 0;
}
.profile-shortcut {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px;
  border: 1px solid var(--hhr-color-line);
  background: var(--hhr-color-surface);
  border-radius: var(--hhr-radius-card);
  min-width: 0;
  margin: 0;
  line-height: 1.5;
  text-align: left;
  color: var(--hhr-color-ink);
  font-weight: 400;
}
.profile-shortcut::after {
  border: 0;
}
.profile-link-text {
  min-width: 0;
}
.profile-tile-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--hhr-color-brand-soft);
  color: var(--hhr-color-brand);
}
.profile-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
@media (max-width: 1100px) {
  .profile-shortcuts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 600px) {
  .profile-panel {
    padding: 20px;
  }
  .profile-form {
    grid-template-columns: 1fr;
  }
  .profile-shortcut {
    padding: 16px 12px;
    gap: 10px;
  }
  .profile-shortcuts {
    margin: 18px 0;
    gap: 10px;
  }
  .profile-tile-icon {
    width: 35px;
    height: 35px;
    border-radius: 10px;
  }
  .profile-avatar {
    width: 65px;
    height: 65px;
    border-radius: 20px;
    font-size: 31px;
  }
  .profile-identity {
    gap: 14px;
  }
  .profile-name {
    font-size: 23px;
  }
  .profile-identity-text > .text-xs {
    font-size: 13px;
  }
  .profile-stats {
    margin-top: 18px;
  }
  .profile-stat-number {
    font-size: 26px;
  }
  .profile-heading {
    margin-bottom: 20px;
  }
  .profile-title {
    font-size: 27px;
  }
  .profile-heading > .text-sm {
    font-size: 12px;
  }
}
</style>
