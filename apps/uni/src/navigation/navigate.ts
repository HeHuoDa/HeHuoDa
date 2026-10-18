/*
 * 页面跳转的唯一入口。
 *
 * 平台主导航用 switchTab，普通页面用 navigateTo / redirectTo，
 * 不依赖浏览器 History，也不读写 document.title。
 * 页面栈只有一页时“返回”回落到首页，避免空栈无法返回。
 */

import { useNavigationStore } from "../stores/navigation";
import { routePath, type PageRouteName, type TabRouteName } from "./routes.ts";
import type { ProfileSection, RouteQuery } from "./params";

export type QueryValue = string | number | undefined;

export function withQuery(
  path: string,
  query: Record<string, QueryValue> = {},
): string {
  const search = Object.entries(query)
    .filter(([, value]) => value !== undefined && `${value}` !== "")
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(`${value}`)}`,
    )
    .join("&");
  return search ? `${path}?${search}` : path;
}

/** 切换主导航；switchTab 不支持参数，需要分区时用 openProfileSection。 */
export function openTab(name: TabRouteName): void {
  uni.switchTab({
    url: routePath(name),
    fail: () => {
      // tabBar 配置异常时至少保证能到目标页，不留在空白页。
      uni.reLaunch({ url: routePath(name) });
    },
  });
}

/** 打开普通页面，参数只用于定位展示内容。 */
export function openPage(
  name: PageRouteName,
  query?: Record<string, QueryValue>,
): void {
  uni.navigateTo({ url: withQuery(routePath(name), query) });
}

/** 替换当前页面，用于登录/注册互跳，避免堆叠重复页面。 */
export function replacePage(
  name: PageRouteName,
  query?: Record<string, QueryValue>,
): void {
  uni.redirectTo({ url: withQuery(routePath(name), query) });
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
): void {
  useNavigationStore().requestProfileSection(section, query);
  openTab("profile");
}
