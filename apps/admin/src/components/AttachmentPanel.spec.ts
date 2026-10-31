import { expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import ElementPlus from "element-plus";
import AttachmentPanel from "./AttachmentPanel.vue";
import { createOperationsService, operationsKey } from "../operations";
import { ConsoleError } from "../console/resource";

it("恢复原受理被409明确拒绝后解除未知状态，允许重新加载而不锁死页面", async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/notice", component: AttachmentPanel }],
  });
  await router.push("/notice");
  let pending: string | null = "original-operation";
  const service = {
    ...createOperationsService({
      request: vi.fn().mockResolvedValue({
        noticeId: "n",
        evidenceRevision: 1,
        evidenceState: "current",
        items: [],
      }),
    }),
    pendingOperation: () => pending,
    recoverPending: async () => {
      pending = null;
      throw new ConsoleError(409, "baseline changed");
    },
  };
  const wrapper = mount(AttachmentPanel, {
    props: { noticeId: "n" },
    global: {
      plugins: [router, ElementPlus],
      provide: { [operationsKey as symbol]: service },
    },
  });
  await flushPromises();
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "按原操作标识查询受理")!
    .trigger("click");
  await flushPromises();
  expect(
    wrapper.findAll("button").some((b) => b.text() === "按原操作标识查询受理"),
  ).toBe(false);
  expect(
    wrapper
      .findAll("button")
      .find((b) => b.text() === "重新加载附件")!
      .attributes("disabled"),
  ).toBeUndefined();
  expect(wrapper.text()).toContain("版本或基线已过期");
  wrapper.unmount();
});

it("切换通知后查询失败时清除旧附件，不能对旧对象重新获取", async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/notice", component: AttachmentPanel }],
  });
  await router.push("/notice");
  const version = {
    versionId: "v",
    previousVersion: null,
    revision: 1,
    sha256: null,
    noticeVersion: "nv",
    fetchedAt: "2026-10-31",
    mediaType: "application/pdf",
    extractorVersion: "test",
    status: "extracted",
    errorCode: null,
  };
  const request = vi
    .fn()
    .mockResolvedValueOnce({
      noticeId: "old",
      evidenceRevision: 1,
      evidenceState: "current",
      items: [
        {
          attachmentId: "a",
          noticeId: "old",
          url: "https://example.edu/old.pdf",
          state: "extracted",
          latestVersion: "v",
        },
      ],
    })
    .mockResolvedValueOnce({
      items: [version],
      total: 1,
      page: 1,
      pageSize: 10,
    })
    .mockResolvedValueOnce({
      ...version,
      segments: [],
      totalSegments: 0,
      page: 1,
      pageSize: 10,
    });
  const wrapper = mount(AttachmentPanel, {
    props: { noticeId: "old" },
    global: {
      plugins: [router, ElementPlus],
      provide: {
        [operationsKey as symbol]: createOperationsService({ request }),
      },
    },
  });
  await flushPromises();
  expect(wrapper.text()).toContain("https://example.edu/old.pdf");
  request.mockRejectedValueOnce(new Error("offline"));
  await wrapper.setProps({ noticeId: "new" });
  await flushPromises();
  expect(wrapper.text()).not.toContain("https://example.edu/old.pdf");
  expect(
    wrapper.findAll("button").some((b) => b.text() === "重新获取附件"),
  ).toBe(false);
  wrapper.unmount();
});

it("附件按指定旧版本定位并安全显示文本，字节清理409要求先重新获取", async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/notice", component: AttachmentPanel }],
  });
  await router.push("/notice?attachment=a&attachmentVersion=old");
  const version = {
    versionId: "old",
    previousVersion: null,
    revision: 1,
    sha256: null,
    noticeVersion: "notice-v1",
    fetchedAt: "2026-10-31",
    mediaType: "application/pdf",
    extractorVersion: "extractor-1",
    status: "extracted",
    errorCode: null,
  };
  const reparse = vi
    .fn()
    .mockRejectedValue(new ConsoleError(409, "bytes removed"));
  const service = {
    ...createOperationsService({ request: vi.fn() }),
    attachments: async () => ({
      noticeId: "n",
      evidenceRevision: 3,
      evidenceState: "current",
      items: [
        {
          attachmentId: "a",
          noticeId: "n",
          url: "https://example.edu/a.pdf",
          state: "extracted",
          lastCheckedAt: null,
          latestVersion: "new",
          errorCode: null,
          evidenceRevision: 3,
          evidenceState: "current",
        },
      ],
    }),
    attachmentVersions: async () => ({
      items: [version],
      total: 1,
      page: 1,
      pageSize: 10,
    }),
    attachmentText: vi.fn().mockResolvedValue({
      ...version,
      segments: [
        {
          kind: "page",
          index: 1,
          text: "<script>evil()</script>",
          truncated: false,
        },
      ],
      totalSegments: 1,
      page: 1,
      pageSize: 10,
    }),
    reparse,
  };
  const wrapper = mount(AttachmentPanel, {
    props: { noticeId: "n" },
    global: {
      plugins: [router, ElementPlus],
      provide: { [operationsKey as symbol]: service },
    },
    attachTo: document.body,
  });
  await flushPromises();
  expect(service.attachmentText).toHaveBeenCalledWith("a", "old", 1);
  expect(wrapper.text()).toContain("<script>evil()</script>");
  expect(wrapper.find("script").exists()).toBe(false);
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "重新解析此版本")!
    .trigger("click");
  await flushPromises();
  await wrapper.get("#action-reason").setValue("核对旧版提取");
  await wrapper.get("form.editor-form").trigger("submit");
  await flushPromises();
  expect(wrapper.text()).toContain("先重新获取");
  expect(reparse).toHaveBeenCalledWith(
    "a",
    expect.objectContaining({ versionId: "old", baseline: 3 }),
  );
  wrapper.unmount();
  document.body.innerHTML = "";
});
