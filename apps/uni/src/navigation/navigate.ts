/*
 * 页面跳转的唯一入口。
 *
 * 平台主导航用 switchTab，普通页面用 navigateTo / redirectTo，
 * 不依赖浏览器 History，也不读写 document.title。
 * 页面栈只有一页时“返回”回落到首页，避免空栈无法返回。
 */

import { useNavigationStore } from "../stores/navigation";
import { useSessionStore } from "../stores/session";
import { routePath, type PageRouteName, type TabRouteName } from "./routes.ts";
import type { ProfileSection, RouteQuery } from "./params";
import { replaceH5TabQuery, prepareH5PageAddress } from "./h5-router";

export type QueryValue = string | string[] | number | undefined;

export function withQuery(
  path: string,
  query: Record<string, QueryValue> = {},
): string {
  const search = Object.entries(query)
    // 显式空 hosts 与合法附加 query 的空值均有语义，只剔除缺省值。
    .filter(([, value]) => value !== undefined)
    .flatMap(([key, value]) =>
      (Array.isArray(value) ? value : [value]).map(
        (item) => `${encodeURIComponent(key)}=${encodeURIComponent(`${item}`)}`,
      ),
    )
    .join("&");
  return search ? `${path}?${search}` : path;
}

/** 切换主导航；switchTab 不支持参数，需要分区时用 openProfileSection。 */
export function openTab(
  name: TabRouteName,
  onFailure?: () => void,
  onSuccess?: () => void,
): void {
  const session = useSessionStore();
  const revision = session.sessionRevision;
  const complete = () => {
    if (revision === session.sessionRevision) onSuccess?.();
  };
  uni.switchTab({
    url: routePath(name),
    success: complete,
    fail: () => {
      if (revision !== session.sessionRevision) return;
      // tabBar 配置异常时至少保证能到目标页，不留在空白页。
      uni.reLaunch({
        url: routePath(name),
        success: complete,
        fail: () => {
          if (revision === session.sessionRevision) onFailure?.();
        },
      });
    },
  });
}

/** 打开普通页面，参数只用于定位展示内容。 */
export function openPage(
  name: PageRouteName,
  query?: Record<string, QueryValue>,
  onFailure?: () => void,
  onSuccess?: () => void,
): void {
  const url = withQuery(routePath(name), query);
  const complete = prepareH5PageAddress(url);
  uni.navigateTo({
    url,
    fail: onFailure,
    success: onSuccess,
    complete,
  });
}

/** 替换当前页面，用于登录/注册互跳，避免堆叠重复页面。 */
export function replacePage(
  name: PageRouteName,
  query?: Record<string, QueryValue>,
): void {
  const url = withQuery(routePath(name), query);
  const complete = prepareH5PageAddress(url);
  uni.redirectTo({ url, complete });
}

/** 返回上一页；页面栈只有当前页时回到首页。 */
export function backOrHome(): void {
  if (getCurrentPages().length > 1) {
    uni.navigateBack({ delta: 1 });
    return;
  }
  openTab("home");
}

/** 兜底：入口无法解析时替换为 404 页，不保留错误地址。 */
export function openNotFound(): void {
  uni.reLaunch({ url: routePath("not-found") });
}

/**
 * 打开个人中心并落到指定分区。
 * switchTab 不接收 query，因此用一次性状态交接，由个人中心在 onShow 消费。
 */
export function openProfileSection(
  section: ProfileSection,
  query: RouteQuery = {},
  onFailure?: () => void,
): void {
  useNavigationStore().requestProfileSection(section, query);
  // H5 对当前 tab 再次 switchTab 可能只触发 onHide；可见页直接消费交接。
  if (
    typeof getCurrentPages === "function" &&
    getCurrentPages().at(-1)?.route === routePath("profile").slice(1)
  ) {
    replaceH5TabQuery("profile", { ...query, section });
    return;
  }
  openTab(
    "profile",
    () => {
      useNavigationStore().clearProfileNavigation();
      onFailure?.();
    },
    () => replaceH5TabQuery("profile", { ...query, section }),
  );
}

/** switchTab 不能携带 query；首页返回条件与关联招募用同一个一次性交接入口。 */
export function openTabWithQuery(
  name: "home" | "teams",
  query: RouteQuery,
): void {
  useNavigationStore().requestTabQuery(name, query);
  openTab(name, undefined, () => replaceH5TabQuery(name, query));
}

export function returnToCompetitions(query: RouteQuery): void {
  const pages = getCurrentPages();
  if (
    pages.length > 1 &&
    pages[pages.length - 2].route === routePath("home").slice(1)
  ) {
    uni.navigateBack({ delta: 1 });
    return;
  }
  openTabWithQuery("home", query);
}

/** 返回找队友列表：上一页就是列表时直接回退，保留页面实例里的筛选与页码。 */
export function returnToTeams(query: RouteQuery): void {
  const pages = getCurrentPages();
  if (
    pages.length > 1 &&
    pages[pages.length - 2].route === routePath("teams").slice(1)
  ) {
    uni.navigateBack({ delta: 1 });
    return;
  }
  openTabWithQuery("teams", query);
}
