import type { HealthResponse } from "@hehuoda/api-types";
import { RequestError, type PendingRequest } from "../api/http.ts";

export interface HealthState {
  state: "idle" | "loading" | "online" | "offline";
  requestId: string | null;
  errorMessage: string | null;
}

export function initialHealthState(): HealthState {
  return { state: "idle", requestId: null, errorMessage: null };
}

/** 接收响应式状态或普通对象，页面与平台替身共享同一竞态控制。 */
export function createHealthController(
  state: HealthState,
  getHealth: () => PendingRequest<HealthResponse>,
) {
  let generation = 0;
  let pending: PendingRequest<HealthResponse> | null = null;
  return {
    async refresh(): Promise<void> {
      if (state.state === "loading") return;
      const current = ++generation;
      state.state = "loading";
      state.requestId = null;
      state.errorMessage = null;
      try {
        pending = getHealth();
        const response = await pending.promise;
        if (current !== generation) return;
        state.requestId = response.requestId;
        state.state = "online";
      } catch (error) {
        if (current !== generation) return;
        if (error instanceof RequestError && error.kind === "cancelled") {
          state.state = "idle";
          return;
        }
        state.requestId =
          error instanceof RequestError ? error.requestId : null;
        state.errorMessage =
          error instanceof RequestError
            ? error.message
            : "暂时无法连接服务，请稍后重试。";
        state.state = "offline";
      } finally {
        if (current === generation) pending = null;
      }
    },
    cancel() {
      ++generation;
      const previous = pending;
      pending = null;
      state.state = "idle";
      state.requestId = null;
      state.errorMessage = null;
      previous?.cancel();
    },
  };
}
