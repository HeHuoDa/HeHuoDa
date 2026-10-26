import { nextTick } from "vue";
import type { Router } from "vue-router";
import { resolveH5Address, writeH5Query } from "./h5-address.ts";
import type { RouteQuery } from "./params.ts";
import type { TabRouteName } from "./routes.ts";
import { routeRegistry } from "./routes.ts";
let h5Router: Router | undefined;
let pendingPageAddress: { address: string } | undefined;

/** 当前 DCloud H5 会再次编码 url query；只校正本次显式 uni 跳转，深链不多解码。 */
export function prepareH5PageAddress(address: string): () => void {
  // #ifdef H5
  if (h5Router) {
    const pending = { address };
    pendingPageAddress = pending;
    return () => {
      if (pendingPageAddress === pending) pendingPageAddress = undefined;
    };
  }
  // #endif
  return () => {};
}

export function replaceH5TabQuery(name: TabRouteName, query: RouteQuery): void {
  // #ifdef H5
  const search = writeH5Query(query);
  void h5Router?.replace(
    routeRegistry[name].path + (search ? `?${search}` : ""),
  );
  // #endif
}

/** 装饰 uni 已创建的 router；不安装另一套路由或修改 uni 页面栈。 */
export function installH5Router(router: Router): void {
  // #ifdef H5
  h5Router = router;
  const originalScroll = router.options.scrollBehavior;
  router.options.scrollBehavior = (to, from, saved) => {
    if (!saved && to.path === from.path)
      return { left: globalThis.scrollX, top: globalThis.scrollY };
    return originalScroll?.(to, from, saved);
  };
  router.beforeEach((to) => {
    const pending = pendingPageAddress?.address;
    pendingPageAddress = undefined;
    if (pending && pending.split("?")[0] === to.path) {
      const target = resolveH5Address(
        `${globalThis.location.origin}/#${pending}`,
      );
      if (target !== to.fullPath) return router.resolve(target);
    }
    // uni H5 的 tabBar 把入口页（首页）归一化成根路径 `/` 提交给 router，
    // 而 `/` 不在页面注册表里。先按地址规则转成首页，再判断是否未知页面，
    // 否则每次点首页 tab 都会被当成非法地址送进 404。
    if (to.path === "/") {
      const home = resolveH5Address(
        `${globalThis.location.origin}/#${to.fullPath}`,
      );
      if (home !== to.fullPath) return router.resolve(home);
    }
    if (!Object.values(routeRegistry).some((route) => route.path === to.path))
      return { path: routeRegistry["not-found"].path, replace: true };
    const target = resolveH5Address(
      `${globalThis.location.origin}/#${to.fullPath}`,
    );
    if (target !== to.fullPath) return router.resolve(target);
  });
  const title = async () => {
    await nextTick();
    const route = Object.values(routeRegistry).find(
      (entry) => entry.path === router.currentRoute.value.path,
    );
    if (route) globalThis.document.title = `${route.title} · 禾伙搭`;
  };
  router.afterEach(() => {
    void title();
  });
  void title();
  // #endif
}
