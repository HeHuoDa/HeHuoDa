import { expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import ElementPlus from "element-plus";
import AttachmentPanel from "./AttachmentPanel.vue";
import { createOperationsService, operationsKey } from "../operations";
import { ConsoleError } from "../console/resource";

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
    attachmentText: vi
      .fn()
      .mockResolvedValue({
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
