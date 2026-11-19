import { expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import ElementPlus from "element-plus";
import CompetitionsView from "./CompetitionsView.vue";
import { publicCatalogKey } from "../console/public-catalog";
import {
  competitionKey,
  competitionContentKey,
  exampleCompetitions,
  type CompetitionService,
  type ManagedCompetition,
  type CompetitionPreviewReceipt,
} from "../console/competitions";
import { ConsoleError } from "../console/resource";
import { defineComponent, h, type PropType } from "vue";

const ConfirmStub = defineComponent({
  name: "ReasonDialog",
  props: {
    modelValue: Boolean,
    title: { type: String, default: "" },
    blocked: Boolean,
    execute: {
      type: Function as PropType<(reason: string) => Promise<void>>,
      required: true,
    },
  },
  setup(props) {
    return () =>
      h("div", { class: "confirm-stub" }, [
        h(
          "button",
          {
            type: "button",
            disabled: props.blocked,
            onClick: () => void props.execute("核对后提交").catch(() => {}),
          },
          "确认" + (props.title ?? ""),
        ),
      ]);
  },
});

async function exampleDetail(id = "example-contest-2") {
  return (await exampleCompetitions.detail(id))!;
}

function service(input: {
  detail?: ManagedCompetition;
  preview?: CompetitionService["preview"];
  change?: CompetitionService["change"];
  baseline?: CompetitionService["baseline"];
  list?: CompetitionService["list"];
}): CompetitionService {
  return {
    async list(query) {
      return input.list ? input.list(query) : { items: [], total: 0 };
    },
    async detail() {
      return structuredClone(input.detail ?? (await exampleDetail()))!;
    },
    async baseline(id) {
      return input.baseline
        ? input.baseline(id)
        : {
            targetId: id,
            exists: false,
            baseline: "b".repeat(64),
            publication: null,
          };
    },
    preview:
      input.preview ??
      (async (request) => ({
        contentKey: competitionContentKey(
          request.content,
          request.baseline,
          request.action,
        ),
        token: "preview-1",
        changes: [],
        blocks: [],
      })),
    change:
      input.change ??
      (async () => ({
        targetId: "example-contest-2",
        action: "save" as const,
        publication: "draft",
        baseline: "c".repeat(64),
        changes: [],
        auditOperationId: "audit-1",
      })),
  };
}

async function setup(
  target: CompetitionService,
  path = "/competitions/example-contest-2/edit",
  options: { confirmDialog?: boolean } = {},
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/competitions", component: CompetitionsView },
      { path: "/competitions/:id/edit", component: CompetitionsView },
      { path: "/competitions/:id", component: CompetitionsView },
      { path: "/competitions/new", component: CompetitionsView },
    ],
  });
  await router.push(path);
  const wrapper = mount(
    { template: "<RouterView />" },
    {
      global: {
        plugins: [router, ElementPlus],
        // 默认真实弹窗需要 body 渲染；重试用例用最小替身直接调用 execute。
        ...(options.confirmDialog === false
          ? { stubs: { ReasonDialog: ConfirmStub } }
          : {}),
        provide: {
          [publicCatalogKey as symbol]: { colleges: async () => [] },
          [competitionKey as symbol]: target,
        },
      },
    },
  );
  await flushPromises();
  return { wrapper, router };
}

const button = (
  wrapper: Awaited<ReturnType<typeof setup>>["wrapper"],
  text: string,
) => wrapper.findAll("button").find((b) => b.text() === text)!;

it("409 冲突保留输入并锁定确认，预览进行中阻止切换对象", async () => {
  let reject!: (reason: Error) => void;
  const { wrapper, router } = await setup(
    service({
      preview: () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    }),
  );
  await button(wrapper, "生成变更预览").trigger("click");
  await flushPromises();
  expect(reject).toBeTypeOf("function");
  reject(new ConsoleError(409, "stale"));
  await flushPromises();
  expect(wrapper.text()).toContain("本轮基线已过期");
  expect(
    wrapper.get<HTMLInputElement>("#competition-name").element.value,
  ).toContain("示例");
  expect(button(wrapper, "生成变更预览").attributes("disabled")).toBeDefined();
  // 切换对象后旧请求的迟到失败不能污染新对象。
  await router.push("/competitions/example-contest-3/edit");
  await flushPromises();
  expect(wrapper.text()).not.toContain("本轮基线已过期");
  expect(
    button(wrapper, "生成变更预览").attributes("disabled"),
  ).toBeUndefined();
  wrapper.unmount();
});

