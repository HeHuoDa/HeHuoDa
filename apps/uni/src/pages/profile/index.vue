<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import ProfileOverview from "../../components/ProfileOverview.vue";
import FormButton from "../../components/FormButton.vue";
import { openPage } from "../../navigation/navigate";
import {
  parseProfileSection,
  type ProfileSection,
} from "../../navigation/params";
import { pageRouteQuery } from "../../navigation/h5-address";
import { useNavigationStore } from "../../stores/navigation";

/**
 * 个人中心。
 *
 * M1 保留资料示例、收藏入口与关于页入口；队伍、申请与邀请分区随
 * 站内组队一并暂缓（ADR 0011 方案 B）。旧地址 /my/teams、/my/applications
 * 与旧通知交接仍可进入本页，只看暂缓说明，不再渲染演示队伍与申请记录。
 */
const navigation = useNavigationStore();
const legacySection = ref<ProfileSection>("profile");

const pending = computed(() =>
  legacySection.value === "teams"
    ? "我的队伍"
    : legacySection.value === "applications"
      ? "申请与邀请"
      : "",
);

function applySection(section: ProfileSection) {
  legacySection.value = section;
}

function openFavorites() {
  openPage("favorites");
}
onLoad((platformQuery) => {
  const query = pageRouteQuery(platformQuery ?? {});
  applySection(parseProfileSection(query?.section).section);
  const handed = navigation.consumeProfileNavigation();
  if (handed) applySection(handed.section);
});
onScopeDispose(() => {
  legacySection.value = "profile";
});
// 已挂载页面收到新交接时直接落到对应说明，不重复 switchTab。
watch(
  () => navigation.pendingProfileNavigation,
  (handed) => {
    if (!handed) return;
    const next = navigation.consumeProfileNavigation();
    if (next) applySection(next.section);
  },
);
</script>

<template>
  <view class="hhr-page hhr-page--tab">
    <view class="hhr-page__inner">
      <view v-if="pending" class="hhr-notice mb-4" role="status">
        <text class="block"
          >「{{
            pending
          }}」随站内组队一并暂缓开放，当前只开放正式比赛信息浏览。</text
        >
      </view>
      <ProfileOverview />
      <view v-if="pending" class="mt-4">
        <FormButton variant="secondary" @click="openFavorites"
          >查看我的收藏</FormButton
        >
      </view>
    </view>
  </view>
</template>
