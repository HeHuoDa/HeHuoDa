<script setup lang="ts">
import { onLaunch, onShow, onHide } from "@dcloudio/uni-app";
import { getCurrentInstance } from "vue";
import { installH5Router } from "./navigation/h5-router";
import "./app.css";
import { useSessionStore } from "./stores/session";
import { useAppLifecycleStore } from "./stores/app-lifecycle";
import { useAuthStore } from "./stores/auth";
const instance = getCurrentInstance();

onLaunch(() => {
  useSessionStore();
  // 冷启动只持有刷新凭据恢复平台会话；没有凭据时保持匿名，不影响公开浏览。
  void useAuthStore().restore();
  // #ifdef H5
  installH5Router(instance!.appContext.config.globalProperties.$router);
  // #endif
});
onShow(() => {
  // 先处理本地会话到期，再刷新会话派生事件、恢复页面请求和时钟。
  useAuthStore().expireIfNeeded();
  useSessionStore().syncNotifications();
  useAppLifecycleStore().show();
});
onHide(() => useAppLifecycleStore().hide());
</script>
