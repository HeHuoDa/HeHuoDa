import type { LocationQuery, LocationQueryRaw } from "vue-router";
import { colleges } from "./colleges";
import type { CollegeSelection } from "./college-selection";
import type { Time, CompetitionScope } from "@hehuoda/api-types";

export const statuses = {
  upcoming: "尚未开始",
  open: "报名时段内",
  closed: "已截止",
  unknown: "待公布 / 待核对",
  conflict: "时间待核对",
};
export type Status = keyof typeof statuses;
export type Filters = {
  hosts: CollegeSelection;
  q: string;
  status: Status | "";
  page: number;
};

export const PAGE_SIZE = 4;
// category、eligible 是已移除的筛选参数；规范化旧链接时一并清理。
const owned = ["hosts", "q", "category", "status", "eligible", "page"];
const first = (value: LocationQuery[string]) =>
  (Array.isArray(value) ? value[0] : value) ?? "";
const tokens = (value: LocationQuery[string]) =>
  (Array.isArray(value) ? value : [value]).flatMap((v) => v?.split(",") ?? []);
export function parseFilters(query: LocationQuery): Filters {
  const hostTokens = tokens(query.hosts);
  const ids = colleges
    .filter((c) => hostTokens.includes(c.id))
    .map((c) => c.id);
  const page = Number(first(query.page));
  // 缺少 hosts 表示默认全选；显式空值表示未选中任何学院。
  return {
    hosts: !Object.hasOwn(query, "hosts")
      ? "all"
      : ids.length
        ? ids
        : hostTokens.includes("all")
          ? "all"
          : [],
    q: first(query.q).trim().slice(0, 100),
    status: Object.hasOwn(statuses, first(query.status))
      ? (first(query.status) as Status)
      : "",
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}
export function writeFilters(
  query: LocationQuery,
  filters: Filters,
): LocationQueryRaw {
  const result: LocationQueryRaw = { ...query };
  owned.forEach((key) => delete result[key]);
  if (filters.hosts === "all") result.hosts = "all";
  else if (filters.hosts.length)
    result.hosts = colleges
      .filter((c) => filters.hosts.includes(c.id))
      .map((c) => c.id)
      .join(",");
  else result.hosts = "";
  if (filters.q) result.q = filters.q;
  if (filters.status) result.status = filters.status;
  if (filters.page > 1) result.page = String(filters.page);
  return result;
}
export function canonicalQuery(query: LocationQuery): LocationQueryRaw {
  const filters = parseFilters(query);

  return writeFilters(query, filters);
}
export function collegeNames(ids: readonly string[]) {
  return (
    ids.map((id) => colleges.find((c) => c.id === id)?.name).join("、") ||
    "校级组织 / 承办学院待核对"
  );
}
export function scopeLabel(scope: CompetitionScope) {
  return scope.kind === "all"
    ? "全校开放"
    : scope.kind === "colleges"
      ? collegeNames(scope.colleges)
      : "资格需核对原文";
}
const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export function materialDeadlineLabel(value?: Time, now?: string) {
  return (
    formatTime(value) +
    (value?.value &&
    now &&
    (value.precision === "instant"
      ? Date.parse(value.value) <= Date.parse(now)
      : value.precision === "date" &&
        new Date(Date.parse(now) + 8 * 3600_000).toISOString().slice(0, 10) >
          value.value)
      ? "（材料已截止）"
      : "")
  );
}
export function formatTime(value?: Time) {
  if (!value?.value) return "待公布";
  return value.precision === "date"
    ? value.value + "（具体时刻待公布）"
    : dateFormatter.format(new Date(value.value));
}
export function formatEvaluatedAt(value?: string) {
  return value ? dateFormatter.format(new Date(value)) : "待获取";
}
