import { afterEach, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import ElementPlus from "element-plus";
import NoticeView from "./NoticeView.vue";
import { adminHttp } from "../runtime";
afterEach(() => vi.restoreAllMocks());
it("通知页的preview标记隔离真实查询，退出后才读取服务器", async () => {
  const request = vi
    .spyOn(adminHttp, "request")
    .mockResolvedValue({ items: [], total: 0 });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/ingestion/notices", component: NoticeView }],
  });
  await router.push("/ingestion/notices?preview=1");
  const wrapper = mount(
    { template: "<RouterView/>" },
    { global: { plugins: [router, ElementPlus] } },
  );
  await flushPromises();
  expect(request).not.toHaveBeenCalled();
  await router.push("/ingestion/notices");
  await flushPromises();
  expect(request).toHaveBeenCalledWith("/ingestion/notices?page=1&pageSize=20");
  wrapper.unmount();
});
