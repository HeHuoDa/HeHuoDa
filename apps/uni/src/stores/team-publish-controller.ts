import type { CompetitionDetail, CompetitionList } from "@hehuoda/api-types";
import {
  parseFilters,
  type Filters,
} from "@hehuoda/client-domain/competition-discovery";
import {
  emptyDraft,
  validateDraft,
  type Team,
  type TeamDraft,
} from "@hehuoda/client-domain/team";
import { RequestError, type PendingRequest } from "../api/http.ts";

type Status = "idle" | "loading" | "ready" | "error";
export function initialTeamPublishState() {
  return {
    draft: emptyDraft(),
    errors: {} as Record<string, string>,
    submitting: false,
    publishedId: "",
    submitError: "",
    keyword: "",
    query: "",
    page: 1,
    hasMore: false,
    items: [] as CompetitionList["items"],
    searchStatus: "idle" as Status,
    searchError: "",
    selectedId: "",
    selectionStatus: "idle" as Status,
    selectionError: "",
  };
}
export type TeamPublishState = ReturnType<typeof initialTeamPublishState>;
interface Api {
  list(filters: Filters): PendingRequest<CompetitionList>;
  detail(id: string): PendingRequest<CompetitionDetail>;
}
/** 所选比赛只接受公开详情。请求代次同时保护取消不可靠的平台。 */
export function createTeamPublishController(
  state: TeamPublishState,
  session: { publish(draft: TeamDraft, now?: number): Team | undefined },
  api: Api,
  clock = Date.now,
) {
  let searchVersion = 0,
    selectionVersion = 0,
    submitVersion = 0;
  let searchRequest: PendingRequest<CompetitionList> | null = null;
  let detailRequest: PendingRequest<CompetitionDetail> | null = null;
  async function loadSearch(page: number) {
    const version = ++searchVersion;
    searchRequest?.cancel();
    state.searchStatus = "loading";
    state.searchError = "";
    if (page === 1) {
      state.items = [];
      state.hasMore = false;
    }
    try {
      searchRequest = api.list(
        parseFilters({ hosts: "all", q: state.query, page: String(page) }),
      );
      const result = await searchRequest.promise;
      if (version !== searchVersion) return;
      state.items =
        page === 1 ? result.items : [...state.items, ...result.items];
      state.page = result.page;
      state.hasMore = result.hasMore;
      state.searchStatus = "ready";
    } catch {
      if (version !== searchVersion) return;
      state.searchStatus = "error";
      state.searchError = "比赛查询失败，没有使用样例替代。请重试。";
    } finally {
      if (version === searchVersion) searchRequest = null;
    }
  }
  function search() {
    state.query = state.keyword.trim().slice(0, 100);
    return loadSearch(1);
  }
  function more() {
    if (state.searchStatus === "loading" || !state.hasMore) return;
    return loadSearch(state.page + 1);
  }
  function retrySearch() {
    return loadSearch(state.items.length ? state.page + 1 : 1);
  }
  async function select(id: string) {
    const version = ++selectionVersion;
    detailRequest?.cancel();
    detailRequest = null;
    state.selectedId = id;
    state.draft.competition = undefined;
    state.draft.trackId = "";
    state.selectionError = "";
    state.selectionStatus = "idle";
    if (!id) return;
    state.selectionStatus = "loading";
    try {
      detailRequest = api.detail(id);
      const detail = await detailRequest.promise;
      if (version !== selectionVersion) return;
      if (detail.id !== id) throw new Error("mismatched competition");
      state.draft.competition = detail;
      state.selectionStatus = "ready";
    } catch (error) {
      if (version !== selectionVersion) return;
      state.selectionStatus = "error";
      state.selectionError =
        error instanceof RequestError && error.statusCode === 404
          ? "比赛不存在或未公开，请重新选择或清除比赛。"
          : "比赛详情加载失败，请重试或清除比赛。";
    } finally {
      if (version === selectionVersion) detailRequest = null;
    }
  }
  async function submit() {
    if (state.submitting || state.publishedId) return;
    state.submitError = "";
    state.errors = validateDraft(state.draft, clock());
    // 普通项目未关联比赛时不等待搜索；有选择意图时不能发布一个丢失关联的队伍。
    if (
      state.selectedId &&
      (state.selectionStatus !== "ready" ||
        state.draft.competition?.id !== state.selectedId)
    )
      state.errors.competition =
        "请等待比赛详情加载成功，或清除比赛后发布普通项目。";
    if (Object.keys(state.errors).length) return;
    state.submitting = true;
    const version = ++submitVersion;
    try {
      // 一轮事件中的连点共用锁，动作之前允许页面卸载/重置取消。
      await Promise.resolve();
      if (version !== submitVersion) return;
      const team = session.publish(state.draft, clock());
      if (!team) {
        state.errors = validateDraft(state.draft, clock());
        return;
      }
      state.publishedId = team.id;
      return team;
    } catch {
      state.submitError = "演示发布失败，已保留填写内容，请重试。";
    } finally {
      if (version === submitVersion) state.submitting = false;
    }
  }
  function cancel() {
    ++searchVersion;
    ++selectionVersion;
    ++submitVersion;
    searchRequest?.cancel();
    detailRequest?.cancel();
    searchRequest = detailRequest = null;
    state.submitting = false;
    if (state.searchStatus === "loading") state.searchStatus = "idle";
    if (state.selectionStatus === "loading") state.selectionStatus = "idle";
  }
  function reset() {
    cancel();
    Object.assign(state, initialTeamPublishState());
  }
  return { search, more, retrySearch, select, submit, cancel, reset };
}
