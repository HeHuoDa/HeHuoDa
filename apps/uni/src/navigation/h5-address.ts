import { canonicalQuery } from "@hehuoda/client-domain/competition-discovery";
import { canonicalTeamQuery } from "@hehuoda/client-domain/team";
import { copyRouteQuery, type RouteQuery } from "./params.ts";
import {
  resolveSourceAddress,
  routeRegistry,
  type RouteName,
} from "./routes.ts";

/** URLSearchParams 已解码一次；重复键保留数组，交给既有客户端规则处理。 */
export function readH5Query(search: string): RouteQuery {
  const params = new URLSearchParams(search);
  return Object.fromEntries(
    [...new Set(params.keys())].map((key) => {
      const values = params.getAll(key);
      return [key, values.length === 1 ? values[0] : values];
    }),
  );
}

export function writeH5Query(query: RouteQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value])
      params.append(key, item);
  }
  // 与应用内 withQuery 一样使用 %20，而不是表单的 +。
  return params.toString().replace(/\+/g, "%20");
}

export function readH5PageQuery(address: string): RouteQuery {
  const index = address.indexOf("?");
  return readH5Query(index < 0 ? "" : address.slice(index + 1));
}

export function canonicalH5Query(name: RouteName, raw: RouteQuery): RouteQuery {
  const query = copyRouteQuery(raw);
  delete query.category;
  delete query.eligible;
  if (name === "profile" && query.section === "profile") delete query.section;
  if (name === "home" || name === "competition-detail")
    return copyRouteQuery(canonicalQuery(query));
  if (["teams", "team-detail", "team-new"].includes(name))
    return copyRouteQuery(canonicalTeamQuery(query));
  return query;
}

/** H5 链路保留合法附加参数；小程序仍以显式参数与一次性交接为准。 */
export function currentH5Query(): RouteQuery {
  // #ifdef H5
  if (typeof globalThis.location !== "undefined")
    return readH5PageQuery(globalThis.location.hash);
  // #endif
  return {};
}

/** DCloud H5 的 onLoad 会再次解码 query；以地址原文解析一次，避免 %252F 变成 /。 */
export function pageRouteQuery(
  platformQuery: Record<string, unknown>,
): RouteQuery {
  // #ifdef H5
  if (typeof globalThis.location !== "undefined") return currentH5Query();
  // #endif
  return copyRouteQuery(platformQuery);
}

/** 仅计算地址，不导航、不维护第二份路由状态。返回值是 uni 原生页面地址。 */
export function resolveH5Address(address: string): string {
  const url = new URL(address);
  if (url.pathname === "/" && url.hash && !url.hash.startsWith("#/"))
    return routeRegistry["not-found"].path;
  const native = url.pathname === "/" && url.hash.startsWith("#/");
  const entry = native ? url.hash.slice(1) : url.pathname + url.search;
  const queryIndex = entry.indexOf("?");
  const path = queryIndex < 0 ? entry : entry.slice(0, queryIndex);
  const raw = readH5PageQuery(entry);
  if (native && path === "/")
    return resolveH5Address(`${url.origin}/home?${writeH5Query(raw)}`);
  const registered = native
    ? Object.values(routeRegistry).find((route) => route.path === path)
    : undefined;
  const resolved = registered
    ? { name: registered.name, params: {}, query: raw }
    : native
      ? { name: "not-found" as const, params: {}, query: {} }
      : resolveSourceAddress(path, raw);
  const query = copyRouteQuery(resolved.query);
  Object.assign(query, resolved.params);
  if ("section" in resolved && resolved.section !== "profile")
    query.section = resolved.section as string;
  if (!native && resolved.name === "competition-detail" && url.hash) {
    try {
      query.stage = decodeURIComponent(url.hash.slice(1));
    } catch {
      query.stage = "invalid-anchor";
    }
  }
  const encoded = writeH5Query(canonicalH5Query(resolved.name, query));
  return routeRegistry[resolved.name].path + (encoded ? `?${encoded}` : "");
}
