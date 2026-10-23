import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { extname } from "node:path";
import { after, test } from "node:test";
import { effectScope, nextTick, reactive } from "vue";
import { compileScript, parse } from "vue/compiler-sfc";
import { createPinia, setActivePinia } from "pinia";
import {
  initialTeams,
  parseTeamFilters,
  recruitmentStatus,
  TEAM_PAGE_SIZE,
} from "@hehuoda/client-domain/team";
import {
  createTeamListController,
  initialTeamListState,
} from "../src/stores/team-list-controller.ts";
import { RequestError } from "../src/api/http.ts";
import {
  parseTeamRouteQuery,
  teamRouteQuery,
} from "../src/navigation/team-query.ts";
import { useSessionStore } from "../src/stores/session.ts";
import { useNavigationStore } from "../src/stores/navigation.ts";
import { detail } from "./fixtures/competition-detail.mjs";

const NOW = Date.parse("2026-10-19T04:00:00Z");
const ids = (teams) => teams.map((team) => team.id);

/** 可手动结算的请求替身，用来观察代次与取消行为。 */
function deferredApi() {
  const calls = [];
  return {
    calls,
    detail(id) {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const call = {
        id,
        resolve,
        reject,
        cancelled: false,
        cancel() {
          call.cancelled = true;
        },
      };
      calls.push(call);
      return { promise, cancel: call.cancel };
    },
  };
}

function controllerFor(teams, api = deferredApi(), overrides = {}) {
  const state = reactive(initialTeamListState(NOW));
  return {
    state,
    api,
    controller: createTeamListController(state, {
      teams: () => teams,
      api,
      now: () => NOW,
      ...overrides,
    }),
  };
}

test("固定时钟下六种招募状态按解散、关闭、暂停、截止、满员的优先级判定", () => {
  const teams = initialTeams(NOW);
  assert.deepEqual(
    teams.map((team) => recruitmentStatus(team, NOW).label),
    [
      "招募中",
      "招募中",
      "已暂停",
      "已关闭",
      "已满员",
      "已截止",
      "招募中",
      "招募中",
    ],
  );
  assert.equal(
    recruitmentStatus({ ...teams[0], dissolved: true }, NOW).label,
    "已解散",
  );
  // 截止与满员同时成立时，先报截止；状态判定不依赖成员关系。
  assert.equal(
    recruitmentStatus(
      { ...teams[4], deadline: new Date(NOW).toISOString() },
      NOW,
    ).label,
    "已截止",
  );
});

test("筛选、排序与分页沿用源规则，页码越界回写状态", () => {
  const teams = initialTeams(NOW);
  const { state, controller } = controllerFor(teams);
  assert.deepEqual(ids(controller.view().results), ids(teams));
  assert.equal(controller.view().pages, 2);
  assert.equal(TEAM_PAGE_SIZE, 4);

  for (const [query, expected] of [
    [{ status: "available" }, ["demo-1", "demo-2", "demo-7", "demo-8"]],
    [{ status: "unavailable" }, ["demo-3", "demo-4", "demo-5", "demo-6"]],
    [{ type: "innovation" }, ["demo-3", "demo-7"]],
    [{ role: "建模" }, ["demo-2", "demo-4", "demo-6", "demo-8"]],
    [{ mode: "offline" }, ["demo-3", "demo-6"]],
    [{ q: "植物" }, ["demo-1", "demo-3", "demo-5", "demo-7"]],
    [{ q: "植物", role: "编程" }, []],
    [{ type: "course", mode: "online" }, ["demo-2"]],
  ]) {
    controller.restore(query);
    assert.deepEqual(
      ids(controller.view().results),
      expected,
      JSON.stringify(query),
    );
  }

  controller.restore({ page: "2" });
  assert.deepEqual(ids(controller.view().visible), [
    "demo-5",
    "demo-6",
    "demo-7",
    "demo-8",
  ]);
  assert.equal(state.filters.page, 2);

  // 越界页码在进入列表时即被纠正并回写，跳转不会带上无效页。
  controller.restore({ page: "5" });
  assert.equal(controller.view().page, 2);
  assert.equal(state.filters.page, 2);
  controller.page(99);
  assert.equal(state.filters.page, 2);
  controller.update({ status: "available" });
  assert.equal(state.filters.page, 1);
  assert.equal(controller.view().pages, 1);
  controller.reset();
  assert.deepEqual(state.filters, parseTeamFilters({}));
  assert.equal(controller.view().results.length, 8);
});

