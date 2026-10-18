import { defineStore } from "pinia";
import { ref } from "vue";
import {
  copyRouteQuery,
  type ProfileSection,
  type RouteQuery,
} from "../navigation/params.ts";

interface ProfileNavigation {
  section: ProfileSection;
  query: RouteQuery;
}

/**
 * 导航交接状态。
 *
 * 平台主导航用 switchTab，不能携带 query；旧地址 /my/teams、/my/applications
 * 需要落到个人中心分区，因此先写入一次性意图，由个人中心 onShow 消费并清空。
 * 状态只活在当前应用会话内，不持久化，也不代表登录态或权限。
 */
export const useNavigationStore = defineStore("navigation", () => {
  const pendingProfileNavigation = ref<ProfileNavigation | null>(null);

  function requestProfileSection(
    section: ProfileSection,
    query: RouteQuery = {},
  ) {
    const additionalQuery = copyRouteQuery(query);
    delete additionalQuery.section;
    pendingProfileNavigation.value = { section, query: additionalQuery };
  }

  function consumeProfileNavigation(): ProfileNavigation | null {
    const pending = pendingProfileNavigation.value;
    pendingProfileNavigation.value = null;
    return pending;
  }

  return {
    pendingProfileNavigation,
    requestProfileSection,
    consumeProfileNavigation,
  };
});
