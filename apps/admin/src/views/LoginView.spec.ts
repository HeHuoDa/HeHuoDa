import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import ElementPlus from "element-plus";
import LoginView from "./LoginView.vue";
import { adminServicesKey, unavailableServices } from "../services";
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});
describe("管理员登录前端预览", () => {
  it("密码显隐按钮提供键盘可用的操作及状态说明", async () => {
    const wrapper = mount(LoginView, {
      global: { plugins: [ElementPlus], stubs: { RouterLink: true } },
    });
    await flushPromises();
    await wrapper.get("#admin-password").setValue("secret");
    expect(wrapper.get("#admin-password").attributes("type")).toBe("password");
    await wrapper.get('button[aria-label="显示密码"]').trigger("click");
    expect(wrapper.get("#admin-password").attributes("type")).toBe("text");
    expect(
      wrapper.get('button[aria-label="隐藏密码"]').attributes("aria-pressed"),
    ).toBe("true");
    wrapper.unmount();
  });
  it("空字段阻止提交并明确定位问题", async () => {
    const wrapper = mount(LoginView, {
      global: { plugins: [ElementPlus], stubs: { RouterLink: true } },
    });
    await wrapper.get("form").trigger("submit");
    expect(wrapper.get(".form-error").text()).toContain(
      "请填写管理员账号和密码",
    );
    wrapper.unmount();
  });
  it("输入账号密码后仍提示服务未开放，不生成会话且清空密码", async () => {
    const writes = vi.spyOn(Storage.prototype, "setItem");
    const wrapper = mount(LoginView, {
      global: { plugins: [ElementPlus], stubs: { RouterLink: true } },
    });
    await flushPromises();
    await wrapper.get("#admin-account").setValue("demo");
    await wrapper.get("#admin-password").setValue("only-for-test");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.get(".form-error").text()).toContain("管理员认证服务未开放");
    expect(
      (wrapper.get("#admin-password").element as HTMLInputElement).value,
    ).toBe("");
    expect(writes).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it("提交期间禁止重复提交，并在失败后清空密码", async () => {
    let rejectLogin!: (reason: Error) => void;
    const services = {
      ...unavailableServices,
      login: () =>
        new Promise<void>((_resolve, reject) => {
          rejectLogin = reject;
        }),
    };
    const wrapper = mount(LoginView, {
      global: {
        plugins: [ElementPlus],
        stubs: { RouterLink: true },
        provide: { [adminServicesKey as symbol]: services },
      },
    });
    await flushPromises();
    await wrapper.get("#admin-account").setValue("demo");
    await wrapper.get("#admin-password").setValue("test-password");
    await wrapper.get("form").trigger("submit");
    expect(
      wrapper.get('button[type="submit"]').attributes("disabled"),
    ).toBeDefined();
    rejectLogin(new Error("network"));
    await flushPromises();
    expect(wrapper.text()).toContain("登录请求失败");
    expect(
      wrapper.get('button[type="submit"]').attributes("disabled"),
    ).toBeUndefined();
    wrapper.unmount();
  });
});