test("越界页码进入详情再返回后仍停留在纠正后的页", () => {
  const teams = initialTeams(NOW);
  const { state, controller } = controllerFor(teams);
  controller.restore({ page: "5" });
  const toDetail = teamRouteQuery(state.filters);
  assert.equal(toDetail.page, "2");
  assert.equal(toDetail.id, undefined);

  // 详情页只解析并原样交回，不参与筛选规则。
  const back = teamRouteQuery(parseTeamRouteQuery(toDetail));
  assert.deepEqual(back, { page: "2" });
  controller.restore(back);
  assert.equal(state.filters.page, 2);
  assert.equal(controller.view().page, 2);
  assert.equal(controller.view().visible.length, 4);
});

test("参数边界：空值不写入，非法取值回落到默认", () => {
  assert.deepEqual(teamRouteQuery(parseTeamFilters({})), {});
  assert.deepEqual(
    teamRouteQuery(
      parseTeamFilters({
        q: "  植物  ",
        type: "unknown",
        role: "编程",
        mode: "online",
        status: "available",
        competition: "competition-a",
        page: "0",
      }),
    ),
    {
      q: "植物",
      role: "编程",
      mode: "online",
      status: "available",
      competition: "competition-a",
    },
  );
  assert.deepEqual(parseTeamRouteQuery({ page: ["3", "4"], type: 1 }), {
    q: "",
    type: "",
    role: "",
    mode: "",
    status: "",
    competition: "",
    page: 3,
  });
  assert.deepEqual(parseTeamRouteQuery(null), parseTeamFilters({}));
});

test("关联比赛五态：成功、隐藏、失败、取消与迟到响应互不覆盖", async () => {
  const teams = initialTeams(NOW);
  const { state, controller, api } = controllerFor(teams);

  controller.restore({ competition: "competition-a" });
  assert.equal(state.competitionStatus, "loading");
  api.calls[0].resolve(detail("competition-a"));
  await Promise.resolve();
  assert.equal(state.competitionStatus, "ready");
  assert.equal(state.competition.name, "校园创新比赛");

  // 已落定的资料在隐藏时不被抹掉。
  controller.cancel();
  assert.equal(state.competitionStatus, "ready");

  controller.restore({ competition: "competition-missing" });
  api.calls[1].reject(
    new RequestError("http", "比赛不存在。", { statusCode: 404 }),
  );
  await Promise.resolve();
  assert.equal(state.competitionStatus, "missing");
  assert.match(state.competitionError, /不存在或已隐藏/);

  controller.restore({ competition: "competition-broken" });
  api.calls[2].reject(
    new RequestError("network", "暂时无法连接服务，请稍后重试。"),
  );
  await Promise.resolve();
  assert.equal(state.competitionStatus, "error");
  assert.match(state.competitionError, /关联比赛加载失败：暂时无法连接服务/);

  // 重试沿用当前条件，重新发起请求。
  const retry = controller.loadCompetition();
  assert.equal(state.competitionStatus, "loading");
  api.calls[3].reject(new RequestError("timeout", "连接超时，请稍后重试。"));
  await retry;
  assert.equal(state.competitionStatus, "error");

  // 加载中隐藏：回落 idle，迟到成功不得写入。
  const pending = controller.loadCompetition();
  controller.cancel();
  assert.equal(state.competitionStatus, "idle");
  api.calls[4].resolve(detail("competition-broken"));
  await pending;
  assert.equal(state.competitionStatus, "idle");
  assert.equal(state.competition, null);

  // 清除条件同样中断并回到 idle。
  controller.update({ competition: "" });
  assert.equal(state.competitionStatus, "idle");
});

