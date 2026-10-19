import { defineStore } from "pinia";
import { reactive, toRefs } from "vue";
import { healthApi } from "../api/health";
import {
  createHealthController,
  initialHealthState,
} from "./health-controller";

export const useHealthStore = defineStore("health", () => {
  const state = reactive(initialHealthState());
  const controller = createHealthController(state, healthApi.getHealth);
  return { ...toRefs(state), ...controller };
});
