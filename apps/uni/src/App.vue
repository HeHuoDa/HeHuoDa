<script setup lang="ts">
import { onLaunch, onShow, onHide } from "@dcloudio/uni-app";
import { getCurrentInstance } from "vue";
import { installH5Router } from "./navigation/h5-router";
import "./app.css";
import { useSessionStore } from "./stores/session";
import { useAppLifecycleStore } from "./stores/app-lifecycle";
const instance = getCurrentInstance();

onLaunch(() => {
  useSessionStore();
  // #ifdef H5
  installH5Router(instance!.appContext.config.globalProperties.$router);
  // #endif
});
onShow(() => {
  // 先刷新会话派生事件，再让可见页面恢复请求和时钟。
  useSessionStore().syncNotifications();
  useAppLifecycleStore().show();
});
onHide(() => useAppLifecycleStore().hide());
</script>
