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
import { openPage, openProfileSection } from "../navigation/navigate";
import AppIcon from "./AppIcon.vue";
import FormInput from "./FormInput.vue";
import FormPicker from "./FormPicker.vue";
import FormDialog from "./FormDialog.vue";
import FormButton from "./FormButton.vue";
import ProfileTeamsReadOnly from "./ProfileTeamsReadOnly.vue";

const session = useSessionStore();
const stats = computed(() => [
  ...["我的队伍", "待处理邀请", "我的申请"].map((label) => ({
    label,
    count: "—",
    note: "待接入",
  })),
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
const collegeName = computed(
  () =>
    colleges.find((c) => c.id === session.profile.collegeId)?.name ??
    "学院待选择",
);
const campusChoices = campusOptions.map((value) => ({ value, label: value }));
const collegeChoices = colleges.map((c) => ({ value: c.id, label: c.name }));
const fields: {
  key: "nickname" | "major" | "grade" | "skills";
  label: string;
  max: number;
  hint?: string;
}[] = [
  { key: "nickname", label: "昵称", max: 20 },
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
    label: "我的队伍",
    description: "加入与带领的队伍",
    icon: "team" as const,
    action: () => openProfileSection("teams"),
  },
  {
    label: "申请与邀请",
    description: "跟进你的组队进展",
    icon: "mail" as const,
    action: () => openProfileSection("applications"),
  },
  {
    label: "我的收藏",
    description: "回看心动的比赛",
    icon: "star" as const,
    action: () => openPage("favorites"),
  },
  {
    label: "站内通知",
    description: "不错过重要消息",
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
function reset() {
  cancel();
  session.resetProfile();
  feedback.value = "资料与授权已重置为初始示例，联系方式默认不共享。";
}
function authorize(event: unknown) {
  const value = (event as { detail?: { value?: unknown } })?.detail?.value;
  if (typeof value !== "boolean") return;
  session.contactShared = value;
  feedback.value = session.contactShared
    ? "已开启授权演示，仅在所有者授权且双方均为同队有效成员时允许展示；未提供真实联系方式。"
    : "已关闭授权演示，联系方式不共享。";
}
function authorizationKey(event: {
  key?: string;
  repeat?: boolean;
  preventDefault?: () => void;
}) {
  if (event.key !== " " && event.key !== "Enter") return;
  event.preventDefault?.();
  if (!event.repeat) authorize({ detail: { value: !session.contactShared } });
}
// 外部统一重置、页面切换均丢弃编辑草稿，避免旧资料再次写回。
const unregister = session.registerReset("profile-editor", () => {
  cancel();
  feedback.value = "演示会话已重置，联系方式默认不共享。";
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
        <FormButton
          variant="secondary"
          class="profile-edit-button"
          @click="edit"
          ><AppIcon name="pencil" :size="16" />编辑资料</FormButton
        >
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
          <text class="profile-name font-serif">{{
            session.profile.nickname
          }}</text>
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
          ><text class="block text-sm font-semibold"
            >{{ link.label
            }}<text
              v-if="link.icon === 'bell'"
              class="notification-count"
              :aria-label="`${session.unreadNotificationCount} 条未读通知`"
              >{{ session.unreadNotificationCount }}</text
            ></text
          ><text class="block text-xs text-muted">{{
            link.description
          }}</text></view
        >
      </FormButton>
    </view>
    <view class="profile-lower">
      <ProfileTeamsReadOnly />
      <view class="profile-panel">
        <text class="font-serif text-xl">资料与设置</text>
        <view class="profile-setting-row">
          <AppIcon name="shield" :size="20" class="text-brand" />
          <label class="flex-1 text-sm" for="profile-contact"
            >联系方式授权<text class="block mt-1 text-xs text-muted">{{
              session.contactShared ? "演示已授权" : "未授权 · 不共享"
            }}</text></label
          >
          <switch
            id="profile-contact"
            class="profile-contact-switch"
            :checked="session.contactShared"
            color="var(--hhr-color-brand)"
            role="switch"
            tabindex="0"
            :aria-checked="session.contactShared"
            aria-label="允许同队有效成员查看（演示）"
            @change="authorize"
            @keydown="authorizationKey"
          />
        </view>
        <view class="profile-setting-row">
          <AppIcon name="leaf" :size="20" class="text-brand" /><view
            class="flex-1 text-sm"
            >关于禾伙搭<text class="block mt-1 text-xs text-muted"
              >一起成长，各有所长。</text
            ></view
          >
        </view>
        <view class="profile-notice"
          >默认不共享。仅在所有者授权后，同队有效成员才能查看；申请者、未确认的受邀者和已退出成员不能查看。仅演示授权状态，未提供真实联系方式。</view
        >
      </view>
    </view>
    <view
      class="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-muted"
    >
      <text>当前展示示例资料，编辑仅影响本次会话。</text>
      <FormButton variant="secondary" class="profile-reset" @click="reset"
        >重置示例</FormButton
      >
      <view class="flex gap-4"
        ><FormButton
          variant="secondary"
          class="profile-auth-link"
          @click="openPage('login')"
        >
          登录</FormButton
        ><FormButton
          variant="secondary"
          class="profile-auth-link"
          @click="openPage('register')"
        >
          注册
        </FormButton></view
      >
    </view>
    <FormDialog
      id="profile-editor"
      :open="opened"
      title="编辑示例资料"
      save-label="保存示例资料"
      :saving="submitting"
      :error-target="firstError ? `profile-${firstError}-field` : ''"
      @save="save"
      @cancel="cancel"
    >
      <text class="block mb-4 text-xs text-muted"
        >请勿填写真实联系方式。校区为示例选项，学院复用本地业务目录稳定
        ID；均为自填信息。</text
      >
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
        >保存仅更新会话内前端演示，不表示服务器保存。</text
      >
    </FormDialog>
  </view>
</template>

<style scoped>
.notification-count {
  display: inline-block;
  margin-left: 0.5rem;
  padding: 0.125rem 0.5rem;
  border-radius: var(--hhr-radius-badge);
  color: var(--hhr-color-brand);
  background: var(--hhr-color-brand-soft);
  font-size: 0.75rem;
  overflow-wrap: anywhere;
}
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
.profile-edit-button {
  display: inline-flex;
  width: auto;
  gap: 8px;
  align-items: center;
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
.profile-shortcut::after,
.profile-reset::after,
.profile-auth-link::after {
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
.profile-lower {
  display: grid;
  grid-template-columns: 1.45fr 1fr;
  gap: 24px;
}
.profile-setting-row {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 18px 0;
}
.profile-contact-switch {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  min-height: 44px;
}
.profile-setting-row:first-of-type {
  margin-top: 16px;
}
.profile-setting-row + .profile-setting-row {
  border-top: 1px solid var(--hhr-color-line);
}
.profile-notice {
  margin-top: 20px;
  padding: 14px;
  border-radius: 10px;
  background: var(--hhr-color-page);
  color: var(--hhr-color-muted);
  font-size: 11px;
  line-height: 1.8;
}
.profile-reset {
  width: auto;
  border: 0;
  font-weight: 400;
  color: var(--hhr-color-muted);
  text-decoration: underline;
  text-underline-offset: 3px;
  padding: 8px 0;
  min-height: 44px;
  background: transparent;
  font-size: 12px;
  margin: 0;
}
.profile-auth-link {
  width: auto;
  border: 0;
  font-weight: 400;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  color: var(--hhr-color-brand);
  background: transparent;
  font-size: 12px;
  margin: 0;
  padding: 0;
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
  .profile-lower {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 600px) {
  .profile-edit-button {
    padding: 8px 10px;
    font-size: 13px;
  }
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
  .profile-lower {
    gap: 18px;
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
