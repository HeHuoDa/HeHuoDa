<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useTeamClock } from "../data/team-clock";
import {
  DEMO_PARTICIPANT,
  applicationLabels,
  cooperationModes,
  draftFromTeam,
  projectTypes,
  recruitmentStatus,
  roleOptions,
  teamTime,
  useTeamDemoStore,
  type TeamDraft,
} from "../data/team-demo";
import { useProfileDemoStore } from "../data/profile-demo";
import ProfileTeamDialog from "./ProfileTeamDialog.vue";
const props = defineProps<{ section: "profile" | "teams" | "applications" }>();
const store = useTeamDemoStore(),
  profile = useProfileDemoStore(),
  now = useTeamClock();
const mine = computed(() =>
  store.teams.filter(
    (t) => !t.dissolved && t.members.some((m) => m.id === DEMO_PARTICIPANT.id),
  ),
);
const ownApplications = computed(() =>
  store.records.filter((a) => a.applicantId === DEMO_PARTICIPANT.id),
);
const selected = ref<string>();
const team = computed(() => mine.value.find((t) => t.id === selected.value));
const captain = computed(() =>
  team.value?.members.some((m) => m.id === DEMO_PARTICIPANT.id && m.captain),
);
const incoming = computed(() =>
  store.records.filter((a) => a.teamId === team.value?.id),
);
const feedback = ref("");
const editor = ref<TeamDraft>();
const errors = ref<Record<string, string>>({});
const form = ref<HTMLFormElement>();
const confirmation = ref<{ title: string; run: () => string }>();
const successor = ref("");
watch(
  () => props.section,
  () => {
    selected.value = undefined;
    editor.value = undefined;
    confirmation.value = undefined;
    feedback.value = "";
  },
);
watch(team, (t) => {
  if (!t) {
    editor.value = undefined;
    confirmation.value = undefined;
  }
});
function confirm(title: string, run: () => string) {
  confirmation.value = { title, run };
}
function execute() {
  const action = confirmation.value;
  confirmation.value = undefined;
  if (action) feedback.value = action.run();
}
function beginEdit() {
  if (team.value) {
    editor.value = draftFromTeam(team.value);
    errors.value = {};
  }
}
async function save() {
  if (!team.value || !editor.value) return;
  const result = store.editTeam(team.value.id, editor.value);
  feedback.value = result.message;
  errors.value = result.errors;
  if (result.ok) editor.value = undefined;
  else {
    await nextTick();
    form.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }
}
function manage(action: Parameters<typeof store.manage>[1], memberId?: string) {
  const id = team.value?.id;
  if (id)
    confirm(
      "确认" +
        {
          open: "恢复招募",
          paused: "暂停招募",
          closed: "关闭招募",
          transfer: "移交队长",
          dissolve: "解散队伍",
          leave: "退出队伍",
          remove: "移除成员",
        }[action] +
        "？",
      () => store.manage(id, action, memberId),
    );
}
function preview(value: string) {
  store.reset();
  selected.value = undefined;
  if (value === "no-teams")
    store.teams.forEach((t) => {
      t.members = t.members.filter((m) => m.id !== DEMO_PARTICIPANT.id);
    });
  if (value === "no-applications") store.records = [];
  if (["full", "expired", "paused", "invalid"].includes(value)) {
    const t = store.teams.find((t) => t.id === "demo-2")!;
    if (value === "full") t.capacity = t.members.length;
    if (value === "expired")
      t.deadline = new Date(Date.now() - 1000).toISOString();
    if (value === "paused") t.state = "paused";
    if (value === "invalid")
      store.invitations.find((i) => i.applicationId === "history-0")!.state =
        "INVALID";
  }
  feedback.value = "已加载边界示例；原会话修改已重置。";
}
</script>
<template>
  <section class="management-panel" aria-label="会话内队伍与申请演示">
    <h2 class="font-serif text-xl">
      {{
        section === "applications"
          ? "申请与邀请"
          : section === "teams"
            ? "我的队伍"
            : "正在一起做的事"
      }}
    </h2>
    <p
      v-if="feedback"
      role="status"
      class="my-4 rounded-control bg-brand-soft p-3 text-sm text-brand"
    >
      {{ feedback }}
    </p>
    <template v-if="section !== 'applications'">
      <p v-if="!mine.length" class="my-5 text-sm text-muted">
        暂无队伍。可以前往找队友申请，或发布招募。
      </p>
      <article
        v-for="t in mine"
        :key="t.id"
        class="management-row"
        :data-my-team="t.id"
      >
        <div class="min-w-0 flex-1">
          <h3 class="font-semibold">{{ t.title }}</h3>
          <p class="mt-2 text-xs text-muted">
            {{
              t.members.find((m) => m.id === DEMO_PARTICIPANT.id)?.captain
                ? "队长"
                : "普通成员"
            }}
            · {{ t.members.length }}/{{ t.capacity }} 人 ·
            {{ recruitmentStatus(t, now).label }}
          </p>
        </div>
        <button
          v-if="section === 'teams'"
          type="button"
          class="hhr-button hhr-button--secondary"
          @click="
            selected = t.id;
            successor = '';
            feedback = '';
          "
        >
          查看与管理
        </button>
        <RouterLink
          v-else
          to="/profile?section=teams"
          class="text-sm text-brand"
          >管理队伍</RouterLink
        >
      </article>
      <RouterLink
        to="/teams"
        class="inline-flex min-h-11 items-center text-sm text-brand"
        >前往找队友 →</RouterLink
      >
    </template>
    <template v-else>
      <p v-if="!ownApplications.length" class="my-5 text-sm text-muted">
        暂无申请与邀请。前往找队友了解项目后可演示申请。
      </p>
      <article
        v-for="a in ownApplications"
        :key="a.id"
        class="management-record"
        :data-application="a.id"
      >
        <h3 class="font-semibold">
          {{
            store.teams.find((t) => t.id === a.teamId)?.title ?? "队伍已不存在"
          }}
        </h3>
        <p class="my-2 text-sm">
          {{ applicationLabels[a.state] }} · {{ a.role }}
        </p>
        <p class="whitespace-pre-wrap text-xs text-muted">{{ a.note }}</p>
        <p v-if="a.state === 'INVITED'" class="my-2 text-xs text-muted">
          {{
            store.invitationProblem(a, now) ||
            "收到有效演示邀请；确认时重新检查名额与招募条件。"
          }}
        </p>
        <div class="management-actions mt-3">
          <button
            v-if="['PENDING', 'INVITED'].includes(a.state)"
            type="button"
            class="hhr-button hhr-button--secondary"
            @click="
              confirm('确认撤回申请？', () => store.respond(a.id, 'withdraw'))
            "
          >
            撤回申请
          </button>
          <template v-if="a.state === 'INVITED'"
            ><button
              type="button"
              class="hhr-button"
              @click="
                confirm('确认入队？邀请不预占名额。', () =>
                  store.respond(a.id, 'accept'),
                )
              "
            >
              确认入队</button
            ><button
              type="button"
              class="hhr-button hhr-button--secondary"
              @click="
                confirm('确认拒绝邀请？', () => store.respond(a.id, 'decline'))
              "
            >
              拒绝邀请
            </button></template
          >
          <RouterLink
            :to="'/teams/' + a.teamId"
            class="inline-flex min-h-11 items-center text-sm text-brand"
            >查看公开招募</RouterLink
          >
        </div>
      </article>
    </template>
    <section
      v-if="team && section === 'teams'"
      class="management-detail"
      aria-label="队伍管理详情"
    >
      <h3 class="font-serif text-xl">
        {{ team.title }} · {{ captain ? "队长管理" : "成员详情" }}
      </h3>
      <p class="my-3 text-sm">
        {{ recruitmentStatus(team, now).label }} · 截止
        {{ teamTime(team.deadline) }}
      </p>
      <RouterLink :to="'/teams/' + team.id" class="text-sm text-brand"
        >查看公开招募 →</RouterLink
      >
      <div class="management-actions my-4">
        <template v-if="captain"
          ><button type="button" class="hhr-button" @click="beginEdit">
            编辑招募</button
          ><button
            type="button"
            class="hhr-button hhr-button--secondary"
            @click="manage(team.state === 'paused' ? 'open' : 'paused')"
          >
            {{ team.state === "paused" ? "恢复招募" : "暂停招募" }}</button
          ><button
            type="button"
            class="hhr-button hhr-button--secondary"
            @click="manage('closed')"
          >
            关闭招募</button
          ><button
            type="button"
            class="hhr-button hhr-button--secondary"
            @click="manage('dissolve')"
          >
            解散队伍
          </button></template
        >
        <button
          v-else
          type="button"
          class="hhr-button hhr-button--secondary"
          @click="manage('leave')"
        >
          退出队伍
        </button>
      </div>
      <p v-if="captain" class="text-xs text-muted">
        队长不能直接退出，须先移交或解散。
      </p>
      <h4 class="my-4 font-semibold">有效成员与联系方式示例</h4>
      <div
        v-for="m in team.members"
        :key="m.id"
        class="management-record"
        :data-member="m.id"
      >
        <p>{{ m.nickname }} · {{ m.captain ? "队长" : m.role }}</p>
        <label class="my-3 flex items-center gap-2 text-sm"
          ><input
            v-if="m.id === DEMO_PARTICIPANT.id"
            v-model="profile.contactShared"
            type="checkbox"
          /><input
            v-else
            v-model="store.contactAuthorizations[m.id]"
            type="checkbox"
          />{{
            m.id === DEMO_PARTICIPANT.id
              ? "我的联系方式授权（复用资料设置）"
              : "预览此成员已授权（示例）"
          }}</label
        >
        <p class="text-xs text-muted">
          {{
            store.canViewContact(team.id, m.id)
              ? "联系方式示例：已授权可见（无真实值）"
              : "联系方式隐藏：须同队有效成员且所有者授权"
          }}
        </p>
        <button
          v-if="captain && !m.captain"
          type="button"
          class="hhr-button hhr-button--secondary mt-3"
          @click="manage('remove', m.id)"
        >
          移除成员
        </button>
      </div>
      <div v-if="captain" class="my-4">
        <label for="successor" class="auth-label">移交给其他有效成员</label
        ><select id="successor" v-model="successor" class="hhr-input">
          <option value="">请选择</option>
          <option
            v-for="m in team.members.filter((m) => !m.captain)"
            :key="m.id"
            :value="m.id"
          >
            {{ m.nickname }}
          </option></select
        ><button
          type="button"
          class="hhr-button hhr-button--secondary mt-3"
          :disabled="!successor"
          @click="manage('transfer', successor)"
        >
          移交队长
        </button>
      </div>
      <template v-if="captain"
        ><h4 class="my-4 font-semibold">申请与发出的邀请</h4>
        <p v-if="!incoming.length" class="text-sm text-muted">暂无申请。</p>
        <article
          v-for="a in incoming"
          :key="a.id"
          class="management-record"
          :data-incoming="a.id"
        >
          <p>
            {{ a.nickname }} · {{ a.role }} · {{ applicationLabels[a.state] }}
          </p>
          <p class="my-2 whitespace-pre-wrap text-xs text-muted">
            {{ a.note }}
          </p>
          <div class="management-actions">
            <template v-if="a.state === 'PENDING'"
              ><button
                type="button"
                class="hhr-button"
                @click="
                  confirm('确认邀请申请者？不预占名额。', () =>
                    store.processApplication(a.id, 'invite'),
                  )
                "
              >
                邀请</button
              ><button
                type="button"
                class="hhr-button hhr-button--secondary"
                @click="
                  confirm('确认拒绝申请？', () =>
                    store.processApplication(a.id, 'reject'),
                  )
                "
              >
                拒绝申请
              </button></template
            ><button
              v-if="a.state === 'INVITED'"
              type="button"
              class="hhr-button hhr-button--secondary"
              @click="
                confirm('确认撤销邀请？', () =>
                  store.processApplication(a.id, 'revoke'),
                )
              "
            >
              撤销邀请
            </button>
          </div>
        </article></template
      >
      <button
        type="button"
        class="hhr-button hhr-button--secondary mt-4"
        @click="selected = undefined"
      >
        收起管理
      </button>
    </section>
    <footer class="mt-5 border-t border-line pt-4 text-xs text-muted">
      <p>
        仅在当前页面会话内演示，刷新或重置恢复示例。申请与邀请不增加成员，邀请不预占名额；未真实送达或保存，无服务器事务及并发保障。
      </p>
      <div v-if="section !== 'profile'" class="management-actions mt-4">
        <label for="management-preview" class="sr-only"
          >预览边界状态（会重置会话修改）</label
        ><select
          id="management-preview"
          class="hhr-input"
          @change="preview(($event.target as HTMLSelectElement).value)"
        >
          <option value="">初始示例 / 重置预览</option>
          <option value="full">邀请确认：已满员</option>
          <option value="expired">邀请确认：已截止</option>
          <option value="paused">邀请确认：已暂停</option>
          <option value="invalid">邀请已失效</option>
          <option value="no-teams">无队伍</option>
          <option value="no-applications">无申请与邀请</option>
        </select>
      </div>
      <button
        type="button"
        class="mt-3 min-h-11 text-brand underline"
        @click="
          store.reset();
          selected = undefined;
          feedback = '队伍、申请、资料与授权已重置。';
        "
      >
        重置全部组队示例
      </button>
    </footer>
  </section>
  <ProfileTeamDialog
    v-if="confirmation"
    :title="confirmation.title"
    @close="confirmation = undefined"
    ><p class="mb-4 text-sm">
      本次操作只更新会话内示例。关闭或解散将使待处理申请与邀请失效；退出或移除后联系方式立即隐藏。
    </p>
    <button type="button" class="hhr-button" @click="execute">
      确认操作
    </button></ProfileTeamDialog
  >
  <ProfileTeamDialog
    v-if="editor"
    title="编辑演示招募"
    @close="editor = undefined"
  >
    <form ref="form" novalidate @submit.prevent="save">
      <div
        v-for="field in [
          { key: 'title', label: '招募标题', max: 60 },
          { key: 'goal', label: '目标介绍', max: 2000 },
          { key: 'progress', label: '当前进度', max: 500 },
          { key: 'skills', label: '技能与职责', max: 500 },
          { key: 'location', label: '合作地点', max: 200 },
        ] as const"
        :key="field.key"
        class="my-3"
      >
        <label :for="'edit-' + field.key" class="auth-label">{{
          field.label
        }}</label
        ><textarea
          :id="'edit-' + field.key"
          v-model="editor[field.key]"
          class="hhr-input"
          :maxlength="field.max"
          :rows="field.key === 'goal' ? 4 : 2"
          :aria-invalid="!!errors[field.key]"
          :aria-describedby="'error-' + field.key"
        />
        <p :id="'error-' + field.key" class="text-xs text-danger">
          {{ errors[field.key] }}
        </p>
      </div>
      <label for="edit-type" class="auth-label">项目类型</label
      ><select id="edit-type" v-model="editor.type" class="hhr-input">
        <option v-for="(label, key) in projectTypes" :key="key" :value="key">
          {{ label }}
        </option>
      </select>
      <label for="edit-mode" class="auth-label mt-3">合作方式</label
      ><select id="edit-mode" v-model="editor.mode" class="hhr-input">
        <option
          v-for="(label, key) in cooperationModes"
          :key="key"
          :value="key"
        >
          {{ label }}
        </option>
      </select>
      <fieldset class="my-4">
        <legend class="auth-label">角色需求</legend>
        <label
          v-for="r in roleOptions"
          :key="r"
          class="mr-4 inline-flex min-h-11 items-center gap-2"
          ><input v-model="editor.roles" type="checkbox" :value="r" />{{
            r
          }}</label
        >
        <p role="alert" class="text-xs text-danger">{{ errors.roles }}</p>
      </fieldset>
      <label for="edit-capacity" class="auth-label">容量（含队长）</label
      ><input
        id="edit-capacity"
        v-model="editor.capacity"
        class="hhr-input"
        inputmode="numeric"
        :aria-invalid="!!errors.capacity"
        aria-describedby="error-capacity"
      />
      <p id="error-capacity" class="text-xs text-danger">
        {{ errors.capacity }}
      </p>
      <label for="edit-deadline" class="auth-label mt-3"
        >招募截止（北京时间）</label
      ><input
        id="edit-deadline"
        v-model="editor.deadline"
        class="hhr-input"
        type="datetime-local"
        :aria-invalid="!!errors.deadline"
        aria-describedby="error-deadline"
      />
      <p id="error-deadline" class="text-xs text-danger">
        {{ errors.deadline }}
      </p>
      <p class="my-4 text-xs text-muted">
        关联比赛与赛道沿用原招募；普通项目无需关联比赛。
      </p>
      <p
        v-if="Object.keys(errors).length"
        role="alert"
        class="my-3 text-sm text-danger"
      >
        请修正字段错误后重试。
      </p>
      <button type="submit" class="hhr-button">保存演示招募</button>
    </form>
  </ProfileTeamDialog>
</template>
<style scoped>
.management-panel {
  min-width: 0;
  padding: 26px;
  border: 1px solid var(--hhr-color-line);
  border-radius: var(--hhr-radius-panel);
  background: var(--hhr-color-surface);
  overflow-wrap: anywhere;
}
.management-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
  padding: 20px 0;
  border-bottom: 1px solid var(--hhr-color-line);
}
.management-row > div {
  flex-basis: 200px;
}
.management-record {
  padding: 16px 0;
  border-bottom: 1px solid var(--hhr-color-line);
}
.management-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.management-detail {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--hhr-color-line);
}
@media (max-width: 600px) {
  .management-panel {
    padding: 20px;
  }
}
</style>
