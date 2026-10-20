<script setup lang="ts">
import { nextTick, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import TeamDemoReset from "../components/TeamDemoReset.vue";
import TeamCompetitionPicker from "../components/TeamCompetitionPicker.vue";
import {
  useTeamDemoStore,
  emptyDraft,
  validateDraft,
  projectTypes,
  cooperationModes,
  roleOptions,
} from "../data/team-demo";
const router = useRouter(),
  route = useRoute(),
  store = useTeamDemoStore();
const draft = reactive(emptyDraft()),
  errors = ref<Record<string, string>>({}),
  submitting = ref(false),
  competitionBusy = ref(false);
const form = ref<HTMLFormElement>();
async function submit() {
  if (submitting.value || competitionBusy.value) return;
  errors.value = validateDraft(draft, Date.now());
  if (Object.keys(errors.value).length) {
    await nextTick();
    const first = form.value?.querySelector<HTMLElement>(
      '[aria-invalid="true"]',
    );
    first?.focus();
    first?.scrollIntoView?.({ block: "center" });
    return;
  }
  submitting.value = true;
  try {
    const team = store.publish(draft);
    if (team)
      await router.push({
        name: "team-detail",
        params: { id: team.id },
        query: route.query,
      });
    else errors.value = validateDraft(draft, Date.now());
  } finally {
    submitting.value = false;
  }
}
const fields = [
  { key: "type", label: "项目类型", section: "intro" },
  {
    key: "title",
    label: "招募标题",
    section: "intro",
    max: 60,
    placeholder: "例如：一起做校园植物图鉴",
  },
  {
    key: "goal",
    label: "目标介绍（10–2000 字）",
    section: "intro",
    max: 2000,
    rows: 6,
  },
  {
    key: "progress",
    label: "当前进度（选填）",
    section: "intro",
    max: 500,
    rows: 3,
  },
  {
    key: "skills",
    label: "技能与具体职责（选填）",
    section: "needs",
    max: 500,
    rows: 3,
  },
  { key: "mode", label: "合作方式", section: "needs" },
  {
    key: "location",
    label: "线下地点说明（线上可留空）",
    section: "needs",
    max: 200,
  },
  {
    key: "capacity",
    label: "队伍容量（含队长，2–20 人）",
    section: "settings",
    input: "number",
  },
  {
    key: "deadline",
    label: "招募截止（北京时间）",
    section: "settings",
    input: "datetime-local",
  },
] as const;
const sections = [
  {
    key: "intro",
    title: "01 项目介绍",
    description: "讲清你们准备做什么，以及目前走到了哪一步。",
  },
  {
    key: "needs",
    title: "02 合作需求",
    description: "让伙伴了解角色缺口、技能需求和合作方式。",
  },
  {
    key: "settings",
    title: "03 招募设置",
    description: "确定队伍人数和招募时间，也可以关联比赛。",
  },
];
</script>
<template>
  <RouterLink
    :to="{ name: 'teams', query: route.query }"
    class="mb-5 inline-flex min-h-11 items-center text-sm text-brand"
    >← 返回找队友列表</RouterLink
  >
  <header class="mb-6">
    <p class="hhr-eyebrow mb-2">START SOMETHING</p>
    <h1 class="font-serif text-3xl font-semibold">发布招募</h1>
    <p class="mt-3 text-sm text-muted">把想法写下来，邀请伙伴一起完成。</p>
  </header>

  <form ref="form" novalidate class="grid gap-5" @submit.prevent="submit">
    <section v-for="section in sections" :key="section.key" class="hhr-panel">
      <h2 class="font-serif text-xl font-semibold">{{ section.title }}</h2>
      <p class="mt-2 mb-5 text-sm text-muted">{{ section.description }}</p>
      <template v-if="section.key === 'needs'">
        <fieldset class="mb-5">
          <legend class="mb-2 text-sm">角色需求（至少一项）</legend>
          <div class="flex flex-wrap gap-3">
            <label
              v-for="role in roleOptions"
              :key="role"
              class="flex min-h-11 items-center gap-2 rounded-control border border-line px-3 text-sm"
              ><input
                :id="role === roleOptions[0] ? 'roles' : undefined"
                v-model="draft.roles"
                type="checkbox"
                :value="role"
                :aria-invalid="!!errors.roles"
                aria-describedby="roles-error"
              />{{ role }}</label
            >
          </div>
          <p
            v-if="errors.roles"
            id="roles-error"
            class="mt-2 text-sm text-danger"
          >
            {{ errors.roles }}
          </p>
        </fieldset>
      </template>
      <div
        v-for="field in fields.filter((f) => f.section === section.key)"
        :key="field.key"
        class="mb-5"
      >
        <label :for="field.key" class="mb-2 block text-sm">{{
          field.label
        }}</label>
        <select
          v-if="field.key === 'type'"
          :id="field.key"
          v-model="draft.type"
          class="hhr-input"
          :aria-invalid="!!errors[field.key]"
          :aria-describedby="field.key + '-error'"
        >
          <option value="">请选择项目类型</option>
          <option v-for="(name, key) in projectTypes" :key="key" :value="key">
            {{ name }}
          </option>
        </select>
        <select
          v-else-if="field.key === 'mode'"
          :id="field.key"
          v-model="draft.mode"
          class="hhr-input"
          :aria-invalid="!!errors[field.key]"
          :aria-describedby="field.key + '-error'"
        >
          <option value="">请选择合作方式</option>
          <option
            v-for="(name, key) in cooperationModes"
            :key="key"
            :value="key"
          >
            {{ name }}
          </option>
        </select>
        <textarea
          v-else-if="'rows' in field"
          :id="field.key"
          v-model="draft[field.key]"
          :rows="field.rows"
          :maxlength="field.max"
          class="hhr-input"
          :aria-invalid="!!errors[field.key]"
          :aria-describedby="field.key + '-error'"
        />
        <input
          v-else
          :id="field.key"
          v-model="draft[field.key]"
          :type="'input' in field ? field.input : 'text'"
          :maxlength="'max' in field ? field.max : undefined"
          :placeholder="'placeholder' in field ? field.placeholder : undefined"
          class="hhr-input"
          :aria-invalid="!!errors[field.key]"
          :aria-describedby="field.key + '-error'"
        />
        <p
          v-if="errors[field.key]"
          :id="field.key + '-error'"
          class="mt-2 text-sm text-danger"
        >
          {{ errors[field.key] }}
        </p>
      </div>
      <template v-if="section.key === 'settings'">
        <TeamCompetitionPicker
          :competition="draft.competition"
          :track-id="draft.trackId"
          @select="
            draft.competition = $event;
            draft.trackId = '';
          "
          @track="draft.trackId = $event"
          @busy="competitionBusy = $event"
        />
        <p v-if="errors.trackId" role="alert" class="mt-2 text-sm text-danger">
          {{ errors.trackId }}
        </p>
        <p
          v-if="errors.competition"
          role="alert"
          class="mt-2 text-sm text-danger"
        >
          {{ errors.competition }}
        </p>
      </template>
    </section>
    <div
      class="flex flex-wrap items-center justify-between gap-4 rounded-panel bg-brand-soft p-5"
    >
      <p class="text-sm leading-7">
        演示发布仅在当前页面会话内创建队伍。<br />你将作为演示队长计为首名成员。
      </p>
      <button
        type="submit"
        class="hhr-button"
        :disabled="submitting || competitionBusy"
        :aria-busy="submitting"
      >
        {{ submitting ? "正在演示发布…" : "演示发布招募" }}
      </button>
    </div>
    <p
      v-if="Object.keys(errors).length"
      role="alert"
      class="text-sm text-danger"
    >
      请检查表单标注的错误，已保留填写内容。
    </p>
  </form>
  <TeamDemoReset />
</template>
