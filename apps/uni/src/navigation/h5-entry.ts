/*
 * H5 入口兜底：hash 指向未注册页面时显示 404。
 *
 * 小程序页面由 pages.json 静态注册，不存在“未知页面”；
 * H5 允许直接改地址，因此启动时做一次存在性判断。
 * 这里只读一次 location.hash 做校验，页面跳转仍走 navigation/navigate.ts，
 * 不依赖 History 状态，也不读写 document.title。
 */

import { openNotFound } from "./navigate.ts";
import { routeRegistry } from "./routes.ts";

export function redirectUnknownH5Entry(): void {
  // #ifdef H5
  const hash = globalThis.location.hash.replace(/^#/, "");
  const path = `/${hash.split("?")[0].replace(/^\/+/, "")}`;
  if (!path || path === "/") return;
  const known = Object.values(routeRegistry).some(
    (route) => route.path === path,
  );
  if (!known) openNotFound();
  // #endif
}
