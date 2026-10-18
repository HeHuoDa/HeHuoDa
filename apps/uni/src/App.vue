<script setup lang="ts">
import { onLaunch } from "@dcloudio/uni-app";
import "./app.css";
import { redirectUnknownH5Entry } from "./navigation/h5-entry.ts";

onLaunch(() => {
  redirectUnknownH5Entry();
});
</script>
