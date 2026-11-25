<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  campusOptions,
  profileSkills,
  validateProfile,
  type DemoProfile,
} from "@hehuoda/client-domain/profile";
import { colleges } from "@hehuoda/client-domain/colleges";
import { nicknameProblem } from "../auth/auth-session";
import { beijingTime } from "../campus/presentation";
import { useAuthStore } from "../stores/auth";
import { useSessionStore } from "../stores/session";
import { useDraftForm } from "../forms/use-draft-form";
import { openPage } from "../navigation/navigate";
import AppIcon from "./AppIcon.vue";
import FormInput from "./FormInput.vue";
import FormPicker from "./FormPicker.vue";
import FormDialog from "./FormDialog.vue";
import FormButton from "./FormButton.vue";
import ProfileMenu from "./ProfileMenu.vue";

const auth = useAuthStore();
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

const nicknameOpened = ref(false);
const nicknameDraft = ref("");
const nicknameLocalError = ref("");
const nicknameFocus = ref(false);

const displayNickname = computed(() =>
  auth.authenticated ? auth.nickname || "禾伙搭用户" : session.profile.nickname,
);
const avatarInitial = computed(() => {
  if (!auth.authenticated) return "苗";
  return Array.from(displayNickname.value.trim())[0] || "禾";
});
const campusStatusLabel = computed(() => {
  if (!auth.authenticated) return "游客浏览 · 未登录学校账号";
  if (auth.campusStatus === "valid") return "学校账号 · 校园身份已验证";
  if (auth.campusStatus === "expired") return "学校账号 · 校园身份已过期";
  if (auth.campusStatus === "revoked") return "学校账号 · 校园身份已撤销";
  return "学校账号已登录";
});
const campusValidUntilText = computed(() => {
  if (!auth.authenticated || !auth.campus?.validUntil) return "";
  return beijingTime(auth.campus.validUntil);
});

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

function openLogin() {
  feedback.value = "";
  openPage("login", undefined, () => {
    feedback.value = "暂时无法打开登录页，请重试。";
  });
}

async function openNicknameEditor() {
  if (!auth.authenticated) return;
  feedback.value = "";
  nicknameDraft.value = auth.nickname;
  nicknameLocalError.value = "";
  nicknameOpened.value = true;
  nicknameFocus.value = false;
  await nextTick();
  if (nicknameOpened.value) nicknameFocus.value = true;
}

function closeNicknameEditor() {
  nicknameOpened.value = false;
  nicknameLocalError.value = "";
  nicknameFocus.value = false;
}

async function saveNickname() {
  if (auth.nicknamePending) return;
  const problem = nicknameProblem(nicknameDraft.value);
  if (problem) {
    nicknameLocalError.value = problem;
    return;
  }
  nicknameLocalError.value = "";
  const ok = await auth.updateNickname(nicknameDraft.value);
  if (ok) {
    closeNicknameEditor();
    feedback.value = "账号昵称已更新。";
  }
}

