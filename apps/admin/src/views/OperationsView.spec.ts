import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import OperationsView from "./OperationsView.vue";
describe("操作记录预览", () => {
  it("服务未开放不伪造审计，显式打开示例后可分页并筛选", async () => {
    const wrapper = mount(OperationsView, {
      global: { plugins: [ElementPlus] },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("操作记录服务未开放");
    expect(wrapper.find("table").exists()).toBe(false);
    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("12 条示例记录");
    expect(wrapper.text()).toContain("示例比赛 01");
    expect(wrapper.text()).not.toContain("示例比赛 09");
    await wrapper.get(".btn-next").trigger("click");
    expect(wrapper.text()).toContain("示例比赛 09");
    await wrapper
      .get('input[placeholder="搜索操作对象或理由"]')
      .setValue("示例比赛 01");
    expect(wrapper.text()).toContain("1 条示例记录");
    expect(wrapper.text()).toContain("示例比赛 01");
    await wrapper
      .get('input[placeholder="搜索操作对象或理由"]')
      .setValue("不存在的记录");
    expect(wrapper.text()).toContain("没有匹配的操作记录");
    wrapper.unmount();
  });
});
