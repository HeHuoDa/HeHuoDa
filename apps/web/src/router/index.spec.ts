import { competitionApi } from "../api/competitions";
import {
  fixtureColleges,
  fixtureDetail,
  fixtureList,
} from "../api/competition-test-fixture";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "vue-router";
import App from "../App.vue";
import { healthApi } from "../api/health";
import { createAppRouter } from "./index";

vi.mock("../api/health", () => ({ healthApi: { getHealth: vi.fn() } }));

const pages = [
  ["/my/favorites", "我的收藏", "favorites"],
  ["/notifications", "站内通知", "notifications"],
] as const;

describe("学生端路由", () => {
  let wrapper: ReturnType<typeof mount> | undefined;
  const routers: ReturnType<typeof createAppRouter>[] = [];

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(competitionApi.colleges).mockResolvedValue(fixtureColleges);
    vi.mocked(competitionApi.list).mockImplementation(async (filters) =>
      fixtureList(filters),
    );
    vi.mocked(competitionApi.detail).mockImplementation(async (id) =>
      fixtureDetail(id),
    );
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });
  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    routers.splice(0).forEach((router) => (router.listening = false));
    vi.restoreAllMocks();
  });

  async function visit(path: string) {
    const router = createAppRouter(createMemoryHistory());
    routers.push(router);
    await router.push(path);
    await router.isReady();
    wrapper = mount(App, {
      global: { plugins: [router, createPinia()] },
    });
    await flushPromises();
    return router;
  }

  it("默认入口进入首页，比赛详情保留首页内容区域与导航归属", async () => {
    const router = await visit("/");
    expect(router.currentRoute.value.path).toBe("/home");
    expect(wrapper!.get("h1").text()).toBe("发现比赛，找到同路人");
    expect(wrapper!.findAll("[data-college-id]")).toHaveLength(27);
    expect(wrapper!.get(".college-reset").attributes("aria-pressed")).toBe(
      "true",
    );
    expect(wrapper!.get('[role="status"]').text()).toContain("全部学院");
    expect(wrapper!.findAll("[data-competition-card]").length).toBeGreaterThan(
      0,
    );
    await wrapper!
      .get('[data-college-id="information-engineering"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper!.get('[role="status"]').text()).toContain("信息工程学院");
    await wrapper!.get("[data-competition-card] h3 a").trigger("click");
    await flushPromises();
    await vi.waitFor(() =>
      expect(wrapper!.get("[data-home-content] h1").text()).toBe(
        "大学生程序设计竞赛",
      ),
    );
    expect(wrapper!.find(".college-picker").exists()).toBe(false);
    expect(router.currentRoute.value.meta.navigation).toBe("home");
    expect(
      wrapper!
        .get('nav[aria-label="学生端主导航"] a[aria-current="page"]')
        .text(),
    ).toBe("首页");
    await wrapper!.get('[aria-label="页面相关入口"] a').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/home");
    expect(
      wrapper!
        .get('[data-college-id="information-engineering"]')
        .attributes("aria-pressed"),
    ).toBe("true");
  });

  it.each(pages)(
    "直接访问 %s 显示 %s 的待开发页",
    async (path, title, name) => {
      const router = await visit(path);
      expect(wrapper!.get("h1").text()).toBe(title);
      expect(wrapper!.text()).toContain("待开发");
      expect(document.title).toBe(`${title} · 禾伙人`);
      expect(router.currentRoute.value.name).toBe(name);
      expect(healthApi.getHealth).not.toHaveBeenCalled();
    },
  );

  it.each(["/teams/new", "/teams/preview"])("%s 高亮找队友", async (path) => {
    await visit(path);
    expect(
      wrapper!
        .get('nav[aria-label="学生端主导航"] a[aria-current="page"]')
        .text(),
    ).toBe("找队友");
    expect(
      wrapper!
        .get('nav[aria-label="移动端主导航"] a[aria-current="page"]')
        .text(),
    ).toBe("找队友");
  });

  it.each([
    ["/login", "登录", 2],
    ["/register", "注册", 5],
  ] as const)(
    "直接访问 %s 显示表单并保留独立品牌布局",
    async (path, title, count) => {
      await visit(path);
      expect(wrapper!.get("h1").text()).toBe(title);
      expect(document.title).toBe(`${title} · 禾伙人`);
      expect(wrapper!.findAll("input")).toHaveLength(count);
      expect(wrapper!.find(".student-shell").exists()).toBe(false);
      expect(wrapper!.text()).not.toContain("待开发");
      expect(wrapper!.get('a.auth-home-link[href="/home"]').text()).toContain(
        "返回首页",
      );
    },
  );

  it("认证页互切清空敏感输入，前进后退及返回首页正常", async () => {
    const router = await visit("/login");
    await wrapper!.get("#auth-password").setValue("private-password");
    await wrapper!.get('a[href="/register"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/register");
    expect(
      (wrapper!.get("#auth-password").element as HTMLInputElement).value,
    ).toBe("");
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/login");
    router.forward();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/register");
    await wrapper!.get(".auth-home-link").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/home");
  });

  it.each(["/my/favorites", "/notifications"])(
    "移动端 %s 归入个人中心",
    async (path) => {
      await visit(path);
      expect(
        wrapper!
          .get('nav[aria-label="移动端主导航"] a[aria-current="page"]')
          .text(),
      ).toBe("我的");
    },
  );

  it("个人中心提供资料与分区、收藏、通知和账号入口，并统一高亮个人中心", async () => {
    await visit("/profile");
    expect(wrapper!.get("h1").text()).toBe("个人中心");
    expect(document.title).toBe("个人中心 · 禾伙人");
    expect(wrapper!.find(".placeholder-panel").exists()).toBe(false);
    expect(
      wrapper!
        .get('nav[aria-label="学生端主导航"] a[aria-current="page"]')
        .text(),
    ).toBe("我的");
    expect(
      wrapper!
        .get('nav[aria-label="移动端主导航"] a[aria-current="page"]')
        .text(),
    ).toBe("我的");
    for (const path of [
      "/my/favorites",
      "/notifications",
      "/login",
      "/register",
    ]) {
      expect(wrapper!.find(`.profile-page a[href="${path}"]`).exists()).toBe(
        true,
      );
    }
  });

  it.each(["/missing/deep?x=1", "/competitions", "/competitions/42"])(
    "未知地址 %s 显示独立 404",
    async (path) => {
      const router = await visit(path);
      expect(router.currentRoute.value.name).toBe("not-found");
      expect(wrapper!.get("h1").text()).toBe("页面不存在");
      expect(wrapper!.find(".student-shell").exists()).toBe(false);
      expect(wrapper!.get('a.hhr-button[href="/home"]').text()).toBe(
        "返回首页",
      );
      expect(healthApi.getHealth).not.toHaveBeenCalled();
    },
  );

  it("健康页加载期间禁止重复操作并保留状态与请求 ID", async () => {
    let complete!: (value: { status: "ok"; requestId: string }) => void;
    vi.mocked(healthApi.getHealth).mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    await visit("/health");
    const button = wrapper!.get("button");
    expect(button.attributes("type")).toBe("button");
    expect(button.attributes("disabled")).toBeDefined();
    expect(button.attributes("aria-busy")).toBe("true");
    expect(wrapper!.get('[role="status"]').attributes("aria-busy")).toBe(
      "true",
    );
    expect(wrapper!.text()).toContain("正在连接");
    expect(wrapper!.text()).toContain("正在检查服务");
    await button.trigger("click");
    expect(healthApi.getHealth).toHaveBeenCalledTimes(1);
    complete({ status: "ok", requestId: "long-request-" + "x".repeat(200) });
    await flushPromises();
    expect(wrapper!.text()).toContain("服务在线");
    expect(button.attributes("disabled")).toBeUndefined();
    expect(wrapper!.get("dd").text()).toBe("long-request-" + "x".repeat(200));
    expect(wrapper!.findAll("svg")).toHaveLength(0);
  });

  it("健康页独立保留，首次失败后重试和刷新仍能正常请求", async () => {
    vi.mocked(healthApi.getHealth)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ status: "ok", requestId: "retry-7" })
      .mockResolvedValueOnce({ status: "ok", requestId: "refresh-7" });
    const router = await visit("/health");
    expect(router.currentRoute.value.name).toBe("health");
    expect(wrapper!.find(".student-shell").exists()).toBe(false);
    expect(wrapper!.text()).toContain("服务离线");
    await wrapper!.get("button").trigger("click");
    await flushPromises();
    expect(wrapper!.text()).toContain("retry-7");
    await wrapper!.get("button").trigger("click");
    await flushPromises();
    expect(wrapper!.text()).toContain("refresh-7");
    expect(healthApi.getHealth).toHaveBeenCalledTimes(3);
  });
});

vi.mock("../api/competitions", async (original) => ({
  ...(await original<typeof import("../api/competitions")>()),
  competitionApi: { colleges: vi.fn(), list: vi.fn(), detail: vi.fn() },
}));
