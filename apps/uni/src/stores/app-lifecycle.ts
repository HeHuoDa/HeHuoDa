import { defineStore } from "pinia";
import { ref } from "vue";

/** 仅表示应用前后台，不代表业务会话或页面是否显示。 */
export const useAppLifecycleStore = defineStore("app-lifecycle", () => {
  const foreground = ref(true);
  function show() {
    foreground.value = true;
  }
  function hide() {
    foreground.value = false;
  }
  return { foreground, show, hide };
});
