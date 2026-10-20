<script setup lang="ts">
import { computed, onScopeDispose, reactive, ref, watch } from "vue";
import { onHide, onLoad, onShow, onUnload } from "@dcloudio/uni-app";
import ProfileApplications from "../../components/ProfileApplications.vue";
import ProfileTeams from "../../components/ProfileTeams.vue";
import ProfileOverview from "../../components/ProfileOverview.vue";
import FormButton from "../../components/FormButton.vue";
import { useSessionStore } from "../../stores/session";
import {
  copyRouteQuery,
  parseProfileSection,
  type ProfileSection,
  type RouteQuery,
} from "../../navigation/params";
import { useNavigationStore } from "../../stores/navigation";
import {
  createProfileTeamController,
  initialProfileTeamState,
} from "../../stores/profile-team-controller";

const navigation = useNavigationStore();
const session = useSessionStore();
const state = reactive(initialProfileTeamState());
const controller = createProfileTeamController(state, session);
// 分区只由控制器持有，页面不再维护第二份 section 状态。
const section = computed(() => state.section);
// 后续个人中心业务页从这里读取附加参数；不把它们当作身份或权限。
const routeQuery = ref<RouteQuery>({});
const notice = ref("");

const content: Record<ProfileSection, { title: string; description: string }> =
  {
    profile: {
      title: "个人中心",
      description: "查看示例资料、编辑个人介绍与技能，了解联系方式授权。",
    },
    teams: {
      title: "我的队伍",
      description: "管理你带领或加入的队伍：招募、成员、申请与邀请。",
    },
    applications: {
      title: "申请与邀请",
      description: "跟进自己的申请与收到的邀请，撤回、确认或拒绝。",
    },
  };

const current = computed(() => content[section.value]);
let timer: ReturnType<typeof globalThis.setInterval> | undefined;
let disposed = false;

function applySection(next: ProfileSection, query?: RouteQuery) {
  if (query) routeQuery.value = query;
  controller.switchSection(next);
}
function showProfile() {
  applySection("profile");
  notice.value = "";
}
function consumePendingSection() {
  const pending = navigation.consumeProfileNavigation();
  if (!pending) return;
  applySection(pending.section, pending.query);
  notice.value = "";
}
function startClock() {
  controller.syncClock();
  if (timer === undefined)
    timer = globalThis.setInterval(controller.syncClock, 1000);
}
function stopClock() {
  if (timer !== undefined) globalThis.clearInterval(timer);
  timer = undefined;
}
function leave() {
  stopClock();
  // 页面隐藏或卸载时丢弃弹层与旧操作上下文，回来后重新读取实时会话。
  controller.clearTransient();
}
const unregisterReset = session.registerReset("profile-team", () =>
  controller.reset(),
);
function dispose() {
  if (disposed) return;
  disposed = true;
  leave();
  unregisterReset();
}

onLoad((query) => {
  const parsed = parseProfileSection(query?.section);
  const next = copyRouteQuery(query ?? {});
  delete next.section;
  applySection(parsed.section, next);
  notice.value = !parsed.issue
    ? ""
    : parsed.issue === "conflict"
      ? "分区参数重复且取值不一致，已显示个人资料。"
      : "分区参数无效，已显示个人资料。";
  consumePendingSection();
});

// 首次加载先解析深链，再消费交接；已挂载页面在显示或收到新意图时消费。
onShow(() => {
  startClock();
  consumePendingSection();
});
watch(() => navigation.pendingProfileNavigation, consumePendingSection);
onHide(leave);
onUnload(dispose);
onScopeDispose(dispose);
</script>

<template>
  <view class="hhr-page hhr-page--tab">
    <view class="hhr-page__inner">
      <view v-if="notice" class="hhr-notice mb-4">{{ notice }}</view>
      <template v-if="section === 'teams'">
        <view class="section-heading">
          <text class="section-title">{{ current.title }}</text>
          <text class="section-copy">{{ current.description }}</text>
        </view>
        <ProfileTeams :controller="controller" />
        <FormButton
          class="mt-4 section-back"
          variant="secondary"
          @click="showProfile"
          >返回个人资料</FormButton
        >
      </template>
      <template v-else-if="section === 'applications'">
        <view class="section-heading">
          <text class="section-title">{{ current.title }}</text>
          <text class="section-copy">{{ current.description }}</text>
        </view>
        <ProfileApplications :controller="controller" />
        <FormButton
          class="mt-4 section-back"
          variant="secondary"
          @click="showProfile"
          >返回个人资料</FormButton
        >
      </template>
      <ProfileOverview v-else />
    </view>
  </view>
</template>

<style scoped>
.section-heading {
  display: grid;
  gap: 8px;
  margin-bottom: 20px;
}
.section-title {
  font-family: var(--hhr-font-display);
  font-size: 28px;
  line-height: 36px;
  font-weight: 600;
}
.section-copy {
  font-size: 13px;
  line-height: 24px;
  color: var(--hhr-color-muted);
  overflow-wrap: anywhere;
}
.section-back {
  width: auto;
  max-width: 100%;
}
</style>
