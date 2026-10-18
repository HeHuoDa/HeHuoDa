<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import AppIcon from "../components/AppIcon.vue";
import ProfileTeams from "../components/ProfileTeams.vue";
import type { AppIconName } from "../components/app-icons";
import { colleges } from "../data/colleges";
import {
  campusOptions,
  profileSkills,
  useProfileDemoStore,
  validateProfile,
  type DemoProfile,
} from "../data/profile-demo";

const route = useRoute();
const store = useProfileDemoStore();
const section = computed(() =>
  route.query.section === "teams"
    ? "teams"
    : route.query.section === "applications"
      ? "applications"
      : "profile",
);
const collegeName = computed(
  () =>
    colleges.find((c) => c.id === store.profile.collegeId)?.name ??
    "学院待选择",
);
const editing = ref(false);
const draft = ref<DemoProfile>({ ...store.profile });
const errors = ref<Partial<Record<keyof DemoProfile, string>>>({});
const feedback = ref("");
const editor = ref<HTMLFormElement>();
const dialog = ref<HTMLDialogElement>();
const editButton = ref<HTMLButtonElement>();
let previousOverflow: string | undefined;
const links: {
  label: string;
  description: string;
  to: string;
  icon: AppIconName;
}[] = [
  {
    label: "我的队伍",
    description: "加入与带领的队伍",
    to: "/profile?section=teams",
    icon: "team",
  },
  {
    label: "申请与邀请",
    description: "跟进你的组队进展",
    to: "/profile?section=applications",
    icon: "mail",
  },
  {
    label: "我的收藏",
    description: "回看心动的比赛",
    to: "/my/favorites",
    icon: "star",
  },
  {
    label: "站内通知",
    description: "不错过重要消息",
    to: "/notifications",
    icon: "bell",
  },
];
const fields: {
  key: keyof DemoProfile;
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
async function startEdit() {
  draft.value = { ...store.profile };
  errors.value = {};
  feedback.value = "";
  editing.value = true;
  await nextTick();
  if (!editing.value || !dialog.value) return;
  dialog.value.showModal();
  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  editor.value?.querySelector<HTMLInputElement>("input")?.focus();
}
function restoreScroll() {
  if (previousOverflow === undefined) return;
  document.body.style.overflow = previousOverflow;
  previousOverflow = undefined;
}
async function finishEdit() {
  dialog.value?.close();
  editing.value = false;
  draft.value = { ...store.profile };
  errors.value = {};
  restoreScroll();
  await nextTick();
  editButton.value?.focus();
}
function trapFocus(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const controls = dialog.value?.querySelectorAll<HTMLElement>(
    "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
  );
  if (!controls?.length) return;
  const first = controls[0]!;
  const last = controls[controls.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
watch(section, () => {
  if (editing.value) void finishEdit();
});
onBeforeUnmount(() => {
  dialog.value?.close();
  restoreScroll();
});
async function save() {
  errors.value = validateProfile(draft.value);
  if (Object.keys(errors.value).length) {
    await nextTick();
    editor.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    return;
  }
  store.save(draft.value);
  feedback.value =
    "示例资料已更新，仅保留在当前会话内；未保存到服务器，刷新恢复初始示例。";
  await finishEdit();
}
function reset() {
  store.reset();
  draft.value = { ...store.profile };
  errors.value = {};
  feedback.value = "资料与授权已重置为初始示例，联系方式默认不共享。";
}
function authorizationChanged() {
  feedback.value = store.contactShared
    ? "已开启授权演示，仅改变本页状态，不控制真实访问权限。"
    : "已关闭授权演示，联系方式不共享。";
}
</script>

<template>
  <div class="profile-page">
    <header class="profile-heading">
      <p class="mb-2 text-xs tracking-[0.2em] text-brand">
        A LITTLE SPACE FOR YOU
      </p>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="font-serif text-3xl font-semibold">个人中心</h1>
        <button
          v-if="section === 'profile'"
          ref="editButton"
          type="button"
          class="hhr-button hhr-button--secondary profile-edit-button"
          @click="startEdit"
        >
          <AppIcon name="pencil" class="size-4" />编辑资料
        </button>
      </div>
      <p class="mt-2 text-sm text-muted">
        把自己介绍给伙伴，也把下一次相遇留给可能。
      </p>
    </header>
    <nav
      v-if="section !== 'profile'"
      aria-label="个人中心分区"
      class="profile-sections"
    >
      <RouterLink
        :to="{
          path: '/profile',
          query: { ...route.query, section: undefined },
        }"
        >← 返回个人中心</RouterLink
      >
      <RouterLink
        :to="{ path: '/profile', query: { ...route.query, section: 'teams' } }"
        :aria-current="section === 'teams' ? 'page' : undefined"
        >我的队伍</RouterLink
      >
      <RouterLink
        :to="{
          path: '/profile',
          query: { ...route.query, section: 'applications' },
        }"
        :aria-current="section === 'applications' ? 'page' : undefined"
        >申请与邀请</RouterLink
      >
    </nav>
    <p
      v-if="feedback"
      role="status"
      class="my-4 rounded-control bg-brand-soft p-3 text-sm text-brand"
    >
      {{ feedback }}
    </p>
    <template v-if="section === 'profile'">
      <section class="profile-panel" aria-label="示例个人资料">
        <div class="profile-identity">
          <div class="profile-avatar" aria-hidden="true">苗</div>
          <div class="min-w-0">
            <h2 class="font-serif text-2xl">{{ store.profile.nickname }}</h2>
            <p class="mt-2 text-xs text-muted">
              四川农业大学 · {{ store.profile.campus }} · {{ collegeName }} ·
              {{ store.profile.grade }} 级
            </p>
            <p class="mt-1 text-xs text-muted">{{ store.profile.major }}</p>
            <div class="mt-3 flex flex-wrap gap-2">
              <span
                v-for="skill in profileSkills(store.profile.skills)"
                :key="skill"
                class="rounded-badge bg-brand-soft px-2 py-1 text-xs text-brand"
                >{{ skill }}</span
              ><span class="rounded-badge bg-accent-soft px-2 py-1 text-xs"
                >愿意一起学习</span
              >
            </div>
          </div>
        </div>
        <p class="mt-5 whitespace-pre-wrap text-sm text-muted">
          {{ store.profile.bio || "还没有填写简介，期待和伙伴一起成长。" }}
        </p>
        <div class="profile-stats" aria-label="个人业务统计尚未接入">
          <div
            v-for="label in ['我的队伍', '待处理邀请', '我的申请', '收藏比赛']"
            :key="label"
          >
            <strong>—</strong><span>{{ label }}</span
            ><small>待接入</small>
          </div>
        </div>
      </section>
      <dialog
        v-if="editing"
        ref="dialog"
        class="profile-edit-dialog"
        aria-labelledby="profile-edit-title"
        aria-describedby="profile-edit-description"
        @cancel.prevent="finishEdit"
        @keydown="trapFocus"
      >
        <form
          ref="editor"
          class="profile-editor"
          novalidate
          @submit.prevent="save"
        >
          <div class="profile-editor-heading">
            <h2 id="profile-edit-title" class="font-serif text-xl">
              编辑示例资料
            </h2>
            <button
              type="button"
              class="hhr-button hhr-button--secondary"
              aria-label="关闭编辑资料"
              @click="finishEdit"
            >
              关闭
            </button>
          </div>
          <div class="profile-editor-body">
            <p id="profile-edit-description" class="mb-4 text-xs text-muted">
              请勿填写真实联系方式。校区为示例选项，学院复用本地业务目录稳定
              ID；均为自填信息。
            </p>
            <div class="profile-form">
              <div v-for="field in fields" :key="field.key">
                <label :for="'profile-' + field.key" class="auth-label">{{
                  field.label
                }}</label>
                <input
                  :id="'profile-' + field.key"
                  v-model="draft[field.key]"
                  class="hhr-input"
                  :maxlength="field.max"
                  :aria-invalid="!!errors[field.key]"
                  :aria-describedby="'profile-' + field.key + '-help'"
                  :inputmode="field.key === 'grade' ? 'numeric' : 'text'"
                />
                <p
                  :id="'profile-' + field.key + '-help'"
                  class="mt-1 text-xs"
                  :class="errors[field.key] ? 'text-danger' : 'text-muted'"
                  :role="errors[field.key] ? 'alert' : undefined"
                >
                  {{ errors[field.key] || field.hint }}
                </p>
              </div>
              <div>
                <label for="profile-campus" class="auth-label"
                  >校区（自填示例）</label
                ><select
                  id="profile-campus"
                  v-model="draft.campus"
                  class="hhr-input"
                  :aria-invalid="!!errors.campus"
                  aria-describedby="profile-campus-help"
                >
                  <option value="">请选择</option>
                  <option v-for="campus in campusOptions" :key="campus">
                    {{ campus }}
                  </option>
                </select>
                <p
                  id="profile-campus-help"
                  class="text-xs text-danger"
                  role="alert"
                >
                  {{ errors.campus }}
                </p>
              </div>
              <div>
                <label for="profile-collegeId" class="auth-label"
                  >学院（本地业务目录）</label
                ><select
                  id="profile-collegeId"
                  v-model="draft.collegeId"
                  class="hhr-input"
                  :aria-invalid="!!errors.collegeId"
                  aria-describedby="profile-college-help"
                >
                  <option value="">请选择</option>
                  <option
                    v-for="college in colleges"
                    :key="college.id"
                    :value="college.id"
                  >
                    {{ college.name }}
                  </option>
                </select>
                <p
                  id="profile-college-help"
                  class="text-xs text-danger"
                  role="alert"
                >
                  {{ errors.collegeId }}
                </p>
              </div>
            </div>
            <label for="profile-bio" class="auth-label mt-4"
              >简介（选填，最多 200 字）</label
            ><textarea
              id="profile-bio"
              v-model="draft.bio"
              rows="4"
              maxlength="200"
              class="hhr-input"
              :aria-invalid="!!errors.bio"
              aria-describedby="profile-bio-help"
            />
            <p id="profile-bio-help" class="text-xs text-danger" role="alert">
              {{ errors.bio }}
            </p>
            <p class="my-4 text-xs text-muted">
              保存仅更新会话内前端演示，不表示服务器保存。
            </p>
          </div>
          <div class="profile-editor-actions flex flex-wrap gap-3">
            <button type="submit" class="hhr-button">保存示例资料</button
            ><button
              type="button"
              class="hhr-button hhr-button--secondary"
              @click="finishEdit"
            >
              取消编辑
            </button>
          </div>
        </form>
      </dialog>
    </template>
    <div v-if="section === 'profile'" class="profile-shortcuts">
      <RouterLink
        v-for="link in links"
        :key="link.to"
        :to="link.to"
        class="profile-shortcut"
        ><span class="profile-tile-icon"
          ><AppIcon :name="link.icon" class="size-5" /></span
        ><span
          ><strong class="block text-sm">{{ link.label }}</strong
          ><small class="text-xs text-muted">{{
            link.description
          }}</small></span
        ></RouterLink
      >
    </div>
    <div
      class="profile-lower"
      :class="{ 'profile-lower--single': section !== 'profile' }"
    >
      <ProfileTeams :section="section" />
      <section
        v-if="section === 'profile'"
        class="profile-panel"
        aria-labelledby="profile-settings"
      >
        <h2 id="profile-settings" class="font-serif text-xl">资料与设置</h2>
        <label class="profile-setting-row">
          <AppIcon name="shield" class="size-5 text-brand" />
          <span class="flex-1 text-sm"
            >联系方式授权<small class="mt-1 block text-xs text-muted">{{
              store.contactShared ? "演示已授权" : "未授权 · 不共享"
            }}</small></span
          >
          <input
            v-model="store.contactShared"
            type="checkbox"
            class="size-5 shrink-0 accent-brand"
            aria-label="允许同队有效成员查看（演示）"
            @change="authorizationChanged"
          />
        </label>
        <div class="profile-setting-row">
          <AppIcon name="leaf" class="size-5 text-brand" /><span
            class="flex-1 text-sm"
            >关于禾伙搭<small class="mt-1 block text-xs text-muted"
              >一起成长，各有所长。</small
            ></span
          >
        </div>
        <p class="profile-notice">
          默认不共享。仅在所有者授权后，同队有效成员才能查看；申请者、未确认的受邀者和已退出成员不能查看。仅演示授权状态，未提供真实联系方式。
        </p>
      </section>
    </div>
    <footer
      class="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-muted"
    >
      <p>人物与队伍均为示例 · 资料修改仅在本次会话保留，刷新恢复。</p>
      <button
        v-if="section === 'profile'"
        type="button"
        class="profile-reset"
        @click="reset"
      >
        重置示例
      </button>
      <div class="flex gap-4">
        <RouterLink to="/login" class="profile-auth-link text-brand"
          >登录</RouterLink
        ><RouterLink to="/register" class="profile-auth-link text-brand"
          >注册</RouterLink
        >
      </div>
    </footer>
  </div>
</template>
<style scoped>
.profile-edit-dialog {
  margin: auto;
  width: calc(100% - 32px);
  max-width: 680px;
  max-height: calc(100dvh - 32px);
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--hhr-color-line);
  border-radius: var(--hhr-radius-panel);
  background: var(--hhr-color-surface);
  color: var(--hhr-color-ink);
}
.profile-edit-dialog::backdrop {
  background: rgb(24 62 48 / 35%);
}
.profile-editor {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 34px);
}
.profile-editor-heading,
.profile-editor-actions {
  flex-shrink: 0;
  padding: 16px 24px;
}
.profile-editor-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--hhr-color-line);
}
.profile-editor-body {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 20px 24px 0;
}
.profile-editor-actions {
  border-top: 1px solid var(--hhr-color-line);
  padding-bottom: max(16px, env(safe-area-inset-bottom));
}
@media (max-width: 600px) {
  .profile-editor-heading,
  .profile-editor-actions,
  .profile-editor-body {
    padding-inline: 16px;
  }
  .profile-editor-actions > button {
    flex: 1;
  }
}
.profile-heading {
  margin-bottom: 28px;
}
.profile-identity {
  display: flex;
  align-items: center;
  gap: 20px;
}
.profile-edit-button {
  display: inline-flex;
  gap: 8px;
  align-items: center;
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
.profile-team-list {
  margin-top: 24px;
}
.profile-list-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 0;
}
.profile-list-item + .profile-list-item {
  border-top: 1px solid var(--hhr-color-line);
}
.profile-list-item:first-child {
  padding-top: 0;
}
.profile-list-thumb {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  background: var(--hhr-color-brand-soft);
  color: var(--hhr-color-brand);
  border-radius: 12px;
}
.profile-tag {
  padding: 4px 9px;
  border-radius: 5px;
  font-size: 11px;
  color: var(--hhr-color-brand);
  background: var(--hhr-color-brand-soft);
  flex-shrink: 0;
}
.profile-sample-label {
  color: var(--hhr-color-muted);
  font-size: 11px;
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
.profile-setting-row {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 18px 0;
}
.profile-setting-row:first-of-type {
  margin-top: 16px;
}
.profile-setting-row + .profile-setting-row {
  border-top: 1px solid var(--hhr-color-line);
}
.profile-reset {
  color: var(--hhr-color-muted);
  text-decoration: underline;
  text-underline-offset: 3px;
  padding: 8px 0;
  min-height: 44px;
}
.profile-auth-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
}

