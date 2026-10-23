<script setup lang="ts">
import { onLaunch, onShow, onHide } from "@dcloudio/uni-app";
import "./app.css";
import { redirectUnknownH5Entry } from "./navigation/h5-entry.ts";
import { useSessionStore } from "./stores/session";
import { useAppLifecycleStore } from "./stores/app-lifecycle";

onLaunch(() => {
  useSessionStore();
  redirectUnknownH5Entry();
});
onShow(() => {
  // 先刷新会话派生事件，再让可见页面恢复请求和时钟。
  useSessionStore().syncNotifications();
  useAppLifecycleStore().show();
});
onHide(() => useAppLifecycleStore().hide());
</script>
