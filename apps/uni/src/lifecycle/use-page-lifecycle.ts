import { onScopeDispose, watch } from "vue";
import { onShow, onHide, onUnload } from "@dcloudio/uni-app";
import { useAppLifecycleStore } from "../stores/app-lifecycle.ts";
import { createPageLifecycle, type PageResources } from "./page-controller.ts";

/** 页面独占的计时器、监听及请求在隐藏、后台、卸页和组件卸载时释放。 */
export function usePageLifecycle(resources: PageResources) {
  const app = useAppLifecycleStore();
  const page = createPageLifecycle(resources, app.foreground);
  const stop = watch(() => app.foreground, page.setForeground, {
    flush: "sync",
  });
  function dispose() {
    page.dispose();
    stop();
  }
  onShow(page.show);
  onHide(page.hide);
  onUnload(dispose);
  onScopeDispose(dispose);
}
