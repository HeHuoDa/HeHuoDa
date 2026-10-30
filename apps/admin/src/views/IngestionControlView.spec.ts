import { expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import ElementPlus from "element-plus";
import IngestionControlView from "./IngestionControlView.vue";
import {
  ingestionControlKey,
  IngestionControlError,
} from "../console/ingestion-control";
import { ConsoleError } from "../console/resource";
import { exampleControl } from "../console/ingestion-control-examples";
it("无运行的中断请求可恢复原受理范围，终态恢复不继续自动轮询", async () => {
  vi.useFakeTimers();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/ingestion/sources", component: IngestionControlView }],
  });
  const requestId = "32b908b0-4ff0-487e-b58c-49454a832a93";
  await router.push("/ingestion/sources?request=" + requestId);
  const request = vi.fn().mockResolvedValue({
    requestId,
    state: "interrupted",
    message: "进程中断",
  });
  const retry = vi.fn().mockResolvedValue({
    requestId: "retry-request",
    state: "accepted",
    message: "已受理原参数",
  });
  const wrapper = mount(IngestionControlView, {
    global: {
      plugins: [router, ElementPlus],
      provide: {
        [ingestionControlKey as symbol]: { ...exampleControl, request, retry },
      },
    },
    attachTo: document.body,
  });
  try {
    await flushPromises();
    await vi.advanceTimersByTimeAsync(2000);
    await flushPromises();
    expect(request).toHaveBeenCalledTimes(1);
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "恢复原受理范围")!
      .trigger("click");
    await flushPromises();
    await wrapper.get("#action-reason").setValue("恢复原受理日期与URL");
    await wrapper.get("form.editor-form").trigger("submit");
    await flushPromises();
    expect(retry).toHaveBeenCalledWith(requestId, {
      reason: "恢复原受理日期与URL",
      operationId: expect.any(String),
    });
  } finally {
    wrapper.unmount();
    vi.useRealTimers();
    document.body.innerHTML = "";
  }
});
it.each([
  ["disabled", "来源已停用"],
  ["running", "执行中"],
  ["locked", "锁占用"],
  ["failed", "执行失败"],
] as const)("续跑服务拒绝 %s 显示对应原因", async (code, label) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/ingestion/runs/:id", component: IngestionControlView }],
  });
  await router.push("/ingestion/runs/example-run-1");
  const wrapper = mount(IngestionControlView, {
    global: {
      plugins: [router, ElementPlus],
      provide: {
        [ingestionControlKey as symbol]: {
          ...exampleControl,
          resume: async () => {
            throw new IngestionControlError(code);
          },
        },
      },
    },
    attachTo: document.body,
  });
  await flushPromises();
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "确认续跑原范围")!
    .trigger("click");
  await flushPromises();
  const input = document.querySelector<HTMLTextAreaElement>("#action-reason")!;
  input.value = "核对续跑";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  document
    .querySelector<HTMLFormElement>("form.editor-form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flushPromises();
  expect(wrapper.text()).toContain(label);
  wrapper.unmount();
  document.body.innerHTML = "";
});
it("配置409保留未保存数值并锁定；示例续跑只提交原运行ID，不修改范围", async () => {
  let resumeId = "";
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/ingestion/sources", component: IngestionControlView },
      { path: "/ingestion/runs/:id", component: IngestionControlView },
    ],
  });
  await router.push("/ingestion/sources");
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
  await router.push("/ingestion/runs/example-run-1");
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
  await router.push("/ingestion/sources");
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
          request: async () => ({
            state: "completed",
            requestId: "req-1",
            message: "预览未写入",
          }),
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
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "查询请求状态")!
    .trigger("click");
  await flushPromises();
  expect(
    wrapper
      .findAll("button")
      .some((b) => b.text() === "准备新操作（重置输入）"),
  ).toBe(true);
  wrapper.unmount();
  document.body.innerHTML = "";
});
