import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "vue-router";
import { createAppRouter } from "../router";
import {
  initialProfile,
  validateProfile,
  useProfileDemoStore,
} from "../data/profile-demo";
import ProfileView from "./ProfileView.vue";

// jsdom 不实现原生模态行为；背景隔离与真实键盘路径另在浏览器验证。
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

describe("个人中心会话内演示", () => {
  let wrapper: ReturnType<typeof mount>;
  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
  });
  async function visit(url = "/profile", pinia = createPinia()) {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const router = createAppRouter(createMemoryHistory());
    await router.push(url);
    wrapper = mount(ProfileView, {
      attachTo: document.body,
      global: { plugins: [pinia, router] },
    });
    await flushPromises();
    return { router, pinia };
  }
  it("直接访问、非法及重复分区规范化，保留无关参数", async () => {
    const { router } = await visit("/profile?section=teams&source=test");
    expect(wrapper.text()).toContain("植物摄影小组");
    await router.push("/profile?section=applications");
    expect(wrapper.text()).toContain("已邀请");
    await router.push("/profile?section=bad&source=test");
    expect(router.currentRoute.value.fullPath).toBe("/profile?source=test");
    expect(wrapper.text()).toContain("禾小苗");
    await router.push("/profile?section=teams&section=applications");
    expect(router.currentRoute.value.fullPath).toBe("/profile");
  });
  it("前进后退恢复 URL 分区，不丢失原有入口", async () => {
    const { router } = await visit();
    await router.push("/profile?section=teams");
    await router.push("/profile?section=applications");
    router.back();
    await flushPromises();
    expect(wrapper.text()).toContain("植物摄影小组");
    router.forward();
    await flushPromises();
    expect(wrapper.text()).toContain("已邀请");
    for (const url of [
      "/my/teams",
      "/my/applications",
      "/my/favorites",
      "/notifications",
      "/login",
      "/register",
      "/health",
    ]) {
      expect(router.resolve(url).matched.length).toBeGreaterThan(0);
    }
  });
  it("首页保留四个快捷入口并展示共享队伍，业务操作归属分区", async () => {
    const { router } = await visit();
    expect(wrapper.find(".profile-sections").exists()).toBe(false);
    expect(wrapper.findAll(".profile-shortcut")).toHaveLength(4);
    expect(wrapper.text()).toContain("植物摄影小组");
    expect(wrapper.text()).toContain("普通成员");
    await router.push("/profile?section=applications");
    expect(wrapper.findAll(".profile-shortcut")).toHaveLength(0);
    expect(wrapper.get(".profile-sections").text()).toContain("返回个人中心");
    expect(wrapper.text()).toContain("确认入队");
  });
  it("空白昵称阻止保存，错误关联控件并聚焦", async () => {
    await visit();
    await wrapper.get("header button").trigger("click");
    await wrapper.get("#profile-nickname").setValue("  ");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.get("#profile-nickname").attributes("aria-invalid")).toBe(
      "true",
    );
    expect(document.activeElement?.id).toBe("profile-nickname");
    expect(wrapper.text()).toContain("禾小苗");
    expect(wrapper.find("form").exists()).toBe(true);
  });
  it("纯文本保存，不发送请求或持久化；路由往返保留，重建会话复位", async () => {
    const { router, pinia } = await visit();
    const network = vi.spyOn(globalThis, "fetch");
    const persistence = vi.spyOn(Storage.prototype, "setItem");
    await wrapper.get("header button").trigger("click");
    await wrapper.get("#profile-nickname").setValue("<b>禾苗</b>");
    await wrapper.get("#profile-bio").setValue("<script>alert(1)</script>");
    await wrapper.get("#profile-skills").setValue("编程，设计、编程");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("<b>禾苗</b>");
    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.get('[role="status"]').text()).toContain("未保存到服务器");
    expect(useProfileDemoStore(pinia).profile.skills).toBe("编程、设计");
    expect(wrapper.find("form").exists()).toBe(false);
    await router.push("/profile?section=teams");
    await router.push("/profile");
    expect(wrapper.text()).toContain("<b>禾苗</b>");
    expect(network).not.toHaveBeenCalled();
    expect(persistence).not.toHaveBeenCalled();
    wrapper.unmount();
    await visit();
    expect(wrapper.text()).toContain("禾小苗");
    expect(wrapper.text()).not.toContain("<b>禾苗</b>");
  });
  it("取消不保存，Escape 回到编辑按钮；默认不共享，重置资料与授权", async () => {
    await visit();
    expect(
      (wrapper.get('input[type="checkbox"]').element as HTMLInputElement)
        .checked,
    ).toBe(false);
    await wrapper.get("header button").trigger("click");
    await wrapper.get("#profile-nickname").setValue("取消的资料");
    await wrapper.get("dialog").trigger("cancel");
    await flushPromises();
    expect(wrapper.find("form").exists()).toBe(false);
    expect(document.activeElement?.textContent?.trim()).toBe("编辑资料");
    expect(wrapper.text()).not.toContain("取消的资料");
    await wrapper.get('input[type="checkbox"]').setValue(true);
    expect(wrapper.text()).toContain("演示已授权");
    expect(wrapper.find('input[type="tel"]').exists()).toBe(false);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "重置示例")!
      .trigger("click");
    expect(
      (wrapper.get('input[type="checkbox"]').element as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(wrapper.text()).toContain("未确认的受邀者和已退出成员不能查看");
  });
  it("打开模态弹窗、保留页面布局，聚焦昵称且 Tab 在弹窗内循环", async () => {
    await visit();
    const overflow = document.body.style.overflow;
    await wrapper.get("header button").trigger("click");
    await flushPromises();
    expect((wrapper.get("dialog").element as HTMLDialogElement).open).toBe(
      true,
    );
    expect(wrapper.get("header button").isVisible()).toBe(true);
    expect(wrapper.find("section form").exists()).toBe(false);
    expect(document.activeElement?.id).toBe("profile-nickname");
    expect(document.body.style.overflow).toBe("hidden");
    const controls = wrapper.findAll(
      "dialog button, dialog input, dialog select, dialog textarea",
    );
    (controls.at(-1)!.element as HTMLElement).focus();
    await wrapper.get("dialog").trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(controls[0]!.element);
    await wrapper
      .get("dialog")
      .trigger("keydown", { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(controls.at(-1)!.element);
    await wrapper.get("dialog").trigger("click");
    expect(wrapper.find("dialog").exists()).toBe(true);
    await wrapper.get("dialog").trigger("cancel");
    await flushPromises();
    expect(document.activeElement).toBe(wrapper.get("header button").element);
    expect(document.body.style.overflow).toBe(overflow);
  });
  it.each(["取消编辑", "关闭", "Escape"])(
    "%s 丢弃草稿，再次打开已保存资料并清除错误",
    async (action) => {
      const { pinia } = await visit();
      await wrapper.get("header button").trigger("click");
      await wrapper.get("#profile-nickname").setValue("已保存资料");
      await wrapper.get("form").trigger("submit");
      await flushPromises();
      expect(wrapper.find("dialog").exists()).toBe(false);
      expect(document.activeElement).toBe(wrapper.get("header button").element);
      await wrapper.get("header button").trigger("click");
      await wrapper.get("#profile-nickname").setValue(" ");
      await wrapper.get("#profile-bio").setValue("未保存简介");
      await wrapper.get("form").trigger("submit");
      if (action === "Escape") await wrapper.get("dialog").trigger("cancel");
      else
        await wrapper
          .findAll("dialog button")
          .find((button) => button.text() === action)!
          .trigger("click");
      await flushPromises();
      expect(wrapper.find("dialog").exists()).toBe(false);
      expect(useProfileDemoStore(pinia).profile.nickname).toBe("已保存资料");
      await wrapper.get("header button").trigger("click");
      expect(
        (wrapper.get("#profile-nickname").element as HTMLInputElement).value,
      ).toBe("已保存资料");
      expect(
        (wrapper.get("#profile-bio").element as HTMLTextAreaElement).value,
      ).not.toBe("未保存简介");
      expect(wrapper.find('[aria-invalid="true"]').exists()).toBe(false);
    },
  );
  it("分区切换与页面卸载清理弹窗和背景滚动锁", async () => {
    const { router } = await visit();
    const overflow = document.body.style.overflow;
    await wrapper.get("header button").trigger("click");
    await flushPromises();
    await router.push("/profile?section=teams");
    await flushPromises();
    expect(wrapper.find("dialog").exists()).toBe(false);
    expect(document.body.style.overflow).toBe(overflow);
    await router.push("/profile");
    await wrapper.get("header button").trigger("click");
    await flushPromises();
    wrapper.unmount();
    expect(document.body.style.overflow).toBe(overflow);
  });
  it("资料校验覆盖稳定学院 ID、年级、技能及简介边界", () => {
    const valid = initialProfile();
    expect(validateProfile(valid)).toEqual({});
    const invalid = validateProfile({
      ...valid,
      campus: "其他",
      collegeId: "fake",
      grade: "abcd",
      major: " ",
      skills: "a".repeat(21),
      bio: "苗".repeat(201),
    });
    for (const key of [
      "campus",
      "collegeId",
      "grade",
      "major",
      "skills",
      "bio",
    ])
      expect(invalid).toHaveProperty(key);
  });
});
