import type { InjectionKey } from "vue";
import { ServiceUnavailable } from "../services";
import {
  ConsoleError,
  queryPage,
  type PageQuery,
  type PageResult,
} from "./resource";

export type GovernanceKind = "users" | "recruitments" | "reports";
export interface GovernanceRecord {
  id: string;
  title: string;
  status: string;
  date: string;
  version: number;
  baseline: string;
  accountStatus?: "active" | "deactivated";
  restricted?: boolean;
  businessStatus?: "recruiting" | "paused" | "closed";
  hidden?: boolean;
  targetId?: string;
  conclusion?: string;
  description: string;
}
export interface ChangeRequest {
  id: string;
  action: string;
  reason: string;
  version: number;
  baseline: string;
  operationId: string;
  conclusion?: string;
}
export interface GovernanceService {
  list(
    kind: GovernanceKind,
    query: PageQuery,
  ): Promise<PageResult<GovernanceRecord>>;
  detail(kind: GovernanceKind, id: string): Promise<GovernanceRecord>;
  change(kind: GovernanceKind, request: ChangeRequest): Promise<void>;
}
export const governanceKey: InjectionKey<GovernanceService> =
  Symbol("governance");
export const governanceLabels = {
  users: {
    title: "用户查询",
    states: { normal: "未限制", restricted: "已限制" },
  },
  recruitments: {
    title: "招募治理",
    states: { visible: "未隐藏", hidden: "后台隐藏" },
  },
  reports: {
    title: "举报处理",
    states: { pending: "待处理", resolved: "已处理" },
  },
};
export const unavailableGovernance: GovernanceService = {
  async list() {
    throw new ServiceUnavailable(
      "管理查询服务未开放。可切换查看独立页面示例。",
    );
  },
  async detail() {
    throw new ServiceUnavailable("管理详情服务未开放，无法读取真实业务记录。");
  },
  async change() {
    throw new ServiceUnavailable("服务未开放，未执行；记录状态未改变。");
  },
};
// 独立管理页面固定样例；没有学生端状态、私人联系方式或认证秘密。
export const governanceExamples: Record<GovernanceKind, GovernanceRecord[]> = {
  users: Array.from({ length: 13 }, (_, i) => ({
    id: `example-user-${i + 1}`,
    title: `示例用户 ${i + 1}`,
    status: i % 3 === 0 ? "restricted" : "normal",
    date: "2026-10-19",
    version: 1,
    baseline: `user-baseline-${i + 1}`,
    accountStatus: i === 2 ? "deactivated" : "active",
    restricted: i % 3 === 0,
    description:
      "独立管理页面样例，仅展示公开昵称与账号/限制状态；不含个人联系方式。",
  })),
  recruitments: Array.from({ length: 13 }, (_, i) => ({
    id: `example-recruitment-${i + 1}`,
    title:
      i === 0
        ? "跨学院智慧农业项目招募——面向算法、产品与硬件方向的长期协作伙伴（独立示例）"
        : `示例项目招募 ${i + 1}`,
    status: i % 2 ? "visible" : "hidden",
    date: "2026-10-19",
    version: 3,
    baseline: `recruitment-baseline-${i + 1}`,
    businessStatus: i === 1 ? "closed" : "recruiting",
    hidden: i % 2 === 0,
    description:
      "招募业务状态和后台隐藏标记独立。恢复展示不会自动改变招募状态，也不会改变队伍成员。",
  })),
  reports: Array.from({ length: 13 }, (_, i) => ({
    id: `example-report-${i + 1}`,
    title: `示例举报 ${i + 1}：招募内容需要核查`,
    status: i % 3 ? "pending" : "resolved",
    date: "2026-10-19",
    version: 2,
    baseline: `report-baseline-${i + 1}`,
    targetId: `example-recruitment-${i + 1}`,
    conclusion: i % 3 ? "尚无结论" : "资料不足（示例既有结论）",
    description:
      "举报理由示例：招募介绍与实际项目范围可能不一致，请核查。处理结论不自动隐藏招募或限制账号。",
  })),
};
export const exampleGovernance: GovernanceService = {
  async list(kind, query) {
    return queryPage(governanceExamples[kind], query);
  },
  async detail(kind, id) {
    const item = governanceExamples[kind].find((row) => row.id === id);
    if (!item) throw new ConsoleError(404, "not found");
    return structuredClone(item);
  },
  change: unavailableGovernance.change,
};
