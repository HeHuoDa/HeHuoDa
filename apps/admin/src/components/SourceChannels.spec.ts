import { expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import ElementPlus from "element-plus";
import SourceChannels from "./SourceChannels.vue";
import { createOperationsService, operationsKey } from "../operations";
import { defaultSettings } from "../console/ingestion-control";
import { ConsoleError } from "../console/resource";

it("配置409时保留可见输入并锁定写入，不把提交错误当作读取失败", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      {
        id: "registered",
        publisher: "登记来源",
        collegeId: "college",
        enabled: true,
        channels: [{ id: "one", adapterId: "vsb-selectors", version: "1" }],
        channelStates: [
          {
            id: "one",
            settings: defaultSettings,
            enabled: true,
            baseline: "baseline",
            verificationStatus: "verified",
            pendingCount: 0,
          },
        ],
      },
    ])
    .mockRejectedValueOnce(new ConsoleError(409, "changed"));
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/source", component: SourceChannels }],
  });
  await router.push("/source");
  const wrapper = mount(
    { template: "<RouterView />" },
    {
      global: {
        plugins: [router, ElementPlus],
        provide: {
          [operationsKey as symbol]: createOperationsService({ request }),
        },
      },
      attachTo: document.body,
    },
  );
  await flushPromises();
  const input = () =>
    wrapper
      .findAll("label")
      .find((l) => l.text() === "请求预算")!
      .get<HTMLInputElement>("input");
  await input().setValue(20);
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "确认保存栏目配置")!
    .trigger("click");
  await flushPromises();
  await wrapper.get("#action-reason").setValue("并发基线核对");
  await wrapper.get("form.editor-form").trigger("submit");
  await flushPromises();
  expect(wrapper.text()).toContain("栏目基线已过期");
  expect(input().element.value).toBe("20");
  expect(wrapper.findAll("fieldset")[1]!.attributes("disabled")).toBeDefined();
  wrapper.unmount();
  document.body.innerHTML = "";
});

it("栏目刷新失败后不能通过切换栏目解锁旧快照", async () => {
  const channel = (id: string) => ({
    id,
    settings: defaultSettings,
    enabled: true,
    baseline: id,
    verificationStatus: "verified",
    verifiedAt: null,
    lastSuccessfulCheck: null,
    pendingCount: 0,
    backoffUntil: null,
  });
  const request = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      {
        id: "registered",
        publisher: "登记来源",
        collegeId: "college",
        enabled: true,
        channels: [
          { id: "one", adapterId: "vsb-selectors", version: "1" },
          { id: "two", adapterId: "vsb-selectors", version: "1" },
        ],
        channelStates: [channel("one"), channel("two")],
      },
    ]);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/source", component: SourceChannels }],
  });
  await router.push("/source");
  const wrapper = mount(
    { template: "<RouterView />" },
    {
      global: {
        plugins: [router, ElementPlus],
        provide: {
          [operationsKey as symbol]: createOperationsService({ request }),
        },
      },
    },
  );
  await flushPromises();
  expect(
    wrapper.get('select[aria-label="运营栏目"]').attributes("disabled"),
  ).toBeUndefined();
  request.mockRejectedValueOnce(new Error("offline"));
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "重新查询栏目")!
    .trigger("click");
  await flushPromises();
  expect(wrapper.find('select[aria-label="运营栏目"]').exists()).toBe(false);
  expect(wrapper.get('[role="alert"]').text()).toContain("请求失败");
  wrapper.unmount();
});
it("没有注册来源时仍展示学院目录，而不是把目录当成可执行来源", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce([
      {
        collegeId: "pending",
        collegeName: "待核验学院",
        checkedAt: "2026-10-28",
        reason: "尚未完成核验",
      },
    ])
    .mockResolvedValueOnce([]);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/source", component: SourceChannels }],
  });
  await router.push("/source");
  const wrapper = mount(
    { template: "<RouterView />" },
    {
      global: {
        plugins: [router, ElementPlus],
        provide: {
          [operationsKey as symbol]: createOperationsService({ request }),
        },
      },
    },
  );
  await flushPromises();
  expect(wrapper.text()).toContain("目录 1 院");
  expect(wrapper.text()).toContain("待核验学院");
  expect(wrapper.findAll("option")).toHaveLength(0);
  wrapper.unmount();
});
