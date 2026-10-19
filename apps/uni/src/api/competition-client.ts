import type {
  College,
  CompetitionList,
  CompetitionEntry,
  CompetitionDetail,
} from "@hehuoda/api-types";
import {
  parseFilters,
  PAGE_SIZE,
  statuses,
  type Filters,
} from "@hehuoda/client-domain/competition-discovery";
import { createHttpClient } from "./http.ts";

type HttpClient = ReturnType<typeof createHttpClient>;
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
const integer = (v: unknown, min = 0): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min;
const date = (v: unknown): v is string =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
function time(v: unknown): boolean {
  if (!object(v)) return false;
  return v.precision === "unknown"
    ? v.value === null
    : v.precision === "date"
      ? typeof v.value === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(v.value) &&
        date(v.value)
      : v.precision === "instant" && date(v.value);
}
function entry(v: unknown): v is CompetitionEntry {
  if (!object(v) || !object(v.competition) || !object(v.stage)) return false;
  const c = v.competition,
    s = v.stage;
  return (
    [c.id, c.name, s.id, s.name].every(
      (x) => typeof x === "string" && x.trim().length > 0,
    ) &&
    [c.edition, c.category, c.organizer].every((x) => typeof x === "string") &&
    ["official", "historical", "demo"].includes(String(c.origin)) &&
    strings(s.hosts) &&
    object(s.scope) &&
    ["all", "colleges", "complex", "unknown"].includes(String(s.scope.kind)) &&
    strings(s.scope.colleges) &&
    typeof s.scope.note === "string" &&
    typeof s.status === "string" &&
    Object.hasOwn(statuses, s.status) &&
    typeof s.conflict === "boolean" &&
    time(s.deadline) &&
    time(s.materialsAt)
  );
}
export function isCollegeDirectory(v: unknown): v is College[] {
  return (
    Array.isArray(v) &&
    v.every(
      (c) =>
        object(c) &&
        typeof c.id === "string" &&
        typeof c.name === "string" &&
        integer(c.order),
    )
  );
}
export function isCompetitionList(v: unknown): v is CompetitionList {
  if (!object(v) || !Array.isArray(v.items) || !v.items.every(entry))
    return false;
  return (
    integer(v.page, 1) &&
    v.pageSize === PAGE_SIZE &&
    integer(v.totalStages) &&
    integer(v.totalCompetitions) &&
    integer(v.totalPages, 1) &&
    v.totalCompetitions <= v.totalStages &&
    v.totalPages === Math.max(1, Math.ceil(v.totalStages / PAGE_SIZE)) &&
    v.page <= v.totalPages &&
    v.hasMore === v.page < v.totalPages &&
    v.items.length ===
      Math.min(
        PAGE_SIZE,
        Math.max(0, v.totalStages - (v.page - 1) * PAGE_SIZE),
      ) &&
    date(v.evaluatedAt)
  );
}
export function isCompetitionDetail(v: unknown): v is CompetitionDetail {
  if (
    !object(v) ||
    !Array.isArray(v.stages) ||
    !Array.isArray(v.tracks) ||
    !Array.isArray(v.notices) ||
    !date(v.evaluatedAt)
  )
    return false;
  const textFields = (o: Record<string, unknown>, keys: string[]) =>
    keys.every((key) => typeof o[key] === "string");
  const unique = (items: unknown[]) =>
    new Set(items.map((item) => (object(item) ? item.id : null))).size ===
    items.length;
  if (
    !textFields(v, ["id", "name", "edition", "category", "organizer"]) ||
    !["official", "historical", "demo"].includes(String(v.origin))
  )
    return false;
  return (
    unique(v.tracks) &&
    unique(v.stages) &&
    unique(v.notices) &&
    v.tracks.every(
      (t) =>
        object(t) &&
        textFields(t, ["id", "name", "members", "rules"]) &&
        ["individual", "team", "mixed"].includes(String(t.mode)),
    ) &&
    v.stages.every(
      (s) =>
        object(s) &&
        entry({ competition: v, stage: s }) &&
        textFields(s, ["organizer", "timeNote", "registration"]) &&
        integer(s.order) &&
        strings(s.sourceIds) &&
        time(s.startsAt) &&
        time(s.eventAt),
    ) &&
    v.notices.every(
      (n) =>
        object(n) &&
        textFields(n, ["id", "title", "publisher", "url"]) &&
        (n.publishedAt === null || typeof n.publishedAt === "string") &&
        (n.checkedAt === null || typeof n.checkedAt === "string") &&
        ["registration", "supplement", "award", "news"].includes(
          String(n.kind),
        ),
    )
  );
}
/** 不使用 URLSearchParams，H5 与微信通过相同 uni.request 入口发送。 */
export function createCompetitionApi(http: HttpClient) {
  return {
    detail(id: string) {
      return http.get(
        `/competitions/${encodeURIComponent(id)}`,
        isCompetitionDetail,
      );
    },
    colleges: () => http.get("/colleges", isCollegeDirectory),
    list(filters: Filters) {
      const f = parseFilters({
        hosts: filters.hosts === "all" ? "all" : filters.hosts.join(","),
        q: filters.q,
        status: filters.status,
        page: String(filters.page),
      });
      const pairs: [string, string][] = [
        ["hosts", f.hosts === "all" ? "all" : f.hosts.join(",")],
      ];
      if (f.q) pairs.push(["q", f.q]);
      if (f.status) pairs.push(["status", f.status]);
      pairs.push(["page", String(f.page)], ["pageSize", String(PAGE_SIZE)]);
      return http.get(
        "/competitions?" +
          pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&"),
        isCompetitionList,
      );
    },
  };
}
