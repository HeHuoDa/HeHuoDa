/*
 * 找队友列表的页面控制器：筛选、分页、演示时钟与关联比赛查询。
 *
 * 页面只负责渲染与生命周期，规则全部在这里，便于用固定时钟和替身请求测试。
 * 不读写存储、不拼 URL、不依赖浏览器 History。
 */

import type { CompetitionDetail } from "@hehuoda/api-types";
import {
  filterTeams,
  parseTeamFilters,
  writeTeamFilters,
  TEAM_PAGE_SIZE,
  type Team,
  type TeamFilters,
} from "@hehuoda/client-domain/team";
import {
  RequestError,
  requestErrorMessage,
  type PendingRequest,
} from "../api/http.ts";
import type { RouteQuery } from "../navigation/params.ts";

export type CompetitionStatus =
  "idle" | "loading" | "ready" | "missing" | "error";

export interface TeamListState {
  filters: TeamFilters;
  /** 演示时钟；招募截止与状态判定都以它为准。 */
  now: number;
  competition: CompetitionDetail | null;
  competitionStatus: CompetitionStatus;
  competitionError: string;
  competitionRequestId: string | null;
}

export interface TeamListView {
  results: Team[];
  pages: number;
  page: number;
  visible: Team[];
}

export interface TeamListDeps {
  teams: () => Team[];
  api: { detail(id: string): PendingRequest<CompetitionDetail> };
  now?: () => number;
  interval?: (fn: () => void, ms: number) => unknown;
  clear?: (handle: unknown) => void;
}

export function initialTeamListState(now = Date.now()): TeamListState {
  return {
    filters: parseTeamFilters({}),
    now,
    competition: null,
    competitionStatus: "idle",
    competitionError: "",
    competitionRequestId: null,
  };
}

/**
 * 纯函数：筛选、排序、页码纠正与切片。
 * 纠正后的页码不在这里回写，由 reconcilePage 负责同步状态。
 */
export function teamListView(
  teams: Team[],
  filters: TeamFilters,
  now: number,
): TeamListView {
  const results = filterTeams(teams, filters, now);
  const pages = Math.max(1, Math.ceil(results.length / TEAM_PAGE_SIZE));
  const page = Math.min(filters.page, pages);
  return {
    results,
    pages,
    page,
    visible: results.slice((page - 1) * TEAM_PAGE_SIZE, page * TEAM_PAGE_SIZE),
  };
}

export function createTeamListController(
  state: TeamListState,
  deps: TeamListDeps,
) {
  const clock = deps.now ?? (() => Date.now());
  const startTimer =
    deps.interval ??
    ((fn: () => void, ms: number) =>
      setInterval(fn, ms) as unknown as ReturnType<typeof setInterval>);
  const stopTimer =
    deps.clear ??
    ((handle: unknown) =>
      clearInterval(handle as ReturnType<typeof setInterval>));
  let timer: unknown = null;
  let generation = 0;
  let request: PendingRequest<CompetitionDetail> | null = null;

  function view() {
    return teamListView(deps.teams(), state.filters, state.now);
  }

  /** 页码越界时回写状态，保证跳转携带的页码与当前可见页一致。 */
  function reconcilePage() {
    const { page } = view();
    if (state.filters.page !== page) state.filters.page = page;
  }

  function clearCompetition() {
    ++generation;
    request?.cancel();
    request = null;
    state.competition = null;
    state.competitionStatus = "idle";
    state.competitionError = "";
    state.competitionRequestId = null;
  }

  /** 只中断在途请求；已落定的 ready / missing / error 不被抹掉。 */
  function cancel() {
    ++generation;
    request?.cancel();
    request = null;
    if (state.competitionStatus !== "loading") return;
    state.competition = null;
    state.competitionStatus = "idle";
    state.competitionError = "";
    state.competitionRequestId = null;
  }

  async function loadCompetition() {
    const id = state.filters.competition;
    ++generation;
    request?.cancel();
    request = null;
    state.competition = null;
    state.competitionError = "";
    state.competitionRequestId = null;
    if (!id) {
      state.competitionStatus = "idle";
      return;
    }
    const current = generation;
    state.competitionStatus = "loading";
    try {
      request = deps.api.detail(id);
      const data = await request.promise;
      if (current !== generation) return;
      if (data.id !== id)
        throw new RequestError(
          "invalid-response",
          "比赛资料与请求不一致，请重试。",
        );
      state.competition = data;
      state.competitionStatus = "ready";
    } catch (error) {
      // 迟到的成功与失败都不回写，避免隐藏后覆盖新状态。
      if (current !== generation) return;
      if (error instanceof RequestError && error.statusCode === 404) {
        state.competitionStatus = "missing";
        state.competitionError =
          "关联比赛不存在或已隐藏，可清除比赛条件后继续浏览。";
        state.competitionRequestId = error.requestId;
        return;
      }
      state.competitionStatus = "error";
      state.competitionError =
        error instanceof RequestError
          ? `关联比赛加载失败：${requestErrorMessage(error)}`
          : "关联比赛加载失败，请检查网络后重试。";
      state.competitionRequestId =
        error instanceof RequestError ? error.requestId : null;
    } finally {
      if (current === generation) request = null;
    }
  }

  /** 归一筛选、纠正页码，并在比赛条件变化时重载或清空资料。 */
  function applyFilters(next: TeamFilters) {
    const previous = state.filters.competition;
    state.filters = parseTeamFilters(writeTeamFilters({}, next));
    reconcilePage();
    if (state.filters.competition === previous) return;
    if (state.filters.competition) void loadCompetition();
    else clearCompetition();
  }

  function tick() {
    state.now = clock();
  }

  return {
    view,
    reconcilePage,
    update(patch: Partial<TeamFilters>) {
      applyFilters({ ...state.filters, ...patch, page: 1 });
    },
    page(page: number) {
      applyFilters({
        ...state.filters,
        page: Number.isSafeInteger(page) && page > 0 ? page : 1,
      });
    },
    restore(query: RouteQuery) {
      applyFilters(parseTeamFilters(query));
    },
    reset() {
      applyFilters(parseTeamFilters({}));
    },
    loadCompetition,
    cancel,
    startClock() {
      if (timer !== null) return;
      timer = startTimer(tick, 1000);
    },
    stopClock() {
      if (timer === null) return;
      stopTimer(timer);
      timer = null;
    },
    syncClock: tick,
  };
}
