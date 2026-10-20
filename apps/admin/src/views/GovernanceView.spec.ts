import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import ElementPlus from "element-plus";
import GovernanceView from "./GovernanceView.vue";
import { exampleGovernance, governanceKey } from "../console/governance";
import { ConsoleError } from "../console/resource";
afterEach(() => {
  document.body.innerHTML = "";
});
describe("治理详情交互", () => {
  for (const status of [403, 409])
    it(`${status} 不改隐藏状态且理由输入保留`, async () => {
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [
          {
            path: "/recruitments/:id",
            component: GovernanceView,
            meta: { governance: "recruitments" },
          },
        ],
      });
      await router.push("/recruitments/example-recruitment-1?preview=1");
      await router.isReady();
      const wrapper = mount(GovernanceView, {
        global: {
          plugins: [ElementPlus, router],
          provide: {
            [governanceKey as symbol]: {
              ...exampleGovernance,
              change: async () => {
                throw new ConsoleError(status, "test");
              },
            },
          },
        },
        attachTo: document.body,
      });
      await flushPromises();
      expect(wrapper.text()).toContain("招募中");
      expect(wrapper.text()).toContain("后台隐藏（示例既有状态）");
      await wrapper
        .findAll("button")
        .find((b) => b.text().includes("恢复招募展示"))!
        .trigger("click");
      await flushPromises();
      await wrapper.get("textarea").setValue("核对后恢复可见");
      await wrapper.get("form").trigger("submit");
      await flushPromises();
      expect(wrapper.text()).toContain(
        status === 403 ? "权限不足" : "重新加载并重新审核",
      );
      expect(
        (wrapper.get("textarea").element as HTMLTextAreaElement).value,
      ).toBe("核对后恢复可见");
      expect(wrapper.text()).toContain("后台隐藏（示例既有状态）");
      wrapper.unmount();
    });
});