test("演示时钟幂等启动、可注入时间，停止后不再推进", () => {
  const teams = initialTeams(NOW);
  let now = NOW;
  const timers = [];
  const { state, controller } = controllerFor(teams, deferredApi(), {
    now: () => now,
    interval: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clear: (handle) => {
      timers.splice(Number(handle) - 1, 1);
    },
  });
  controller.startClock();
  controller.startClock();
  assert.equal(timers.length, 1);
  now = NOW + 1000;
  timers[0]();
  assert.equal(state.now, NOW + 1000);
  controller.stopClock();
  assert.equal(timers.length, 0);
  now = NOW + 2000;
  controller.syncClock();
  assert.equal(state.now, NOW + 2000);
});

test("发布新队伍后列表立即可见并保留筛选，重置恢复初始演示数据", async () => {
  const pinia = createPinia();
  const scope = effectScope();
  try {
    const session = scope.run(() => useSessionStore(pinia));
    const state = reactive(initialTeamListState(NOW));
    const controller = createTeamListController(state, {
      teams: () => session.teams,
      api: deferredApi(),
      now: () => NOW,
    });
    controller.update({ type: "course" });
    assert.equal(controller.view().results.length, 2);

    const published = session.publish(
      {
        title: "新的课程项目招募",
        type: "course",
        goal: "一起完成一个可展示的学习项目，按周交流进度。",
        progress: "",
        roles: ["调研"],
        skills: "",
        mode: "online",
        location: "",
        capacity: "5",
        deadline: new Date(NOW + 31 * 86400000).toISOString().slice(0, 16),
        trackId: "",
      },
      NOW,
    );
    assert.ok(published);
    // 同一发布时间按 ID 升序，因此新队伍排在等时记录的后面，但立即可见。
    assert.ok(ids(controller.view().results).includes(published.id));
    assert.equal(controller.view().results.length, 3);
    assert.equal(state.filters.type, "course");

    session.reset();
    await nextTick();
    assert.equal(session.teams.length, 8);
    assert.equal(controller.view().results.length, 2);
    assert.equal(state.filters.type, "course");
  } finally {
    scope.stop();
  }
});

/* 页面级测试：编译真实 SFC，替换平台生命周期与比赛请求入口。 */

const lifecycleUrl = `data:text/javascript,${encodeURIComponent(`
  export const hooks = { load: [], ready: [], show: [], hide: [], unload: [] };
  export const onLoad = fn => hooks.load.push(fn);
  export const onReady = fn => hooks.ready.push(fn);
  export const onShow = fn => hooks.show.push(fn);
  export const onHide = fn => hooks.hide.push(fn);
  export const onUnload = fn => hooks.unload.push(fn);
`)}`;
const apiModule = `data:text/javascript,${encodeURIComponent(`
  export const competitionApi = {
    detail(id) {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      const call = { id, resolve, reject, cancelled: false, cancel() { call.cancelled = true; } };
      globalThis.__teamApiCalls.push(call);
      return { promise, cancel: call.cancel };
    },
  };
`)}`;
const loader = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@dcloudio/uni-app")
      return { url: lifecycleUrl, shortCircuit: true };
    if (specifier.endsWith(".vue"))
      return {
        url: "data:text/javascript,export default {}",
        shortCircuit: true,
      };
    if (specifier.endsWith("/api/competitions.ts"))
      return { url: apiModule, shortCircuit: true };
    if (specifier.startsWith(".") && !extname(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return next(url.href, context);
    }
    return next(specifier, context);
  },
});
after(() => loader.deregister());

