import type { LocationQuery } from "vue-router";
import type { PageQuery } from "./resource";
export function readQuery(
  query: LocationQuery,
  states: Record<string, string>,
): PageQuery {
  const first = (key: string) => {
    const value = query[key];
    return String((Array.isArray(value) ? value[0] : value) ?? "");
  };
  const page = Number(first("page"));
  const date = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
      ? value
      : "";
  let from = date(first("from")),
    to = date(first("to"));
  if (from && to && from > to) {
    from = "";
    to = "";
  }
  const size = Number(first("pageSize"));
  return {
    q: first("q"),
    status: Object.hasOwn(states, first("status")) ? first("status") : "",
    from,
    to,
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    // 各列表选项不同（比赛支持 10/20/50），只保留服务端接受的 1–50 正整数。
    pageSize: Number.isSafeInteger(size) && size >= 1 && size <= 50 ? size : 5,
  };
}
