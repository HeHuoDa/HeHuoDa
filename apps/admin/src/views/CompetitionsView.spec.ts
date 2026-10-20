import { expect, it } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import ElementPlus from "element-plus";
import CompetitionsView from "./CompetitionsView.vue";
import { publicCatalogKey } from "../console/public-catalog";
import {
  competitionKey,
  exampleCompetitions,
  type CompetitionService,
} from "../console/competitions";
import { ConsoleError } from "../console/resource";

async function setup(service: CompetitionService) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/competitions/:id/edit", component: CompetitionsView }],
  });
  await router.push("/competitions/example-contest-2/edit?preview=1");
  const wrapper = mount(
    { template: "<RouterView />" },
    {
      global: {
        plugins: [router, ElementPlus],
        provide: {
          [publicCatalogKey as symbol]: { colleges: async () => [] },
          [competitionKey as symbol]: service,
        },
      },
    },
  );
  await flushPromises();
  return { wrapper, router };
}
it("当前409保留输入并锁定确认，预览进行中阻止切换对象", async () => {
  let reject!: (reason: Error) => void;
  const { wrapper, router } = await setup({
    ...exampleCompetitions,
    preview: () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  });
  const generate = () =>
    wrapper.findAll("button").find((b) => b.text() === "生成变更预览")!;
  await generate().trigger("click");
  await flushPromises();
  reject(new ConsoleError(409, "stale"));
  await flushPromises();
  expect(wrapper.text()).toContain("本轮基线已过期");
  expect(
    wrapper.get<HTMLInputElement>("#competition-name").element.value,
  ).toContain("示例");
  expect(generate().attributes("disabled")).toBeDefined();
  await router.push("/competitions/example-contest-3/edit?preview=1");
  await flushPromises();
  await generate().trigger("click");
  await flushPromises();
  await router.push("/competitions/example-contest-4/edit?preview=1");
  await flushPromises();
  expect(router.currentRoute.value.params.id).toBe("example-contest-3");
  reject(new ConsoleError(409, "old"));
  await flushPromises();
  await router.push("/competitions/example-contest-4/edit?preview=1");
  await flushPromises();
  expect(wrapper.text()).not.toContain("本轮基线已过期");
  expect(generate().attributes("disabled")).toBeUndefined();
  wrapper.unmount();
});

it("发布内容修改后预览失效，示例写入不冒充成功", async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/competitions/:id/edit", component: CompetitionsView }],
  });
  await router.push("/competitions/example-contest-2/edit?preview=1");
  const wrapper = mount(CompetitionsView, {
    global: {
      plugins: [router, ElementPlus],
      provide: { [publicCatalogKey as symbol]: { colleges: async () => [] } },
    },
  });
  await flushPromises();
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "生成变更预览")!
    .trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain("布局预览");
  await wrapper.get("#competition-name").setValue("变更后的比赛名称");
  expect(wrapper.text()).toContain("原预览失效");
  wrapper.unmount();
});
