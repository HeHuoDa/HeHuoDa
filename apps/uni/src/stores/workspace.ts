import { defineStore } from "pinia";
import { ref } from "vue";
import type { HealthResponse } from "@hehuoda/api-types";

export const useWorkspaceStore = defineStore("workspace", () => {
  const count = ref(0);
  const input = ref("");
  // 编译期消费共享契约；真实健康请求由 #63 的统一请求适配器接入。
  const health = ref<HealthResponse | null>(null);
  function increment() {
    count.value += 1;
  }
  return { count, input, health, increment };
});
