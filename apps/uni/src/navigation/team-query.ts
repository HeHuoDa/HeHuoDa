/*
 * 队伍筛选 ↔ 路由参数的唯一转换边界。
 *
 * `parseTeamFilters` / `writeTeamFilters` 面向通用 Query，允许 string[] 与
 * undefined；而页面跳转入口只接受单值。页面不各自拼装或做类型断言，
 * 统一在这里归一，避免列表、详情、发布三处出现不一致的参数形态。
 */

import {
  parseTeamFilters,
  writeTeamFilters,
  type TeamFilters,
} from "@hehuoda/client-domain/team";
import { copyRouteQuery, type RouteQuery } from "./params.ts";

const FILTER_KEYS = [
  "q",
  "type",
  "role",
  "mode",
  "status",
  "competition",
  "page",
] as const;

/**
 * 归一为可传给 openPage / openTabWithQuery 的单值 query。
 * 顺序稳定，便于比较与测试；空值与 page<=1 由 writeTeamFilters 先行剔除。
 */
export function teamRouteQuery(filters: TeamFilters): Record<string, string> {
  const query = writeTeamFilters({}, filters);
  const result: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    const value = query[key];
    const single = Array.isArray(value) ? value[0] : value;
    if (single) result[key] = single;
  }
  return result;
}

/**
 * 解析平台参数：onLoad 的原始 query 与一次性交接的 RouteQuery 都走这里。
 * 非字符串值被过滤，白名单与页码规则沿用 parseTeamFilters。
 */
export function parseTeamRouteQuery(query: unknown): TeamFilters {
  return parseTeamFilters(toRouteQuery(query));
}

function toRouteQuery(query: unknown): RouteQuery {
  return query !== null && typeof query === "object"
    ? copyRouteQuery(query as Record<string, unknown>)
    : {};
}