async function edit() {
  feedback.value = "";
  focusField.value = "";
  begin();
  await nextTick();
  if (opened.value) focusField.value = "major";
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

const unregister = session.registerReset("profile-editor", () => {
  cancel();
  closeNicknameEditor();
  feedback.value = "会话已重置，示例资料回到初始状态。";
});

watch(
  () => session.profile,
  () => {
    if (!submitting.value) cancel();
  },
);
watch(
  () => auth.authenticated,
  (authed) => {
    if (!authed) closeNicknameEditor();
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
        <ProfileMenu
          @edit="edit"
          @edit-nickname="openNicknameEditor"
          @notice="feedback = $event"
        />
      </view>
      <text class="block mt-2 text-sm text-muted"
        >把自己介绍给伙伴，也把下一次相遇留给可能。</text
      >
    </view>

    <view v-if="feedback" role="status" class="hhr-notice mb-4">{{
      feedback
    }}</view>

    <view
      v-if="auth.logoutNotice || auth.errorMessage"
      :role="
        auth.logoutRemoteUnconfirmed || auth.errorMessage ? 'alert' : 'status'
      "
      class="hhr-notice mb-4 profile-auth-banner"
    >
      <text class="block">{{ auth.logoutNotice || auth.errorMessage }}</text>
      <FormButton
        v-if="auth.logoutRemoteUnconfirmed"
        class="profile-banner-action"
        variant="secondary"
        :loading="auth.logoutPending"
        :disabled="auth.logoutPending"
        @click="auth.retryLogout()"
        >重试撤销远端会话</FormButton
      >
    </view>

    <view
      class="profile-panel"
      :aria-label="auth.authenticated ? '学校账号与示例资料' : '游客示例资料'"
    >
      <view class="profile-identity">
        <view class="profile-avatar" aria-hidden="true">{{
          avatarInitial
        }}</view>
        <view class="profile-identity-text">
          <text class="profile-name font-serif">{{ displayNickname }}</text>
          <text class="profile-account-badge">{{ campusStatusLabel }}</text>
          <text
            v-if="campusValidUntilText && campusValidUntilText !== '—'"
            class="block mt-1 text-xs text-muted"
            >认证有效期至 {{ campusValidUntilText }}</text
          >
          <text class="block mt-2 text-xs text-muted"
            >会话示例：四川农业大学 · {{ session.profile.campus }} ·
            {{ collegeName }} · {{ session.profile.grade }} 级</text
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

      <view
        v-if="auth.authenticated && auth.profileError"
        class="profile-sub-alert"
        role="alert"
      >
        <text class="text-xs">{{ auth.profileError }}</text>
        <FormButton variant="soft" @click="auth.reloadProfile()"
          >重新读取账号资料</FormButton
        >
      </view>

      <view class="profile-account-actions">
        <template v-if="auth.authenticated">
          <FormButton variant="secondary" @click="openNicknameEditor"
            >修改昵称</FormButton
          >
          <FormButton
            variant="soft"
            :loading="auth.logoutPending"
            :disabled="auth.logoutPending"
            @click="auth.logout()"
            >退出登录</FormButton
          >
        </template>
        <template v-else>
          <FormButton :disabled="auth.restoring" @click="openLogin">{{
            auth.restoring ? "正在恢复登录…" : "使用学校账号登录"
          }}</FormButton>
          <FormButton variant="secondary" @click="edit"
            >编辑示例资料</FormButton
          >
        </template>
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
      <text v-if="auth.authenticated"
        >账号昵称与校园身份状态来自服务端；专业、年级、技能与简介仅保留在当前会话内，收藏不会因退出或重新登录而清空。</text
      >
      <text v-else
        >当前游客浏览，专业、年级、技能与简介为会话示例，编辑仅影响本次会话。</text
      >
    </view>

    <FormDialog
      id="nickname-editor"
      :open="nicknameOpened"
      title="修改昵称"
      save-label="保存昵称"
      :saving="auth.nicknamePending"
      :error-target="
        nicknameLocalError || auth.nicknameError ? 'account-nickname-field' : ''
      "
      @save="saveNickname"
      @cancel="closeNicknameEditor"
    >
      <text class="block mb-3 text-xs text-muted"
        >昵称须为 1–20 个字，保存后将同步到服务端账号并在各页面生效。</text
      >
      <FormInput
        id="account-nickname"
        v-model="nicknameDraft"
        label="账号昵称"
        placeholder="请输入 1–20 个字的新昵称"
        :maxlength="20"
        :error="nicknameLocalError || auth.nicknameError"
        :focus="nicknameFocus"
        :disabled="auth.nicknamePending"
        autocomplete="off"
        @input="nicknameLocalError = ''"
        @confirm="saveNickname"
      />
    </FormDialog>

    <FormDialog
      id="profile-editor"
      :open="opened"
      title="编辑示例资料"
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
        :hint="
          auth.authenticated
            ? '修改真实账号昵称请使用「修改昵称」按钮。'
            : '登录学校账号后可修改真实昵称。'
        "
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
.profile-account-badge {
  display: inline-block;
  margin-top: 6px;
  padding: 2px 8px;
  border-radius: var(--hhr-radius-badge);
  background: var(--hhr-color-brand-soft);
  color: var(--hhr-color-brand);
  font-size: 12px;
  line-height: 1.5;
}
.profile-auth-banner {
  display: grid;
  gap: 10px;
}
.profile-banner-action {
  width: auto;
}
.profile-sub-alert {
  display: grid;
  gap: 8px;
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: var(--hhr-radius-control);
  background: var(--hhr-color-accent-soft);
  color: var(--hhr-color-accent-ink);
}
.profile-account-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}
.profile-account-actions :deep(.hhr-button) {
  width: auto;
  flex: 1 1 132px;
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
  flex: 1;
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
