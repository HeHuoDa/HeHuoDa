import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import {
  adminServicesKey,
  unavailableServices,
  type OverviewSummary,
} from "../services";
import OverviewStatus from "./OverviewStatus.vue";

describe("工作台服务状态", () => {
  it("等待摘要时显示加载，未知统计保持待接入而真实零值显示 0", async () => {
    let resolveSummary!: (value: OverviewSummary) => void;
    const wrapper = mount(OverviewStatus, {
      global: {
        plugins: [ElementPlus],
        provide: {
          [adminServicesKey as symbol]: {
            ...unavailableServices,
            getOverview: () =>
              new Promise<OverviewSummary>((resolve) => {
                resolveSummary = resolve;
              }),
          },
        },
      },
    });
    expect(wrapper.text()).toContain("正在加载工作台");
    resolveSummary({ pending: 0, drafts: null, published: 0, sources: null });
    await flushPromises();
    expect(wrapper.text()).toContain("暂无待审核通知");
    expect(wrapper.text()).toContain("待完善草稿待接入");
    expect(wrapper.text()).toContain("已发布比赛0");
    wrapper.unmount();
  });
  it("服务未开放与请求失败分别提示，失败后可以重试", async () => {
    const unavailable = mount(OverviewStatus, {
      global: { plugins: [ElementPlus] },
    });
    await flushPromises();
    expect(unavailable.text()).toContain("工作台服务未开放");
    expect(unavailable.text()).toContain("待接入");
    unavailable.unmount();
    let attempts = 0;
    const wrapper = mount(OverviewStatus, {
      global: {
        plugins: [ElementPlus],
        provide: {
          [adminServicesKey as symbol]: {
            ...unavailableServices,
            getOverview: async () => {
              if (++attempts === 1) throw new Error("network");
              return { pending: 0, drafts: 0, published: 0, sources: 0 };
            },
          },
        },
      },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("工作台加载失败");
    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("暂无待审核通知");
    expect(wrapper.text()).not.toContain("加载失败");
    wrapper.unmount();
  });
});
