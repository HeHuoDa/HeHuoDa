<script setup lang="ts">
import { onLaunch } from "@dcloudio/uni-app";
import "./app.css";
import { redirectUnknownH5Entry } from "./navigation/h5-entry.ts";
import { useSessionStore } from "./stores/session";

onLaunch(() => {
  useSessionStore();
  redirectUnknownH5Entry();
});
</script>