const { hooks } = await import(lifecycleUrl);
const pageUrl = new URL("../src/pages/teams/index.vue", import.meta.url);
const { descriptor } = parse(readFileSync(pageUrl, "utf8"));
const compiled = compileScript(descriptor, { id: "team-list-page" });
const source = stripTypeScriptTypes(compiled.content).replace(
  /from\s+(["'])([^"']+)\1/g,
  (_, q, s) => {
    const target = s.startsWith(".")
      ? new URL(extname(s) ? s : `${s}.ts`, pageUrl).href
      : s === "@dcloudio/uni-app"
        ? s
        : import.meta.resolve(s);
    return `from ${q}${target}${q}`;
  },
);
const Page = (
  await import(`data:text/javascript,${encodeURIComponent(source)}`)
).default;
const flush = async () => {
  await new Promise((r) => setImmediate(r));
  await nextTick();
};

test("列表页按参数恢复、纠正页码、进详情携带有效页，隐藏时中断请求", async () => {
  const original = globalThis.uni;
  const navigations = [];
  globalThis.__teamApiCalls = [];
  globalThis.uni = {
    navigateTo({ url }) {
      navigations.push(url);
    },
    switchTab() {},
    reLaunch() {},
    navigateBack() {},
  };
  Object.values(hooks).forEach((list) => {
    list.length = 0;
  });
  const pinia = createPinia();
  const scope = effectScope();
  setActivePinia(pinia);
  const navigation = useNavigationStore(pinia);
  const page = scope.run(() => Page.setup({}, { expose() {} }));
  try {
    hooks.load.forEach((fn) => fn({ page: "5" }));
    assert.equal(page.state.filters.page, 2);
    assert.equal(page.view.value.visible.length, 4);

    hooks.show.forEach((fn) => fn());
    page.openDetail(page.view.value.visible[0]);
    assert.match(navigations[0], /id=demo-5/);
    assert.match(navigations[0], /page=2/);
    page.openPublish();
    assert.match(navigations[1], /\/pages\/teams\/new\?page=2$/);

    // 关联比赛资料按条件真实查询，成功后才展示。
    page.update({ competition: "competition-a" });
    assert.equal(page.state.competitionStatus, "loading");
    globalThis.__teamApiCalls[0].resolve(detail("competition-a"));
    await flush();
    assert.equal(page.state.competitionStatus, "ready");
    assert.equal(page.state.competition.name, "校园创新比赛");

    // 隐藏不抹掉已加载的资料。
    hooks.hide.forEach((fn) => fn());
    assert.equal(page.state.competitionStatus, "ready");

    // 比赛已隐藏：只提供清除条件，不提供重试。
    hooks.show.forEach((fn) => fn());
    page.update({ competition: "competition-missing" });
    assert.equal(page.state.competitionStatus, "loading");
    globalThis.__teamApiCalls
      .at(-1)
      .reject(new RequestError("http", "比赛不存在。", { statusCode: 404 }));
    await flush();
    assert.equal(page.state.competitionStatus, "missing");
    page.clearCompetition();
    assert.equal(page.state.competitionStatus, "idle");

    // 加载中隐藏：回落 idle，迟到响应不得覆盖。
    page.update({ competition: "competition-slow" });
    hooks.hide.forEach((fn) => fn());
    assert.equal(page.state.competitionStatus, "idle");
    globalThis.__teamApiCalls.at(-1).resolve(detail("competition-slow"));
    await flush();
    assert.equal(page.state.competitionStatus, "idle");
    assert.equal(page.state.competition, null);

    // 主导航交接的筛选在 onShow 消费。
    page.update({ q: "" });
    navigation.requestTabQuery("teams", { q: "植物", type: "innovation" });
    hooks.show.forEach((fn) => fn());
    assert.equal(page.state.filters.q, "植物");
    assert.equal(page.state.filters.type, "innovation");
    assert.deepEqual(ids(page.view.value.results), ["demo-3", "demo-7"]);
  } finally {
    hooks.unload.forEach((fn) => fn());
    scope.stop();
    globalThis.uni = original;
    delete globalThis.__teamApiCalls;
  }
});
