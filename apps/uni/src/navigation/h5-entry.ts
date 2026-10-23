/*
 * H5 启动兼容：在 uni 首次解析前，将旧 pathname 转为原生 hash 页面。
 *
 * 小程序页面由 pages.json 静态注册，不存在“未知页面”；
 * 保留当前 history.state，只替换地址，避免给浏览器回退增加一条迁移记录。
 * 运行期间仍由 uni 自带 router 管理页面与历史。
 */

import { resolveH5Address } from "./h5-address.ts";

export function prepareH5Entry(): void {
  // #ifdef H5
  const target = `/#${resolveH5Address(globalThis.location.href)}`;
  if (
    globalThis.location.pathname +
      globalThis.location.search +
      globalThis.location.hash !==
    target
  )
    globalThis.history.replaceState(globalThis.history.state, "", target);
  // #endif
}