it("迟到的旧预览响应被丢弃，不覆盖新对象的预览状态", async () => {
  const pending: ((value: CompetitionPreviewReceipt) => void)[] = [];
  const { wrapper, router } = await setup(
    service({
      preview: () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    }),
  );
  await button(wrapper, "生成变更预览").trigger("click");
  await flushPromises();
  // 旧对象的预览仍在等待时切换到另一个届次。
  await router.push("/competitions/example-contest-4/edit");
  await flushPromises();
  expect(wrapper.text()).not.toContain("服务预览已返回");
  pending.at(-1)!({
    contentKey: "stale-key",
    token: "stale-token",
    changes: [],
    blocks: [],
  });
  await flushPromises();
  expect(wrapper.text()).not.toContain("服务预览已返回");
  wrapper.unmount();
});

it("未保存的表单修改不会随发布或隐藏一起提交，先要求保存", async () => {
  const { wrapper } = await setup(service({}));
  const select = wrapper
    .findAll("select")
    .find((s) => s.text().includes("保存修改"))!;
  await select.setValue("publish");
  await wrapper.get("#competition-name").setValue("未保存的新名称");
  await button(wrapper, "生成变更预览").trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain("表单仍有未保存的修改");
  expect(wrapper.text()).not.toContain("服务预览已返回");
  wrapper.unmount();
});

it("发布底线缺口展示逐项阻断且不允许打开确认", async () => {
  const { wrapper } = await setup(
    service({
      preview: async (request) => ({
        contentKey: competitionContentKey(
          request.content,
          request.baseline,
          request.action,
        ),
        token: "preview-1",
        changes: [],
        blocks: [{ code: "TRACK_MISSING", message: "发布至少需要一条赛道" }],
      }),
    }),
  );
  await button(wrapper, "生成变更预览").trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain("发布底线仍有缺口");
  expect(wrapper.text()).toContain("TRACK_MISSING");
  await wrapper.get('.preview-ack input[type="checkbox"]').setValue(true);
  expect(button(wrapper, "打开操作确认").attributes("disabled")).toBeDefined();
  wrapper.unmount();
});

it("网络结果不明时重试复用原 operationId、载荷与预览回执", async () => {
  const change = vi
    .fn<CompetitionService["change"]>()
    .mockRejectedValueOnce(new TypeError("network"))
    .mockResolvedValueOnce({
      targetId: "example-contest-2",
      action: "save",
      publication: "draft",
      baseline: "c".repeat(64),
      changes: [],
      auditOperationId: "audit-1",
    });
  const { wrapper } = await setup(service({ change }), undefined, {
    confirmDialog: false,
  });
  await button(wrapper, "生成变更预览").trigger("click");
  await flushPromises();
  await wrapper.get('.preview-ack input[type="checkbox"]').setValue(true);
  // 已发布记录更新需要独立的显式确认后才能打开写命令。
  const ack = wrapper.findAll(".preview-ack input[type=checkbox]");
  await ack[1]!.setValue(true);
  await button(wrapper, "打开操作确认").trigger("click");
  await flushPromises();
  const submit = wrapper.get(".confirm-stub button");
  await submit.trigger("click");
  await flushPromises();
  expect(change).toHaveBeenCalledTimes(1);
  expect(wrapper.text()).toContain("请求失败，未确认执行结果");
  expect(wrapper.text()).toContain("重试会复用同一操作标识");
  await submit.trigger("click");
  await flushPromises();
  expect(change).toHaveBeenCalledTimes(2);
  // 同一命令原样重放：同一操作标识、载荷与预览回执。
  expect(change.mock.calls[1]![0]).toEqual(change.mock.calls[0]![0]);
  expect(change.mock.calls[0]![0]).toMatchObject({
    action: "save",
    baseline: "example-baseline-1",
    confirmPublished: true,
    operationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    receipt: { token: "preview-1" },
  });
  wrapper.unmount();
});

it("新建先校验 ID 并取服务端基线；ID 已存在时提示进入对应记录", async () => {
  const baseline = vi.fn(async (id: string) => ({
    targetId: id,
    exists: true,
    baseline: "b".repeat(64),
    publication: "published",
  }));
  const preview = vi.fn();
  const { wrapper } = await setup(
    service({
      baseline,
      preview: preview as unknown as CompetitionService["preview"],
    }),
    "/competitions/new",
  );
  await wrapper.get("#competition-id").setValue("existing-contest");
  await wrapper.get("#competition-name").setValue("重复新建");
  await button(wrapper, "生成变更预览").trigger("click");
  await flushPromises();
  expect(baseline).toHaveBeenCalledWith("existing-contest");
  expect(wrapper.text()).toContain("已存在（已发布）");
  expect(preview).not.toHaveBeenCalled();
  wrapper.unmount();
});

