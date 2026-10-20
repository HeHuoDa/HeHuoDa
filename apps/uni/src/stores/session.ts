import { defineStore } from "pinia";
import { computed, reactive, ref, toRefs } from "vue";
import { DEMO_PARTICIPANT } from "@hehuoda/client-domain/team";
import {
  initialProfileState,
  createProfileActions,
} from "@hehuoda/client-domain/profile";
import {
  initialTeamState,
  createTeamActions,
  pendingApplications,
} from "@hehuoda/client-domain/team-session";

export interface FavoriteRecord {
  id: string;
  order: number;
}

/** One in-memory business session per app Pinia. No storage, network or router. */
export const useSessionStore = defineStore("business-session", () => {
  // 仅保留稳定 ID 与本次收藏顺序；详情、失败状态不参与收藏计数。
  const favorites = ref<FavoriteRecord[]>([]);
  let favoriteOrder = 0;
  const isFavorite = (id: string) =>
    favorites.value.some((item) => item.id === id);
  function addFavorite(id: string) {
    if (!id.trim() || isFavorite(id)) return;
    favorites.value.unshift({ id, order: ++favoriteOrder });
  }
  function removeFavorite(id: string) {
    favorites.value = favorites.value.filter((item) => item.id !== id);
  }
  const profileState = reactive(initialProfileState());
  const teamState = reactive(initialTeamState());
  const profileActions = createProfileActions(profileState);
  const teamActions = createTeamActions(teamState, {
    get contactShared() {
      return profileState.contactShared;
    },
    reset: profileActions.reset,
  });
  // 页面控制器及后续通知可加入统一重置，无需反向导入。
  const resetHandlers = new Map<string, () => void>();
  function registerReset(key: string, handler: () => void) {
    resetHandlers.set(key, handler);
    return () => {
      if (resetHandlers.get(key) === handler) resetHandlers.delete(key);
    };
  }
  function reset() {
    favorites.value = [];
    teamActions.reset();
    for (const handler of resetHandlers.values()) handler();
  }
  function memberNickname(id: string, fallback: string) {
    return id === DEMO_PARTICIPANT.id
      ? profileState.profile.nickname
      : fallback;
  }
  return {
    favorites,
    favoriteCount: computed(() => favorites.value.length),
    isFavorite,
    addFavorite,
    removeFavorite,
    ...toRefs(profileState),
    ...toRefs(teamState),
    applications: computed(() => pendingApplications(teamState)),
    saveProfile: profileActions.save,
    memberNickname,
    resetProfile: profileActions.reset,
    ...teamActions,
    reset,
    registerReset,
  };
});
