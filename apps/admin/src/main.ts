import { createApp } from "vue";
import ElementPlus from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import "element-plus/dist/index.css";
import "./style.css";
import App from "./App.vue";
import { router } from "./router";
import { adminHttp } from "./runtime";
import {
  createAdminServices,
  createControlService,
  createReviewService,
} from "./adapters";
import { adminServicesKey } from "./services";
import { ingestionControlKey } from "./console/ingestion-control";
import { reviewKey } from "./console/review";
import { safeReturn } from "./http";
adminHttp.onUnauthorized(() => {
  if (router.currentRoute.value.path !== "/login")
    void router.replace({
      path: "/login",
      query: { returnTo: safeReturn(router.currentRoute.value.fullPath) },
    });
});
router.beforeEach(async (to) => {
  if (!adminHttp.state.ready) {
    try {
      await adminHttp.restore();
    } catch {
      return to.path === "/login"
        ? true
        : { path: "/login", query: { error: "session-unavailable" } };
    }
  }
  if (to.path !== "/login" && !adminHttp.state.session)
    return { path: "/login", query: { returnTo: safeReturn(to.fullPath) } };
  return true;
});
createApp(App)
  .provide(adminServicesKey, createAdminServices(adminHttp))
  .provide(
    ingestionControlKey,
    createControlService(adminHttp, () => adminHttp.state.session?.id ?? ""),
  )
  .provide(reviewKey, createReviewService(adminHttp))
  .use(router)
  .use(ElementPlus, { locale: zhCn })
  .mount("#app");
