import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "vue-router";
import App from "../App.vue";
import { createAppRouter } from "../router";
import { useTeamDemoStore } from "../data/team-demo";

Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
  configurable: true,
  value() {
    this.open = true;
  },
});
Object.defineProperty(HTMLDialogElement.prototype, "close", {
  configurable: true,
  value() {
    this.open = false;
  },
});
describe("个人中心队伍管理集成", () => {
  let wrapper: ReturnType<typeof mount>,
    router: ReturnType<typeof createAppRouter>,
    pinia: ReturnType<typeof createPinia>;
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });
  afterEach(() => {
    wrapper?.unmount();
    if (router) router.listening = false;
    vi.restoreAllMocks();
  });
  async function visit(path: string) {
    router = createAppRouter(createMemoryHistory());
    pinia = createPinia();
    await router.push(path);
    await router.isReady();
    wrapper = mount(App, {
      attachTo: document.body,
      global: { plugins: [router, pinia] },
    });
    await flushPromises();
  }
  async function click(text: string, scope = wrapper) {
    const button = scope.findAll("button").find((b) => b.text() === text);
    expect(button, text).toBeDefined();
    await button!.trigger("click");
    await flushPromises();
  }
  it.each([
    ["teams", "我的队伍"],
    ["applications", "申请与邀请"],
  ])(
    "旧 %s URL 跳转到个人中心，保留无关参数和分区恢复",
    async (section, title) => {
      await visit(`/my/${section}?source=old&section=bad`);
      expect(router.currentRoute.value.path).toBe("/profile");
      expect(router.currentRoute.value.query).toEqual({
        source: "old",
        section,
      });
      expect(wrapper.text()).toContain(title);
      expect(
        wrapper.get('nav[aria-label="学生端主导航"] a[aria-current]').text(),
      ).toBe("我的");
      expect(wrapper.findAll('nav[aria-label="移动端主导航"] a')).toHaveLength(
        3,
      );
      expect(
        wrapper
          .find('nav[aria-label="学生端主导航"] a[href="/my/teams"]')
          .exists(),
      ).toBe(false);
    },
  );
  it("关闭招募后不再提供暂停或恢复入口", async () => {
    await visit("/profile?section=teams");
    await wrapper.get('[data-my-team="demo-7"] button').trigger("click");
    await click("关闭招募");
    await click("确认操作");
    expect(
      wrapper
        .findAll("button")
        .some((b) => ["暂停招募", "恢复招募"].includes(b.text())),
    ).toBe(false);
    expect(wrapper.get('[data-my-team="demo-7"]').text()).toContain("已关闭");
    expect(wrapper.get('[data-incoming="incoming-2"]').text()).toContain(
      "已失效",
    );
  });
  it("拒绝需确认，取消不变；邀请和撤销保留记录不加人", async () => {
    await visit("/profile?section=teams");
    await wrapper.get('[data-my-team="demo-7"] button').trigger("click");
    await click("拒绝申请");
    await click("取消并关闭");
    expect(
      useTeamDemoStore(pinia).records.find((a) => a.id === "incoming-1")?.state,
    ).toBe("PENDING");
    await click("邀请");
    await click("确认操作");
    expect(
      useTeamDemoStore(pinia).teams.find((t) => t.id === "demo-7")?.members,
    ).toHaveLength(2);
    expect(wrapper.get('[data-incoming="incoming-1"]').text()).toContain(
      "已邀请",
    );
    await wrapper.get('[data-incoming="incoming-1"] button').trigger("click");
    await click("确认操作");
    expect(wrapper.get('[data-incoming="incoming-1"]').text()).toContain(
      "已撤销",
    );
  });
  it("编辑更新公开详情、移交改变权限、普通成员退出清除授权展示", async () => {
    await visit("/profile?section=teams");
    await wrapper.get('[data-my-team="demo-7"] button').trigger("click");
    await click("编辑招募");
    await wrapper.get("#edit-title").setValue("协作图鉴更新");
    await click("保存演示招募");
    await flushPromises();
    expect(wrapper.find("dialog").exists()).toBe(false);
    await router.push("/teams/demo-7");
    await flushPromises();
    expect(wrapper.get("h1").text()).toBe("协作图鉴更新");
    await router.push("/profile?section=teams");
    await flushPromises();
    await wrapper.get('[data-my-team="demo-7"] button').trigger("click");
    await wrapper.get('[data-member="member-6"] input').setValue(true);
    expect(wrapper.get('[data-member="member-6"]').text()).toContain(
      "已授权可见",
    );
    await wrapper.get("#successor").setValue("member-6");
    await click("移交队长");
    await click("确认操作");
    expect(wrapper.text()).not.toContain("队长管理");
    expect(wrapper.text()).toContain("成员详情");
    await click("退出队伍");
    await click("确认操作");
    expect(wrapper.find('[data-my-team="demo-7"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("已授权可见");
  });
  it("确认入队同步找队友与我的队伍；满员预览展示失败并保持成员数", async () => {
    await visit("/profile?section=applications");
    await click("确认入队");
    await click("确认操作");
    expect(wrapper.get('[data-application="history-0"]').text()).toContain(
      "已入队",
    );
    await router.push("/teams/demo-2");
    await flushPromises();
    expect(wrapper.text()).toContain("你已是演示成员");
    await router.push("/profile?section=teams");
    await flushPromises();
    expect(wrapper.find('[data-my-team="demo-2"]').exists()).toBe(true);
    await router.push("/profile?section=applications");
    await flushPromises();
    await wrapper.get("#management-preview").setValue("full");
    await click("确认入队");
    await click("确认操作");
    expect(wrapper.get('.management-panel [role="status"]').text()).toContain(
      "已满员",
    );
    expect(
      useTeamDemoStore(pinia).teams.find((t) => t.id === "demo-2")?.members,
    ).toHaveLength(2);
    await wrapper.get("#management-preview").setValue("no-applications");
    expect(wrapper.text()).toContain("暂无申请与邀请");
  });
  it("弹窗 Tab 循环、关闭恢复焦点，管理不发业务请求或持久化", async () => {
    await visit("/profile?section=teams");
    const network = vi.spyOn(globalThis, "fetch"),
      writes = vi.spyOn(Storage.prototype, "setItem");
    await wrapper.get('[data-my-team="demo-7"] button').trigger("click");
    const trigger = wrapper
      .findAll("button")
      .find((b) => b.text() === "暂停招募")!;
    (trigger.element as HTMLElement).focus();
    await click("暂停招募");
    const controls = wrapper.findAll("dialog button");
    (controls[controls.length - 1]!.element as HTMLElement).focus();
    await wrapper.get("dialog").trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(controls[0]!.element);
    await wrapper.get("dialog").trigger("cancel");
    await flushPromises();
    expect(document.activeElement).toBe(trigger.element);
    expect(network).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  });
});
