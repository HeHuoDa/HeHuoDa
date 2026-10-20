import type { InjectionKey } from "vue";

// 前端视图契约；#46 接线时由已合并 OpenAPI 类型映射，不预设 HTTP 地址。
export interface OverviewSummary {
  pending: number | null;
  drafts: number | null;
  published: number | null;
  sources: number | null;
}
export class ServiceUnavailable extends Error {}
export interface AdminServices {
  login(account: string, password: string): Promise<void>;
  getOverview(): Promise<OverviewSummary>;
}
export const adminServicesKey: InjectionKey<AdminServices> =
  Symbol("admin-services");
export const unavailableServices: AdminServices = {
  async login() {
    throw new ServiceUnavailable(
      "管理员认证服务未开放。此页面不创建登录状态，请返回预览工作台。",
    );
  },
  async getOverview() {
    throw new ServiceUnavailable("工作台服务未开放，统计待接入。");
  },
};