.profile-panel {
  background: var(--hhr-color-surface);
  border: 1px solid var(--hhr-color-line);
  border-radius: var(--hhr-radius-panel);
  padding: 26px;
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
.profile-sections {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--hhr-color-line);
  padding-bottom: 12px;
}
.profile-sections a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 10px 12px;
  border-radius: var(--hhr-radius-control);
  font-size: 13px;
}
.profile-sections a[aria-current] {
  background: var(--hhr-color-brand-soft);
  color: var(--hhr-color-brand);
  font-weight: 600;
}
.profile-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-top: 24px;
  text-align: center;
}
.profile-stats > div + div {
  border-left: 1px solid var(--hhr-color-line);
}
.profile-stats strong {
  display: block;
  padding: 8px 0 5px;
  color: var(--hhr-color-brand);
  font: 30px var(--hhr-font-display);
}
.profile-stats span,
.profile-stats small {
  display: block;
  font-size: 11px;
  color: var(--hhr-color-muted);
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
}
.profile-shortcut:hover {
  border-color: var(--hhr-color-brand);
}
.profile-lower {
  display: grid;
  grid-template-columns: 1.45fr 1fr;
  gap: 24px;
}
.profile-lower--single {
  grid-template-columns: 1fr;
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
  .profile-identity h2 {
    font-size: 23px;
  }
  .profile-identity p {
    font-size: 13px;
  }
  .profile-stats {
    margin-top: 18px;
  }
  .profile-stats strong {
    font-size: 26px;
  }
  .profile-lower {
    gap: 18px;
  }
  .profile-heading {
    margin-bottom: 20px;
  }
  .profile-heading h1 {
    font-size: 27px;
  }
  .profile-heading > p {
    font-size: 12px;
  }
  .profile-edit-button {
    padding: 8px 10px;
    min-height: 44px;
    font-size: 13px;
  }
  .profile-sections {
    gap: 2px;
  }
  .profile-sections a {
    padding-inline: 10px;
  }
}
@media (max-width: 359px) {
  .profile-shortcuts {
    grid-template-columns: 1fr;
  }
  .profile-identity {
    align-items: flex-start;
    flex-direction: column;
  }
  .profile-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    row-gap: 12px;
  }
  .profile-stats > div:nth-child(3) {
    border-left: 0;
  }
}
</style>
