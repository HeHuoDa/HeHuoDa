import { afterEach, describe, expect, it } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import ElementPlus from "element-plus";
import ReasonDialog from "./ReasonDialog.vue";
import { ServiceUnavailable } from "../services";
afterEach(() => {
  document.body.innerHTML = "";
});
describe("管理操作确认公开交互", () => {
  it("空理由不提交，服务未开放不显示成功，提交中禁用重复点击", async () => {
    let reject!: (error: Error) => void;
    let calls = 0;
    const wrapper = mount(ReasonDialog, {
      props: {
        modelValue: true,
        title: "限制账号",
        execute: () => {
          calls++;
          return new Promise<void>((_r, j) => {
            reject = j;
          });
        },
      },
      global: { plugins: [ElementPlus] },
      attachTo: document.body,
    });
    await flushPromises();
    await wrapper.find("form").trigger("submit");
    expect(wrapper.text()).toContain("请填写理由");
    expect(calls).toBe(0);
    await wrapper.get("textarea").setValue(" 核查理由 ");
    await wrapper.find("form").trigger("submit");
    await wrapper.find("form").trigger("submit");
    expect(calls).toBe(1);
    reject(new ServiceUnavailable("服务未开放，未执行"));
    await flushPromises();
    expect(wrapper.text()).toContain("服务未开放，未执行");
    expect(wrapper.text()).not.toContain("操作成功");
    wrapper.unmount();
  });
});
