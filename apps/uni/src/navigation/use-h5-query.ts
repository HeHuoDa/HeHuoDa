import { getCurrentInstance, watch } from "vue";
import { onHide, onShow } from "@dcloudio/uni-app";
import type { Router } from "vue-router";
import {
  canonicalH5Query,
  readH5PageQuery,
  writeH5Query,
} from "./h5-address.ts";
import { routeRegistry, type RouteName } from "./routes.ts";
import type { RouteQuery } from "./params.ts";
import {
  parseFilters,
  writeFilters,
} from "@hehuoda/client-domain/competition-discovery";
import {
  parseTeamFilters,
  writeTeamFilters,
} from "@hehuoda/client-domain/team";
import { copyRouteQuery } from "./params.ts";

/** 页面仍由 uni 管理；仅在 H5 同步当前页参数，不缓存业务状态或页面栈。 */
export function useH5Query(
  name: RouteName,
  read: () => RouteQuery,
  restore: (query: RouteQuery) => void,
) {
  // #ifdef H5
  const router = getCurrentInstance()?.appContext.config.globalProperties
    .$router as Router | undefined;
  if (!router) return;
  const path = routeRegistry[name].path;
  let visible = false;
  let applying = false;
  let extras: RouteQuery = {};
  function merged(): RouteQuery {
    if (name === "home")
      return copyRouteQuery(writeFilters(extras, parseFilters(read())));
    if (name === "teams")
      return copyRouteQuery(writeTeamFilters(extras, parseTeamFilters(read())));
    const query = { ...extras, ...read() };
    if (name === "profile" && (extras.section || "profile") !== query.section)
      for (const key of ["teamId", "recordId", "invitationId", "revision"])
        delete query[key];
    return query;
  }
  const signature = (query: RouteQuery) =>
    writeH5Query(
      Object.fromEntries(
        Object.entries(query).sort(([a], [b]) => a.localeCompare(b)),
      ),
    );
  function receive() {
    if (!router || !visible || router.currentRoute.value.path !== path) return;
    const query = readH5PageQuery(router.currentRoute.value.fullPath);
    const canonical = canonicalH5Query(name, query);
    if (signature(canonical) !== signature(canonicalH5Query(name, merged()))) {
      applying = true;
      restore(canonical);
      applying = false;
    }
    extras = canonical;
  }
  onShow(() => {
    visible = true;
    receive();
  });
  onHide(() => {
    visible = false;
  });
  watch(() => router.currentRoute.value.fullPath, receive, { flush: "post" });
  watch(
    read,
    () => {
      if (applying || !visible || router.currentRoute.value.path !== path)
        return;
      const query = canonicalH5Query(name, merged());
      const search = writeH5Query(query);
      const target = path + (search ? `?${search}` : "");
      if (target !== router.currentRoute.value.fullPath)
        void router.replace(target);
    },
    { deep: true, flush: "post" },
  );
  // #endif
}
