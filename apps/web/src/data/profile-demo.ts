import { defineStore } from "pinia";
import { reactive, toRefs } from "vue";
import {
  initialProfileState,
  createProfileActions,
} from "@hehuoda/client-domain/profile";
export * from "@hehuoda/client-domain/profile";
export const useProfileDemoStore = defineStore("profile-demo", () => {
  const state = reactive(initialProfileState());
  return { ...toRefs(state), ...createProfileActions(state) };
});
