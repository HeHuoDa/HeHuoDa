import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "vue-router";
import type { CompetitionDetail, CompetitionList } from "@hehuoda/api-types";
import App from "../App.vue";
import { createAppRouter } from "../router";
import { competitionApi } from "../api/competitions";
import { fixtureDetail, fixtureList } from "../api/competition-test-fixture";
import { useTeamDemoStore } from "../data/team-demo";
vi.mock("../api/competitions", async (original) => ({
  ...(await original<typeof import("../api/competitions")>()),
  competitionApi: { colleges: vi.fn(), list: vi.fn(), detail: vi.fn() },
}));
// jsdom 不实现原生 dialog；仅在测试环境提供方法，真实键盘与焦点在浏览器验收。
Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
  configurable: true,
  value() {},
});
Object.defineProperty(HTMLDialogElement.prototype, "close", {
  configurable: true,
  value() {},
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { resolve, promise };
};
describe("找队友页面、会话与真实比赛查询", () => {
  let wrapper: ReturnType<typeof mount>,
    router: ReturnType<typeof createAppRouter>,
    pinia: ReturnType<typeof createPinia>;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(
      function (this: HTMLDialogElement) {
        this.open = true;
      },
    );
    vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (
      this: HTMLDialogElement,
    ) {
      this.open = false;
    });
    vi.mocked(competitionApi.list).mockImplementation(async (f) =>
      fixtureList(f),
    );
    vi.mocked(competitionApi.detail).mockImplementation(async (id) =>
      fixtureDetail(id),
    );
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
  it("直接访问真实页面、未知 ID 与新资源重置解释", async () => {
    await visit("/teams");
    expect(wrapper.get("h1").text()).toBe("找队友");
    expect(wrapper.findAll("[data-team-card]")).toHaveLength(4);
    expect(wrapper.text()).not.toContain("待开发");
    await router.push("/teams/not-found");
    await flushPromises();
    expect(wrapper.get("h1").text()).toBe("队伍不存在");
    await router.push("/teams/session-9");
    await flushPromises();
    expect(wrapper.text()).toContain("会话内演示数据已重置");
    expect(
      wrapper
        .get('nav[aria-label="学生端主导航"] a[aria-current="page"]')
        .text(),
    ).toBe("找队友");
  });
  it("搜索提交才生效；筛选交集、翻页及详情返回恢复历史", async () => {
    await visit("/teams?page=2");
    expect(wrapper.text()).toContain("第 2 / 2 页");
    await wrapper.get("[data-team-card] h2 a").trigger("click");
    await flushPromises();
    await wrapper.get('a[href="/teams?page=2"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.page).toBe("2");
    await wrapper.get("#team-search").setValue("植物");
    expect(wrapper.findAll("[data-team-card]")).toHaveLength(4);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ q: "植物" });
    expect(wrapper.findAll("[data-team-card]")).toHaveLength(4);
    expect(wrapper.text()).toContain("4 条演示招募");
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.query.page).toBe("2");
    router.forward();
    await flushPromises();
    expect(
      (wrapper.get("#team-search").element as HTMLInputElement).value,
    ).toBe("植物");
  });
  it("非法枚举、重复参数与超页 replace 纠正；清空筛选", async () => {
    await visit("/teams?page=999&type=bad&role=bad&q=%20&q=ignored&ref=keep");
    expect(router.currentRoute.value.query).toEqual({ page: "2", ref: "keep" });
    await wrapper
      .get('section[aria-label="招募筛选"]')
      .findAll("button")
      .find((b) => b.text() === "清空筛选")!
      .trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ ref: "keep" });
  });
  it("申请只创建待处理记录，重复不增加成员；举报不外发", async () => {
    await visit("/teams/demo-1");
    const store = useTeamDemoStore(pinia),
      original = store.teams[0]!.members.length;
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "演示申请")!
      .trigger("click");
    await wrapper.get("#action-note").setValue("<b>愿意参与</b>");
    await wrapper.get("dialog form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("演示申请待处理");
    expect(wrapper.text()).toContain("没有送达真实队长");
    expect(store.teams[0]!.members).toHaveLength(original);
    expect(
      store.records.filter(
        (a) => a.teamId === "demo-1" && a.state === "PENDING",
      ),
    ).toHaveLength(1);
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "演示举报")!
      .trigger("click");
    await wrapper.get("#action-role").setValue("信息不实");
    await wrapper.get("dialog form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("没有实际进入审核");
    expect(competitionApi.detail).not.toHaveBeenCalled();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "重置演示")!
      .trigger("click");
    expect(store.applications["demo-1"]).toBeUndefined();
  });
  it.each([
    ["demo-3", "演示申请待处理"],
    ["demo-4", "已关闭"],
    ["demo-5", "已满员"],
    ["demo-6", "已截止"],
    ["demo-7", "你是演示队长"],
    ["demo-8", "你已是演示成员"],
  ])("%s 禁用申请并说明 %s", async (id, reason) => {
    await visit("/teams/" + id);
    const button = wrapper.findAll("button").find((b) => b.text() === reason)!;
    expect(button.attributes("disabled")).toBeDefined();
  });
  async function fill() {
    await wrapper.get("#type").setValue("other");
    await wrapper.get("#title").setValue("  <b>校园图鉴</b>  ");
    await wrapper
      .get("#goal")
      .setValue("一起整理校园植物资料。\n共同制作图鉴并分享观察。");
    await wrapper.get("#roles").setValue(true);
    await wrapper.get("#mode").setValue("online");
    await wrapper.get("#deadline").setValue("2099-10-05T12:00");
  }
  it("字段错误保留内容且聚焦；发布、阻止重复、列表即时更新并可重置", async () => {
    await visit("/teams/new");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.text()).toContain("请选择项目类型");
    expect(document.activeElement?.id).toBe("type");
    await fill();
    const form = wrapper.get("form");
    await Promise.all([form.trigger("submit"), form.trigger("submit")]);
    await flushPromises();
    expect(router.currentRoute.value.path).toMatch(/^\/teams\/session-/);
    expect(wrapper.get("h1").text()).toBe("<b>校园图鉴</b>");
    expect(wrapper.find("h1 b").exists()).toBe(false);
    expect(wrapper.text()).toContain("当前 1/5 人");
    expect(
      useTeamDemoStore(pinia).teams.filter((t) => t.id.startsWith("session-")),
    ).toHaveLength(1);
    await wrapper
      .findAll("a")
      .find((a) => a.text().includes("返回找队友列表"))!
      .trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-team-card] h2").text()).toContain(
      "<b>校园图鉴</b>",
    );
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "重置演示")!
      .trigger("click");
    expect(wrapper.text()).not.toContain("<b>校园图鉴</b>");
  });
  it("未关联项目在比赛目录加载失败或等待期间仍可发布", async () => {
    const pending = deferred<CompetitionList>();
    vi.mocked(competitionApi.list).mockReturnValueOnce(pending.promise);
    await visit("/teams/new");
    await fill();
    expect(
      wrapper.get('button[type="submit"]').attributes("disabled"),
    ).toBeUndefined();
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("team-detail");
    pending.resolve(fixtureList({ hosts: "all", q: "", status: "", page: 1 }));
    await flushPromises();
  });
  it("真实查询区分失败、重试、空结果；翻页继续查找；忽略迟到搜索响应", async () => {
    vi.mocked(competitionApi.list).mockRejectedValueOnce(new Error("offline"));
    await visit("/teams/new");
    expect(wrapper.text()).toContain("没有使用样例替代");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "重试比赛查询")!
      .trigger("click");
    await flushPromises();
    const more = wrapper
      .findAll("button")
      .find((b) => b.text() === "加载更多比赛");
    expect(more).toBeDefined();
    await more!.trigger("click");
    await flushPromises();
    expect(vi.mocked(competitionApi.list).mock.calls.at(-1)![0].page).toBe(2);
    const old = deferred<CompetitionList>();
    vi.mocked(competitionApi.list).mockReturnValueOnce(old.promise);
    await wrapper.get("#competition-search").setValue("旧搜索");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "查询比赛")!
      .trigger("click");
    await flushPromises();
    const oldSignal = vi.mocked(competitionApi.list).mock.calls.at(-1)![1]!;
    await wrapper.get("#competition-search").setValue("绝无匹配");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "查询比赛")!
      .trigger("click");
    await flushPromises();
    expect(oldSignal.aborted).toBe(true);
    expect(wrapper.text()).toContain("没有找到比赛");
    old.resolve(fixtureList({ hosts: "all", q: "", status: "", page: 1 }));
    await flushPromises();
    expect(wrapper.get("#competition-select").findAll("option")).toHaveLength(
      1,
    );
  });
  it("切换比赛取消迟到详情，清除关联同时清除赛道", async () => {
    await visit("/teams/new");
    const options = wrapper
      .get("#competition-select")
      .findAll("option")
      .filter((o) => o.attributes("value"));
    const id1 = options[0]!.attributes("value")!,
      id2 = options[1]!.attributes("value")!;
    const old = deferred<CompetitionDetail>();
    vi.mocked(competitionApi.detail).mockReturnValueOnce(old.promise);
    await wrapper.get("#competition-select").setValue(id1);
    await flushPromises();
    const signal = vi.mocked(competitionApi.detail).mock.calls[0]![1]!;
    await wrapper.get("#competition-select").setValue(id2);
    await flushPromises();
    expect(signal.aborted).toBe(true);
    old.resolve(fixtureDetail(id1));
    await flushPromises();
    expect(
      wrapper
        .get("#trackId")
        .findAll("option")
        .slice(1)
        .map((o) => o.attributes("value")),
    ).toEqual(fixtureDetail(id2).tracks.map((t) => t.id));
    await wrapper.get("#trackId").setValue(fixtureDetail(id2).tracks[0]!.id);
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "清除比赛")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.find("#trackId").exists()).toBe(false);
  });
  it("比赛详情链接携带ID，真实比赛展示而无匹配招募不造数据", async () => {
    const id = fixtureList({ hosts: "all", q: "", status: "", page: 1 })
      .items[0]!.competition.id;
    await visit("/home/competitions/" + id);
    await wrapper
      .findAll("a")
      .find((a) => a.text() === "查看关联演示招募")!
      .trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.competition).toBe(id);
    expect(wrapper.text()).toContain("关联比赛资料");
    expect(wrapper.text()).toContain("暂时没有匹配的演示招募");
    expect(wrapper.findAll("[data-team-card]")).toHaveLength(0);
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "清除比赛条件")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.findAll("[data-team-card]")).toHaveLength(4);
  });
});
