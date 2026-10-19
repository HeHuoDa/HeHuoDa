import type { College, CompetitionList } from "@hehuoda/api-types";
import { colleges } from "@hehuoda/client-domain/colleges";
import {
  parseFilters,
  writeFilters,
  type Filters,
} from "@hehuoda/client-domain/competition-discovery";
import type { PendingRequest } from "../api/http.ts";
import { RequestError } from "../api/http.ts";

export interface DiscoveryState {
  filters: Filters;
  directoryStatus: "idle" | "loading" | "ready" | "error";
  status: "idle" | "loading" | "ready" | "error";
  response: CompetitionList | null;
  directory: College[];
  error: string;
  requestId: string | null;
}
export function initialDiscoveryState(): DiscoveryState {
  return {
    filters: parseFilters({}),
    directoryStatus: "idle",
    status: "idle",
    response: null,
    directory: [],
    error: "",
    requestId: null,
  };
}
interface DiscoveryApi {
  colleges(): PendingRequest<College[]>;
  list(filters: Filters): PendingRequest<CompetitionList>;
}
/** 页面实例拥有状态和目录；隐藏时中断请求，恢复时保留筛选及服务端纠正后的页码。 */
export function createDiscoveryController(
  state: DiscoveryState,
  api: DiscoveryApi,
) {
  let generation = 0;
  let directoryRequest: PendingRequest<College[]> | null = null;
  let listRequest: PendingRequest<CompetitionList> | null = null;
  function cancel() {
    ++generation;
    directoryRequest?.cancel();
    listRequest?.cancel();
    directoryRequest = null;
    listRequest = null;
    if (state.directoryStatus === "loading") state.directoryStatus = "idle";
    if (state.status === "loading") state.status = "idle";
  }
  async function load() {
    cancel();
    const current = generation;
    state.status = "loading";
    state.response = null;
    state.error = "";
    state.requestId = null;
    try {
      if (state.directoryStatus !== "ready") {
        state.directoryStatus = "loading";
        directoryRequest = api.colleges();
        const directory = await directoryRequest.promise;
        if (current !== generation) return;
        if (
          directory.length !== colleges.length ||
          directory.some(
            (c, i) =>
              c.id !== colleges[i]?.id ||
              c.name !== colleges[i]?.name ||
              c.order !== i,
          )
        )
          throw new Error("学院目录与页面资源不一致，请重试或联系维护人员。");
        state.directory = directory;
        state.directoryStatus = "ready";
        directoryRequest = null;
      }
      listRequest = api.list(state.filters);
      const response = await listRequest.promise;
      if (current !== generation) return;
      state.filters = { ...state.filters, page: response.page };
      state.response = response;
      state.status = "ready";
    } catch (error) {
      if (current !== generation) return;
      if (state.directoryStatus === "loading") state.directoryStatus = "error";
      state.status = "error";
      const directoryFailure = state.directoryStatus === "error";
      state.error =
        error instanceof RequestError
          ? `${directoryFailure ? "学院目录" : "比赛"}加载失败：${error.message}`
          : error instanceof Error
            ? error.message
            : "加载失败，请稍后重试。";
      state.requestId = error instanceof RequestError ? error.requestId : null;
    } finally {
      if (current === generation) {
        directoryRequest = null;
        listRequest = null;
      }
    }
  }
  return {
    load,
    cancel,
    update(patch: Partial<Filters>) {
      state.filters = parseFilters(
        writeFilters({}, { ...state.filters, ...patch, page: 1 }),
      );
      return load();
    },
    page(page: number) {
      state.filters = {
        ...state.filters,
        page: Number.isSafeInteger(page) && page > 0 ? page : 1,
      };
      return load();
    },
    resume() {
      return state.status === "idle" ? load() : Promise.resolve();
    },
  };
}
