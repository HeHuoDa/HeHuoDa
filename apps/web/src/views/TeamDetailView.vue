<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import TeamDemoReset from "../components/TeamDemoReset.vue";
import TeamActionDialog from "../components/TeamActionDialog.vue";
import { useTeamClock } from "../data/team-clock";
import {
  useTeamDemoStore,
  projectTypes,
  cooperationModes,
  applicationStatus,
  recruitmentStatus,
  teamTime,
  type Role,
  DEMO_PARTICIPANT,
} from "../data/team-demo";
import { formatTime } from "../data/competition-discovery";
const route = useRoute(),
  store = useTeamDemoStore(),
  now = useTeamClock();
const team = computed(() => store.teams.find((t) => t.id === route.params.id));
const status = computed(() =>
  team.value
    ? applicationStatus(
        team.value,
        now.value,
        !!store.applications[team.value.id],
      )
    : undefined,
);
const invited = computed(() =>
  store.records.some(
    (a) =>
      a.teamId === team.value?.id &&
      a.applicantId === DEMO_PARTICIPANT.id &&
      a.state === "INVITED",
  ),
);
const track = computed(() =>
  team.value?.competition?.tracks.find((t) => t.id === team.value?.trackId),
);
const action = ref<"apply" | "report">(),
  feedback = ref("");
