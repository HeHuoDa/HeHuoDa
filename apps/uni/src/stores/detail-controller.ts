import type { CompetitionDetail } from "@hehuoda/api-types";
import { RequestError, type PendingRequest } from "../api/http.ts";

export interface DetailState {
  status: "idle" | "loading" | "ready" | "missing" | "error";
  detail: CompetitionDetail | null;
  error: string;
  requestId: string | null;
}
export function initialDetailState(): DetailState {
  return { status: "idle", detail: null, error: "", requestId: null };
}

/** 页面独占请求；代次检查同时保护不支持可靠 abort 的平台及渲染后的异步定位。 */
export function createDetailController(
  state: DetailState,
  api: { detail(id: string): PendingRequest<CompetitionDetail> },
) {
  let generation = 0;
  let request: PendingRequest<CompetitionDetail> | null = null;
  function cancel() {
    ++generation;
    request?.cancel();
    request = null;
    if (state.status === "loading") state.status = "idle";
  }
  async function load(id: string) {
    cancel();
    const current = generation;
    state.detail = null;
    state.status = "loading";
    state.error = "";
    state.requestId = null;
    try {
      request = api.detail(id);
      const data = await request.promise;
      if (current !== generation) return;
      if (data.id !== id)
        throw new RequestError(
          "invalid-response",
          "比赛详情与请求不一致，请重试。",
        );
      state.detail = data;
      state.status = "ready";
    } catch (error) {
      if (current !== generation) return;
      state.status =
        error instanceof RequestError && error.statusCode === 404
          ? "missing"
          : "error";
      state.error =
        error instanceof RequestError
          ? error.message
          : "比赛详情加载失败，请检查网络后重试。";
      state.requestId = error instanceof RequestError ? error.requestId : null;
    } finally {
      if (current === generation) request = null;
    }
  }
  return { load, cancel };
}
