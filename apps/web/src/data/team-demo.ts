import { defineStore } from "pinia";
import { computed, reactive, toRefs } from "vue";
import { useProfileDemoStore } from "./profile-demo";
import {
  initialTeamState,
  pendingApplications,
  createTeamActions,
} from "@hehuoda/client-domain/team-session";
export * from "@hehuoda/client-domain/team";
export const useTeamDemoStore = defineStore("team-demo", () => {
  const state = reactive(initialTeamState());
  const profile = useProfileDemoStore();
  return {
    ...toRefs(state),
    applications: computed(() => pendingApplications(state)),
    ...createTeamActions(state, profile),
  };
});
