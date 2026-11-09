import { shallowReactive } from "vue";
import { ServiceUnavailable } from "../services";

export type LoadStatus = "idle" | "loading" | "ready" | "error";
export interface PageQuery {
  classification?: string;
  kind?: string;
  needsReview?: string;
  collegeId?: string;
  channelId?: string;
  attachmentStatus?: string;
  q: string;
  status: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
}
export interface PageResult<T> {
  items: T[];
  total: number;
}
export class ConsoleError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function errorMessage(error: unknown) {
  if (error instanceof ServiceUnavailable) return error.message;
  if (error instanceof ConsoleError && error.status === 409)
    return "版本或基线已过期，请重新加载并重新审核。";
  if (error instanceof ConsoleError && error.status === 403)
    return "权限不足，未执行操作，请联系有权限的管理员。";
  if (error instanceof ConsoleError && error.status === 404)
    return "记录不存在或当前不可访问，请返回列表重新查询。";
  // 400/422 是服务端确定性拒绝，没有执行写入，不能提示成「结果未知」。
  if (error instanceof ConsoleError && [400, 422].includes(error.status))
    return "提交内容未通过服务端校验，本次操作未执行；请按提示修正，不会重复写入。";
  if (error instanceof ConsoleError && error.status === 401)
    return "会话已失效，本次操作未执行；请重新登录后核对原记录。";
  return "请求失败，未确认执行结果，请重新加载核验；请勿重复提交。";
}
export function createResourceController<T, D = T>() {
  const state = shallowReactive({
    items: [] as T[],
    total: 0,
    detail: null as D | null,
    status: "idle" as LoadStatus,
    detailStatus: "idle" as LoadStatus,
    error: "",
    detailError: "",
  });
  let listEpoch = 0,
    detailEpoch = 0;
  function clear() {
    listEpoch++;
    detailEpoch++;
    Object.assign(state, {
      items: [],
      total: 0,
      detail: null,
      status: "idle",
      detailStatus: "idle",
      error: "",
      detailError: "",
    });
  }
  async function load(query: () => Promise<PageResult<T>>) {
    clear();
    const epoch = listEpoch;
    state.status = "loading";
    try {
      const result = await query();
      if (epoch === listEpoch)
        Object.assign(state, result, { status: "ready" });
    } catch (error) {
      if (epoch === listEpoch)
        Object.assign(state, { status: "error", error: errorMessage(error) });
    }
  }
  async function select(query: () => Promise<D>) {
    const epoch = ++detailEpoch;
    Object.assign(state, {
      detail: null,
      detailError: "",
      detailStatus: "loading",
    });
    try {
      const detail = await query();
      if (epoch === detailEpoch)
        Object.assign(state, { detail, detailStatus: "ready" });
    } catch (error) {
      if (epoch === detailEpoch)
        Object.assign(state, {
          detailStatus: "error",
          detailError: errorMessage(error),
        });
    }
  }
  return { state, load, select, clear };
}
export function queryPage<
  T extends { title: string; status: string; date: string },
>(items: T[], query: PageQuery): PageResult<T> {
  const filtered = items.filter(
    (item) =>
      (!query.q.trim() || item.title.includes(query.q.trim())) &&
      (!query.status || item.status === query.status) &&
      (!query.from || item.date >= query.from) &&
      (!query.to || item.date <= query.to),
  );
  return {
    items: structuredClone(
      filtered.slice(
        (query.page - 1) * query.pageSize,
        query.page * query.pageSize,
      ),
    ),
    total: filtered.length,
  };
}
