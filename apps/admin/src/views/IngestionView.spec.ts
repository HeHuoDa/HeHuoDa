import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import ElementPlus from "element-plus";
import IngestionView from "./IngestionView.vue";
import {
  reviewKey,
  type ReviewService,
  type ReviewRecord,
} from "../console/review";
import { ConsoleError } from "../console/resource";
import { exampleReview } from "../console/review-examples";
import { publicCatalogKey } from "../console/public-catalog";
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
const publicStub = {
  colleges: async () => [],
  list: async () => ({ items: [], totalPages: 0, hasMore: false }),
  detail: async () => {
    throw new Error("unavailable");
  },
};
async function setup(
  id = "example-candidate-2",
  service: ReviewService = exampleReview,
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/ingestion/candidates/:id",
        component: IngestionView,
        meta: { ingestion: "candidates" },
      },
      { path: "/elsewhere", component: { template: "<div>已离开</div>" } },
      {
        path: "/ingestion/candidates",
        component: { template: "<div>列表</div>" },
      },
    ],
  });
  await router.push(`/ingestion/candidates/${id}?preview=1`);
  await router.isReady();
  const wrapper = mount(
    { template: "<RouterView />" },
    {
      global: {
        plugins: [ElementPlus, router],
        provide: {
          [reviewKey as symbol]: service,
          [publicCatalogKey as symbol]: publicStub,
        },
      },
      attachTo: document.body,
    },
  );
  await flushPromises();
  return { wrapper, router };
}
describe("候选审核公开交互", () => {
  it("旧版本材料迟到不覆盖新版本视图", async () => {
    let resolveOld!: (value: ReviewRecord) => void;
    const { wrapper, router } = await setup("example-candidate-2", {
      ...exampleReview,
      detail: (kind, id, version) =>
        version
          ? exampleReview.detail(kind, id, version)
          : new Promise((resolve) => {
              resolveOld = resolve;
            }),
    });
    expect(wrapper.text()).toContain("正在加载核对材料");
    await router.push(
      "/ingestion/candidates/example-candidate-2?preview=1&version=example-v1",
    );
    await flushPromises();
    resolveOld(await exampleReview.detail("candidates", "example-candidate-2"));
    await flushPromises();
    expect(wrapper.text()).toContain("历史版本只读");
    expect(wrapper.get("#review-name").element.matches(":disabled")).toBe(true);
    wrapper.unmount();
  });
  for (const status of [403, 409])
    it(`审核${status}错误不改候选状态`, async () => {
      let calls = 0;
      const { wrapper } = await setup("example-candidate-2", {
        ...exampleReview,
        change: async () => {
          calls++;
          throw new ConsoleError(status, "test");
        },
      });
      await wrapper
        .findAll("button")
        .find((b) => b.text() === "批准候选 · 确认预览")!
        .trigger("click");
      await flushPromises();
      await wrapper.get("#action-reason").setValue("核查理由");
      await wrapper.get("form.editor-form").trigger("submit");
      await flushPromises();
      expect(wrapper.text()).toContain(
        status === 403 ? "权限不足" : "重新加载并重新审核",
      );
      expect(wrapper.text()).toContain("已批准，未导入");
      if (status === 409) {
        expect(
          wrapper
            .find('form.editor-form button[type="submit"]')
            .attributes("disabled"),
        ).toBeDefined();
        await wrapper.get("form.editor-form").trigger("submit");
        await flushPromises();
        expect(calls).toBe(1);
      }
      wrapper.unmount();
    });
  it("真实已有目标局部补丁可编辑，未修改预览保持原始审核文件形状", async () => {
    const material = (
      await exampleReview.detail("candidates", "example-candidate-2")
    ).material;
    material.batch.competitions = [
      {
        id: material.targetId,
        notices: material.batch.competitions[0]!.notices,
      },
    ];
    let received: unknown;
    const { wrapper } = await setup("example-candidate-2", {
      ...exampleReview,
      detail: async () => ({
        ...(await exampleReview.detail("candidates", "example-candidate-2")),
        material,
      }),
      preview: async (input) => {
        received = input;
        return { contentKey: JSON.stringify(input), token: "test-only-token" };
      },
    });
    expect(
      (wrapper.get("#review-name").element as HTMLInputElement).value,
    ).toBe(material.formalBefore!.name);
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "生成导入预览")!
      .trigger("click");
    await flushPromises();
    expect(received).toEqual(material);
    wrapper.unmount();
  });
  it("已批准仍未导入，纯文本原文不执行HTML；布局预览未授权不能执行写入", async () => {
    const { wrapper } = await setup();
    expect(wrapper.text()).toContain("已批准，未导入");
    expect(wrapper.find(".plain-document script").exists()).toBe(false);
    expect(wrapper.text()).toContain("<script>");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "生成导入预览")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("尚未完成服务端基线核验");
    await wrapper.get(".preview-ack input").setValue(true);
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "打开导入确认")!
      .trigger("click");
    await flushPromises();
    await wrapper.get("#action-reason").setValue("已审阅同一内容");
    await wrapper.get("form.editor-form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("布局预览不具备服务端授权");
    expect(wrapper.text()).toContain("已批准，未导入");
    wrapper.unmount();
  });
  it("改动预览内容立即失效，并阻止直接离开直到明确丢弃", async () => {
    const { wrapper, router } = await setup();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "生成导入预览")!
      .trigger("click");
    await flushPromises();
    await wrapper.get("#review-name").setValue("人工改过的名称");
    expect(wrapper.text()).toContain("原预览失效");
    const nav = router.push("/elsewhere");
    await flushPromises();
    expect(document.body.textContent).toContain("尚有未保存修正");
    const cancel = [
      ...document.querySelectorAll<HTMLButtonElement>(".el-message-box button"),
    ].find((b) => b.textContent?.includes("继续编辑"));
    cancel!.click();
    await nav;
    expect(router.currentRoute.value.path).toContain("/ingestion/");
    wrapper.unmount();
  });
  it("缺人工日期阻止批准并定位错误字段，已导入候选不能拒绝", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const { wrapper } = await setup("example-candidate-1");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "批准候选 · 确认预览")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("真实有效的人工核对日期");
    expect(document.activeElement?.id).toBe("review-checkedAt");
    wrapper.unmount();
    const imported = await setup("example-candidate-3");
    const reject = imported.wrapper
      .findAll("button")
      .find((b) => b.text() === "拒绝候选 · 确认预览")!;
    expect(reject.attributes("disabled")).toBeDefined();
    expect(imported.wrapper.text()).toContain("已导入，发布另行确认");
    imported.wrapper.unmount();
  });
});
