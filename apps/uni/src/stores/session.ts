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
import {
  captureNotificationBaseline,
  createNotificationActions,
  initialNotifications,
} from "./notification-session.ts";
import { useNavigationStore } from "./navigation.ts";

export interface FavoriteRecord {
  id: string;
  order: number;
}

/** One in-memory business session per app Pinia. No storage, network or router. */
export const useSessionStore = defineStore("business-session", () => {
  const navigation = useNavigationStore();
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
  const notificationState = reactive({ notifications: initialNotifications() });
  const notificationActions = createNotificationActions(
    notificationState,
    teamState,
    teamActions.invitationProblem,
  );
  const sessionRevision = ref(0);
  function observed<T>(action: () => T, now: number) {
    const before = captureNotificationBaseline(teamState);
    const result = action();
    notificationActions.recordChanges(before, now);
    return result;
  }
  const observedTeamActions = {
    ...teamActions,
    publish(
      draft: Parameters<typeof teamActions.publish>[0],
      now = Date.now(),
    ) {
      return observed(() => teamActions.publish(draft, now), now);
    },
    apply(
      id: string,
      role: Parameters<typeof teamActions.apply>[1],
      note: string,
      now = Date.now(),
    ) {
      return observed(() => teamActions.apply(id, role, note, now), now);
    },
    processApplication(
      id: string,
      action: Parameters<typeof teamActions.processApplication>[1],
      now = Date.now(),
    ) {
      return observed(
        () => teamActions.processApplication(id, action, now),
        now,
      );
    },
    respond(
      id: string,
      action: Parameters<typeof teamActions.respond>[1],
      now = Date.now(),
    ) {
      return observed(() => teamActions.respond(id, action, now), now);
    },
    editTeam(
      id: string,
      draft: Parameters<typeof teamActions.editTeam>[1],
      now = Date.now(),
    ) {
      return observed(() => teamActions.editTeam(id, draft, now), now);
    },
    manage(
      id: string,
      action: Parameters<typeof teamActions.manage>[1],
      memberId?: string,
    ) {
      return observed(
        () => teamActions.manage(id, action, memberId),
        Date.now(),
      );
    },
  };
  // 页面控制器及后续通知可加入统一重置，无需反向导入。
  const resetHandlers = new Map<string | symbol, () => void>();
  function registerReset(key: string | symbol, handler: () => void) {
    resetHandlers.set(key, handler);
    return () => {
      if (resetHandlers.get(key) === handler) resetHandlers.delete(key);
    };
  }
  function reset() {
    // 先隔离旧会话及页面操作，再恢复同 ID 的新示例。
    sessionRevision.value++;
    navigation.clearSessionNavigation();
    for (const handler of [...resetHandlers.values()]) handler();
    favorites.value = [];
    teamActions.reset();
    notificationActions.reset();
  }
  function memberNickname(id: string, fallback: string) {
    return id === DEMO_PARTICIPANT.id
      ? profileState.profile.nickname
      : fallback;
  }
  return {
    favorites,
    ...toRefs(notificationState),
    sessionRevision,
    unreadNotificationCount: computed(
      () =>
        notificationState.notifications.filter((n) => n.readAt === null).length,
    ),
    syncNotifications: notificationActions.sync,
    markNotificationRead: notificationActions.markRead,
    markAllNotificationsRead: notificationActions.markAllRead,
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
    ...observedTeamActions,
    reset,
    registerReset,
  };
});
