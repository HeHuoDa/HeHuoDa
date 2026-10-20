import { defineStore } from "pinia";
import { computed, reactive, toRefs } from "vue";
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

/** One in-memory business session per app Pinia. No storage, network or router. */
export const useSessionStore = defineStore("business-session", () => {
  const profileState = reactive(initialProfileState());
  const teamState = reactive(initialTeamState());
  const profileActions = createProfileActions(profileState);
  const teamActions = createTeamActions(teamState, {
    get contactShared() {
      return profileState.contactShared;
    },
    reset: profileActions.reset,
  });
  // Future favorites/notifications stores can join reset without a reverse import.
  const resetHandlers = new Map<string, () => void>();
  function registerReset(key: string, handler: () => void) {
    resetHandlers.set(key, handler);
    return () => {
      if (resetHandlers.get(key) === handler) resetHandlers.delete(key);
    };
  }
  function reset() {
    teamActions.reset();
    for (const handler of resetHandlers.values()) handler();
  }
  function memberNickname(id: string, fallback: string) {
    return id === DEMO_PARTICIPANT.id
      ? profileState.profile.nickname
      : fallback;
  }
  return {
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
