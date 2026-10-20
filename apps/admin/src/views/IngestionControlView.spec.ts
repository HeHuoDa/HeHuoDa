import { expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import ElementPlus from "element-plus";
import IngestionControlView from "./IngestionControlView.vue";
import {
  exampleControl,
  ingestionControlKey,
} from "../console/ingestion-control";
import { ConsoleError } from "../console/resource";
it("配置409保留未保存数值并锁定；示例续跑只提交原运行ID，不修改范围", async () => {
  let resumeId = "";
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/ingestion/sources", component: IngestionControlView },
      { path: "/ingestion/runs/:id", component: IngestionControlView },
    ],
  });
  await router.push("/ingestion/sources?preview=1");
  const wrapper = mount(
    { template: "<RouterView />" },
    {
      global: {
        plugins: [router, ElementPlus],
        provide: {
          [ingestionControlKey as symbol]: {
            ...exampleControl,
            configure: async () => {
              throw new ConsoleError(409, "stale");
            },
            resume: async (id: string) => {
              resumeId = id;
              return {
                state: "accepted",
                requestId: "req-resume",
                message: "已受理",
              };
            },
          },
        },
      },
      attachTo: document.body,
    },
  );
  await flushPromises();
  await wrapper.get('input[aria-label="请求预算"]').setValue(20);
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "确认保存配置")!
    .trigger("click");
  await flushPromises();
  const submit = async () => {
    const input =
      document.querySelector<HTMLTextAreaElement>("#action-reason")!;
    input.value = "人工确认";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document
      .querySelector<HTMLFormElement>("form.editor-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushPromises();
  };
  await submit();
  expect(wrapper.text()).toContain("本轮确认已锁定");
  expect(
    wrapper.get<HTMLInputElement>('input[aria-label="请求预算"]').element.value,
  ).toBe("20");
  wrapper.unmount();
  document.body.innerHTML = "";
  await router.push("/ingestion/runs/example-run-1?preview=1");
  const next = mount(IngestionControlView, {
    global: {
      plugins: [router, ElementPlus],
      provide: {
        [ingestionControlKey as symbol]: {
          ...exampleControl,
          resume: async (id: string) => {
            resumeId = id;
            return {
              state: "accepted",
              requestId: "req-resume",
              message: "已受理",
            };
          },
        },
      },
    },
    attachTo: document.body,
  });
  await flushPromises();
  await next
    .findAll("button")
    .find((b) => b.text() === "确认续跑原范围")!
    .trigger("click");
  await flushPromises();
  await submit();
  expect(resumeId).toBe("example-run-1");
  expect(next.find('input[type="date"]').exists()).toBe(false);
  next.unmount();
  document.body.innerHTML = "";
});
it("手动扫描受理只显示已受理，不显示扫描完成且不重复执行", async () => {
  let calls = 0;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/ingestion/sources", component: IngestionControlView }],
  });
  await router.push("/ingestion/sources?preview=1");
  const wrapper = mount(IngestionControlView, {
    global: {
      plugins: [router, ElementPlus],
      provide: {
        [ingestionControlKey as symbol]: {
          ...exampleControl,
          scan: async () => {
            calls++;
            return {
              state: "accepted",
              requestId: "req-1",
              message: "排队受理",
            };
          },
        },
      },
    },
    attachTo: document.body,
  });
  await flushPromises();
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "确认扫描请求")!
    .trigger("click");
  await flushPromises();
  const input = document.querySelector<HTMLTextAreaElement>("#action-reason")!;
  input.value = "人工核对扫描范围";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  document
    .querySelector<HTMLFormElement>("form.editor-form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flushPromises();
  expect(wrapper.text()).toContain("仅已受理，尚未确认扫描完成");
  expect(calls).toBe(1);
  wrapper.unmount();
  document.body.innerHTML = "";
});
