import type {
  College,
  CompetitionList,
  CompetitionDetail,
} from "@hehuoda/api-types";
import type { InjectionKey } from "vue";
import { ConsoleError } from "./resource";
export interface PublicCatalog {
  colleges(signal?: AbortSignal): Promise<College[]>;
  list(q: string, page: number, signal?: AbortSignal): Promise<CompetitionList>;
  detail(id: string, signal?: AbortSignal): Promise<CompetitionDetail>;
}
export const publicCatalogKey: InjectionKey<PublicCatalog> =
  Symbol("public-catalog");
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}
export function createPublicCatalog(): PublicCatalog {
  async function get<T>(
    path: string,
    valid: (value: unknown) => boolean,
    signal?: AbortSignal,
  ): Promise<T> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 5000);
    try {
      const response = await fetch("/api/v1" + path, {
        signal: signal
          ? AbortSignal.any([signal, timeout.signal])
          : timeout.signal,
        credentials: "omit",
      });
      if (!response.ok) throw new ConsoleError(response.status, "公开查询失败");
      const value: unknown = await response.json();
      if (!valid(value)) throw new Error("公开响应结构无效");
      return value as T;
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    colleges: (signal) =>
      get<College[]>(
        "/colleges",
        (value) =>
          Array.isArray(value) &&
          value.every(
            (item) =>
              object(item) &&
              typeof item.id === "string" &&
              typeof item.name === "string" &&
              typeof item.order === "number",
          ),
        signal,
      ),
    list: (q, page, signal) =>
      get<CompetitionList>(
        "/competitions?" +
          new URLSearchParams({
            q,
            hosts: "all",
            page: String(page),
            pageSize: "5",
          }),
        (value) =>
          object(value) &&
          Array.isArray(value.items) &&
          Number.isInteger(value.totalPages) &&
          typeof value.hasMore === "boolean" &&
          value.items.every(
            (item) =>
              object(item) &&
              object(item.competition) &&
              typeof item.competition.id === "string" &&
              typeof item.competition.name === "string",
          ),
        signal,
      ),
    detail: (id, signal) =>
      get<CompetitionDetail>(
        "/competitions/" + encodeURIComponent(id),
        (value) =>
          object(value) &&
          value.id === id &&
          typeof value.name === "string" &&
          Array.isArray(value.stages) &&
          Array.isArray(value.tracks) &&
          Array.isArray(value.notices),
        signal,
      ),
  };
}