watch(
  () => [route.params.id, team.value],
  () => {
    action.value = undefined;
    feedback.value = "";
  },
);
function submit(role: string, note: string) {
  if (!team.value) return;
  if (action.value === "apply") {
    feedback.value = store.apply(team.value.id, role as Role, note, Date.now())
      ? "演示申请已创建，状态为待处理；成员人数不变，没有送达真实队长。"
      : "当前无法申请，请核对招募状态。";
    now.value = Date.now();
  } else feedback.value = "演示举报已结束：没有外发，没有实际进入审核。";
  action.value = undefined;
}
</script>
<template>
  <RouterLink
    :to="{ name: 'teams', query: route.query }"
    class="mb-5 inline-flex min-h-11 items-center text-sm text-brand"
    >← 返回找队友列表</RouterLink
  >

  <section v-if="!team" class="hhr-panel">
    <h1 class="font-serif text-2xl font-semibold">队伍不存在</h1>
    <p class="mt-3 text-sm text-muted">
      {{
        String(route.params.id).startsWith("session-")
          ? "会话内演示数据已重置，刷新或重置后新建队伍不再保留。"
          : "未找到这支队伍，请返回列表重新选择。"
      }}
    </p>
  </section>
  <template v-else>
    <p
      v-if="team.id.startsWith('session-')"
      role="status"
      class="mb-4 rounded-control bg-brand-soft p-3 text-sm text-brand"
    >
      演示招募已发布，仅在当前页面会话内保留。你是这支队伍的演示队长。
    </p>
    <header class="mb-6">
      <div class="mb-3 flex flex-wrap gap-2">
        <span class="hhr-badge">{{ projectTypes[team.type] }}</span
        ><span class="hhr-badge hhr-badge--warning"
          >{{ recruitmentStatus(team, now).label }} · 演示招募</span
        >
      </div>
      <h1 class="font-serif text-3xl font-semibold wrap-anywhere">
        {{ team.title }}
      </h1>
    </header>
    <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.65fr)]">
      <div class="grid min-w-0 gap-5">
        <section class="hhr-panel">
          <h2 class="font-serif text-xl font-semibold">项目目标</h2>
          <p class="mt-4 text-sm leading-8 whitespace-pre-wrap wrap-anywhere">
            {{ team.goal }}
          </p>
          <h3 class="mt-6 font-semibold">当前进度</h3>
          <p class="mt-3 text-sm leading-7 whitespace-pre-wrap wrap-anywhere">
            {{ team.progress || "当前进度待沟通" }}
          </p>
        </section>
        <section class="hhr-panel">
          <h2 class="font-serif text-xl font-semibold">合作需求</h2>
          <p class="mt-4 text-sm">所需角色：{{ team.roles.join("、") }}</p>
          <p class="mt-3 text-sm leading-7 whitespace-pre-wrap wrap-anywhere">
            技能与职责：{{ team.skills || "具体职责与技能共同沟通" }}
          </p>
          <p class="mt-3 text-sm">
            合作方式：{{ cooperationModes[team.mode] }}
          </p>
          <p v-if="team.mode !== 'online'" class="mt-3 text-sm wrap-anywhere">
            地点：{{ team.location }}
          </p>
        </section>
        <section v-if="team.competition" class="hhr-panel">
          <h2 class="font-serif text-xl font-semibold">关联比赛资料</h2>
          <RouterLink
            :to="
              '/home/competitions/' + encodeURIComponent(team.competition.id)
            "
            class="mt-3 block text-brand underline"
            >{{ team.competition.name }} ·
            {{ team.competition.edition }}</RouterLink
          >
          <p class="mt-3 text-sm">赛道：{{ track?.name || "未选赛道" }}</p>
          <p v-if="track" class="mt-2 text-sm leading-7">
            {{ track.members }} · {{ track.rules }}
          </p>
          <p
            v-for="stage in team.competition.stages"
            :key="stage.id"
            class="mt-2 text-xs text-muted"
          >
            {{ stage.name }}官方报名截止：{{
              stage.conflict ? "时间待核对" : formatTime(stage.deadline)
            }}
          </p>
          <p class="mt-3 text-xs text-muted">
            比赛资料来自公开接口，招募是会话内演示；官方报名截止与招募截止分别计算。
          </p>
        </section>
      </div>
      <div class="grid min-w-0 content-start gap-5">
        <section class="hhr-panel">
          <h2 class="font-serif text-xl font-semibold">队伍成员</h2>
          <p class="mt-3 text-sm">
            当前 {{ team.members.length }}/{{ team.capacity }} 人（含队长） ·
            剩余 {{ Math.max(0, team.capacity - team.members.length) }} 人
          </p>
          <ul class="mt-4 grid gap-3">
            <li
              v-for="member in team.members"
              :key="member.id"
              class="rounded-control bg-page p-3 text-sm wrap-anywhere"
            >
              {{ member.nickname
              }}<span class="mt-1 block text-xs text-muted"
                >{{ member.captain ? "队长" : "成员" }} ·
                {{ member.role }}</span
              >
            </li>
          </ul>
        </section>
        <section class="hhr-panel">
          <h2 class="font-serif text-xl font-semibold">招募与申请</h2>
          <p class="mt-3 text-sm">招募截止：{{ teamTime(team.deadline) }}</p>
          <p class="mt-3 text-sm font-semibold">
            {{ invited ? "演示已邀请，等待确认入队" : status?.label }}
          </p>
          <RouterLink
            v-if="invited"
            to="/profile?section=applications"
            class="mt-2 inline-flex min-h-11 items-center text-sm text-brand"
            >前往我的申请与邀请</RouterLink
          >
          <p class="mt-3 text-xs leading-6 text-muted">
            平台组队不等于官方比赛报名；关联比赛不代表参赛资格通过。公开页面不展示真实联系方式。
          </p>
          <div class="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              class="hhr-button"
              :disabled="!status?.available"
              @click="action = 'apply'"
            >
              {{
                status?.available
                  ? "演示申请"
                  : invited
                    ? "演示已邀请"
                    : status?.label
              }}</button
            ><button
              type="button"
              class="hhr-button hhr-button--secondary"
              @click="action = 'report'"
            >
              演示举报
            </button>
          </div>
          <p role="status" aria-live="polite" class="mt-3 text-sm text-brand">
            {{ feedback }}
          </p>
        </section>
      </div>
    </div>
    <TeamActionDialog
      v-if="action"
      :kind="action"
      :roles="team.roles"
      @close="action = undefined"
      @submit="submit"
    />
  </template>
  <TeamDemoReset />
</template>
