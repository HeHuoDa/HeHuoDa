<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import PlaceholderPage from "../../components/PlaceholderPage.vue";
import ProfileTeamsReadOnly from "../../components/ProfileTeamsReadOnly.vue";
import ProfileOverview from "../../components/ProfileOverview.vue";
import FormButton from "../../components/FormButton.vue";
import { useSessionStore } from "../../stores/session";
import { DEMO_PARTICIPANT } from "@hehuoda/client-domain/team";
import { openPage, openProfileSection } from "../../navigation/navigate";
import {
  copyRouteQuery,
  parseProfileSection,
  type ProfileSection,
  type RouteQuery,
} from "../../navigation/params";
import { useNavigationStore } from "../../stores/navigation";

const navigation = useNavigationStore();
const session = useSessionStore();
const teamCount = computed(
  () =>
    session.teams.filter(
      (t) =>
        !t.dissolved && t.members.some((m) => m.id === DEMO_PARTICIPANT.id),
    ).length,
);
const section = ref<ProfileSection>("profile");
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
      description: "在这里查看自己加入与带领的队伍。",
    },
    applications: {
      title: "申请与邀请",
      description: "在这里查看入队申请与邀请，跟进组队进展。",
    },
  };

const current = computed(() => content[section.value]);

onLoad((query) => {
  const parsed = parseProfileSection(query?.section);
  section.value = parsed.section;
  routeQuery.value = copyRouteQuery(query ?? {});
  delete routeQuery.value.section;
  notice.value = !parsed.issue
    ? ""
    : parsed.issue === "conflict"
      ? "分区参数重复且取值不一致，已显示个人资料。"
      : "分区参数无效，已显示个人资料。";
  consumePendingSection();
});

function consumePendingSection() {
  const pending = navigation.consumeProfileNavigation();
  if (!pending) return;
  section.value = pending.section;
  routeQuery.value = pending.query;
  notice.value = "";
}

// 首次加载先解析深链，再消费交接；已挂载页面在显示或收到新意图时消费。
onShow(consumePendingSection);
watch(() => navigation.pendingProfileNavigation, consumePendingSection);

function showProfile() {
  section.value = "profile";
  notice.value = "";
}
</script>

<template>
  <view class="hhr-page hhr-page--tab">
    <view class="hhr-page__inner">
      <view v-if="notice" class="hhr-notice mb-4">{{ notice }}</view>
      <template v-if="section === 'teams'">
        <ProfileTeamsReadOnly />
        <FormButton class="mt-4" variant="secondary" @click="showProfile"
          >返回个人资料</FormButton
        >
      </template>
      <ProfileOverview v-else-if="section === 'profile'" />
      <PlaceholderPage
        v-else
        :title="current.title"
        :description="current.description"
      >
        <button
          class="hhr-button hhr-button--soft hhr-button--inline"
          @click="openPage('favorites')"
        >
          我的收藏
        </button>
        <button
          class="hhr-button hhr-button--soft hhr-button--inline"
          @click="openPage('notifications')"
        >
          站内通知
        </button>
        <button
          class="hhr-button hhr-button--secondary hhr-button--inline"
          @click="openProfileSection('teams')"
        >
          我的队伍（{{ teamCount }}）
        </button>
        <button
          class="hhr-button hhr-button--secondary hhr-button--inline"
          @click="openProfileSection('applications')"
        >
          申请与邀请
        </button>
        <button
          class="hhr-button hhr-button--secondary hhr-button--inline"
          @click="openPage('login')"
        >
          登录
        </button>
        <button
          class="hhr-button hhr-button--secondary hhr-button--inline"
          @click="openPage('register')"
        >
          注册
        </button>
        <button class="hhr-button hhr-button--inline" @click="showProfile">
          返回个人资料
        </button>
      </PlaceholderPage>
    </view>
  </view>
</template>
