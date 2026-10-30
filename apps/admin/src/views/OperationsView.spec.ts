import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import OperationsView from "./OperationsView.vue";
import { adminHttp } from "../runtime";
afterEach(() => vi.restoreAllMocks());
it("审计失败不展示样例，重试成功后展示服务端记录与详情", async () => {
  const request = vi
    .spyOn(adminHttp, "request")
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce({
      total: 1,
      items: [
        {
          operationId: "audit",
          createdAt: "2026-10-30",
          action: "candidate.review",
          objectId: "candidate",
          reason: "真实核对",
          result: "success",
        },
      ],
    })
    .mockResolvedValueOnce({
      operationId: "audit",
      commandOperationId: "command",
      reason: "真实核对",
    });
  const wrapper = mount(OperationsView, { global: { plugins: [ElementPlus] } });
  await flushPromises();
  expect(wrapper.text()).toContain("请求失败");
  expect(wrapper.text()).not.toContain("示例比赛");
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "刷新记录")!
    .trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain("真实核对");
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "查看")!
    .trigger("click");
  await flushPromises();
  expect(request).toHaveBeenLastCalledWith("/operations/audit");
  expect(wrapper.text()).toContain("command");
  wrapper.unmount();
});
