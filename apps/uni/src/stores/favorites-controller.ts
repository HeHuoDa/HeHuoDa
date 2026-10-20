import type { CompetitionDetail } from "@hehuoda/api-types";
import {
  RequestError,
  requestErrorMessage,
  type PendingRequest,
} from "../api/http.ts";
import type { FavoriteRecord } from "./session.ts";

export interface FavoriteRow extends FavoriteRecord {
  status: "idle" | "loading" | "ready" | "missing" | "error";
  detail: CompetitionDetail | null;
  error: string;
  requestId: string | null;
}
export interface FavoritesState {
  rows: FavoriteRow[];
}
export const initialFavoritesState = (): FavoritesState => ({ rows: [] });

/** 只读取收藏集合：详情失败、取消与迟到响应均不能写回收藏记录。 */
export function createFavoritesController(
  state: FavoritesState,
  records: () => readonly FavoriteRecord[],
  api: { detail(id: string): PendingRequest<CompetitionDetail> },
) {
  let visible = false;
  const pending = new Map<string, { row: FavoriteRow; cancel(): void }>();
  function cancel(id: string) {
    const task = pending.get(id);
    if (!task) return;
    pending.delete(id);
    task.row.status = "idle";
    task.cancel();
  }
  function pump() {
    if (!visible) return;
    for (const row of state.rows) {
      if (pending.size >= 3) break;
      if (row.status !== "idle" || pending.has(row.id)) continue;
      row.status = "loading";
      row.error = "";
      row.requestId = null;
      const task = { row, cancel: () => {} };
      pending.set(row.id, task);
      const current = () =>
        visible && pending.get(row.id) === task && state.rows.includes(row);
      void (async () => {
        try {
          const request = api.detail(row.id);
          task.cancel = () => request.cancel();
          const data = await request.promise;
          if (!current()) return;
          if (data.id !== row.id)
            throw new RequestError(
              "invalid-response",
              "比赛详情与请求不一致，请重试。",
            );
          row.detail = data;
          row.status = "ready";
        } catch (error) {
          if (!current()) return;
          row.status =
            error instanceof RequestError && error.statusCode === 404
              ? "missing"
              : "error";
          row.error = requestErrorMessage(
            error,
            "比赛加载失败，请检查网络后重试。",
          );
          row.requestId =
            error instanceof RequestError ? error.requestId : null;
        } finally {
          if (pending.get(row.id) === task) {
            pending.delete(row.id);
            pump();
          }
        }
      })();
    }
  }
  function sync() {
    const next = records();
    for (const [id, task] of pending) {
      if (
        !next.some(
          (record) => record.id === id && record.order === task.row.order,
        )
      )
        cancel(id);
    }
    state.rows = next.map(
      (record) =>
        state.rows.find(
          (row) => row.id === record.id && row.order === record.order,
        ) ?? {
          ...record,
          status: "idle",
          detail: null,
          error: "",
          requestId: null,
        },
    );
    pump();
  }
  function stop() {
    visible = false;
    for (const id of pending.keys()) cancel(id);
  }
  function start() {
    stop();
    state.rows = [];
    visible = true;
    sync();
  }
  function retry(id: string) {
    const row = state.rows.find((item) => item.id === id);
    if (!visible || !row || row.status === "loading") return;
    row.status = "idle";
    row.detail = null;
    pump();
  }
  return { start, stop, sync, retry };
}