it("显式示例模式不调用注入的真实写服务", async () => {
  const real = service({
    preview: vi.fn() as unknown as CompetitionService["preview"],
    change: vi.fn() as unknown as CompetitionService["change"],
  });
  const { wrapper } = await setup(
    real,
    "/competitions/example-contest-2/edit?preview=1",
  );
  await button(wrapper, "生成变更预览").trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain("布局预览");
  expect(wrapper.text()).toContain("示例模式只读");
  expect(real.preview).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain("北京时间显示：2026/11/09 18:00:00");
  wrapper.unmount();
});

it("从隐藏动作进入新增页面会重置为保存新草稿", async () => {
  const { wrapper, router } = await setup(
    exampleCompetitions,
    "/competitions/example-contest-2/edit?preview=1",
  );
  const select = wrapper
    .findAll("select")
    .find((s) => s.text().includes("保存修改"))!;
  await select.setValue("hide");
  await router.push("/competitions/new?preview=1");
  await flushPromises();
  const next = wrapper
    .findAll("select")
    .find((s) => s.text().includes("保存新草稿"))!;
  expect((next.element as HTMLSelectElement).value).toBe("save");
  wrapper.unmount();
});

it("新建草稿首次预览使用校验后取得的服务端基线，不用空基线请求", async () => {
  const baseline = vi.fn(async (id: string) => ({
    targetId: id,
    exists: false,
    baseline: "d".repeat(64),
    publication: null,
  }));
  const preview = vi.fn<CompetitionService["preview"]>(async (request) => ({
    contentKey: competitionContentKey(
      request.content,
      request.baseline,
      request.action,
    ),
    token: "preview-new",
    changes: [],
    blocks: [],
  }));
  const { wrapper } = await setup(
    service({ baseline, preview }),
    "/competitions/new",
  );
  await wrapper.get("#competition-id").setValue("brand-new-contest");
  await wrapper.get("#competition-name").setValue("全新草稿");
  await button(wrapper, "生成变更预览").trigger("click");
  await flushPromises();
  expect(baseline).toHaveBeenCalledWith("brand-new-contest");
  // 取基线发生在预览之前：请求必须带 64 位正式基线，否则服务端会判 400。
  expect(preview).toHaveBeenCalledTimes(1);
  expect(preview.mock.calls[0]![0].baseline).toBe("d".repeat(64));
  expect(wrapper.text()).toContain("服务预览已返回");
  wrapper.unmount();
});

it("服务端确定性拒绝后丢弃暂存命令，重试生成新的操作标识", async () => {
  const change = vi
    .fn<CompetitionService["change"]>()
    .mockRejectedValueOnce(
      new ConsoleError(409, "基线已变化", "COMPETITION_BASELINE_STALE"),
    )
    .mockResolvedValueOnce({
      targetId: "example-contest-2",
      action: "save",
      publication: "draft",
      baseline: "c".repeat(64),
      changes: [],
      auditOperationId: "audit-1",
    });
  const { wrapper } = await setup(service({ change }), undefined, {
    confirmDialog: false,
  });
  await button(wrapper, "生成变更预览").trigger("click");
  await flushPromises();
  const ack = wrapper.findAll(".preview-ack input[type=checkbox]");
  await ack[0]!.setValue(true);
  await ack[1]!.setValue(true);
  await button(wrapper, "打开操作确认").trigger("click");
  await flushPromises();
  await wrapper.get(".confirm-stub button").trigger("click");
  await flushPromises();
  // 比赛维护的 409 直接展示服务端具体原因，不收敛成通用「重新审核」。
  expect(wrapper.text()).toContain("基线已变化");
  expect(wrapper.text()).toContain("本轮基线已过期");
  wrapper.unmount();
});

it("保存成功后提示服务端已确认并重新读取基线", async () => {
  const change = vi.fn<CompetitionService["change"]>(async () => ({
    targetId: "example-contest-1",
    action: "save",
    publication: "draft",
    baseline: "e".repeat(64),
    changes: [],
    auditOperationId: "audit-9",
  }));
  const { wrapper } = await setup(service({ change }), undefined, {
    confirmDialog: false,
  });
  await button(wrapper, "生成变更预览").trigger("click");
  await flushPromises();
  // 已发布记录更新：核对确认与显式确认都要勾选才能提交。
  const ack = wrapper.findAll(".preview-ack input[type=checkbox]");
  await ack[0]!.setValue(true);
  await ack[1]!.setValue(true);
  await button(wrapper, "打开操作确认").trigger("click");
  await flushPromises();
  await wrapper.get(".confirm-stub button").trigger("click");
  await flushPromises();
  expect(change).toHaveBeenCalledTimes(1);
  // 写入已确认后必须给出明确确认语，不能只剩列表刷新。
  expect(wrapper.text()).toContain("服务端已确认本次操作");
  expect(wrapper.text()).toContain("详情与基线已重新读取");
  wrapper.unmount();
});
