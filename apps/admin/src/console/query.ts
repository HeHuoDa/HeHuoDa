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
  return {
    q: first("q"),
    status: Object.hasOwn(states, first("status")) ? first("status") : "",
    from: /^\d{4}-\d{2}-\d{2}$/.test(first("from")) ? first("from") : "",
    to: /^\d{4}-\d{2}-\d{2}$/.test(first("to")) ? first("to") : "",
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    pageSize: first("pageSize") === "10" ? 10 : 5,
  };
}
