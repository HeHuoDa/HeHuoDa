import assert from "node:assert/strict";
import { test } from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { useSessionStore } from "../src/stores/session.ts";
import { RequestError } from "../src/api/http.ts";
import { validateDraft } from "@hehuoda/client-domain/team";
import { detail } from "./fixtures/competition-detail.mjs";
import {
  createTeamPublishController,
  initialTeamPublishState,
} from "../src/stores/team-publish-controller.ts";

const now = Date.parse("2026-10-20T04:00:00Z");
function fixture(
  api = {
    list() {
      throw Error("离线");
    },
    detail() {
      throw Error("离线");
    },
  },
) {
  setActivePinia(createPinia());
  const session = useSessionStore();
  const state = initialTeamPublishState();
  const controller = createTeamPublishController(
    state,
    session,
    api,
    () => now,
  );
  Object.assign(state.draft, {
    type: "other",
    title: "校园植物图鉴",
    goal: "一起记录校园里的植物并整理成图鉴。",
    mode: "online",
    roles: ["设计"],
    deadline: "2026-10-21T12:00",
  });
  return { state, session, controller };
}

test("普通项目离线仍可发布，首位队长与共享列表一致，重复提交只创建一队", async () => {
  const { state, session, controller } = fixture();
  await controller.search();
  assert.equal(state.searchStatus, "error");
  const team = await controller.submit();
  assert.equal(team.members.length, 1);
  assert.equal(team.members[0].captain, true);
  assert.equal(session.teams[0].id, team.id);
  assert.equal(team.deadline, "2026-10-21T04:00:00.000Z");
  assert.equal(await controller.submit(), undefined);
  assert.equal(session.teams.length, 9);
});

test("比赛项目缺少有效比赛时不能通过统一发布动作，草稿原值保留", async () => {
  const { state, session, controller } = fixture();
  state.draft.type = "competition";
  assert.equal(session.publish(state.draft, now), undefined);
  assert.equal(await controller.submit(), undefined);
  assert.match(state.errors.competition, /比赛/);
  assert.equal(state.draft.title, "校园植物图鉴");
});

function deferredApi() {
  const calls = [];
  function request(kind, input) {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const call = {
      kind,
      input,
      resolve,
      reject,
      cancelled: false,
      cancel() {
        call.cancelled = true;
      },
    };
    calls.push(call);
    return { promise, cancel: call.cancel };
  }
  return {
    calls,
    list: (filters) => request("list", filters),
    detail: (id) => request("detail", id),
  };
}
function listResult(id, page = 1, hasMore = false) {
  const c = detail(id);
  return { items: [{ competition: c, stage: c.stages[0] }], page, hasMore };
}

test("搜索 A 慢于 B、旧分页迟到都不覆盖新结果；重试保留已加载页", async () => {
  const api = deferredApi();
  const { state, controller } = fixture(api);
  state.keyword = " A ";
  const a = controller.search();
  state.keyword = "B";
  const b = controller.search();
  assert.equal(api.calls[0].cancelled, true);
  assert.equal(api.calls[0].input.q, "A");
  api.calls[1].resolve(listResult("b", 1, true));
  await b;
  api.calls[0].resolve(listResult("a"));
  await a;
  assert.equal(state.items[0].competition.id, "b");
  const more = controller.more();
  api.calls[2].reject(Error("网络失败"));
  await more;
  assert.equal(state.items.length, 1);
  const retry = controller.retrySearch();
  assert.equal(api.calls[3].input.page, 2);
  api.calls[3].resolve(listResult("c", 2));
  await retry;
  assert.deepEqual(
    state.items.map((i) => i.competition.id),
    ["b", "c"],
  );
});

test("切换比赛立即清除旧赛道，旧详情不能回填；赛道可选，外来赛道拒绝发布", async () => {
  const api = deferredApi();
  const { state, session, controller } = fixture(api);
  state.draft.type = "competition";
  const a = controller.select("a");
  const b = controller.select("b");
  api.calls[1].resolve(detail("b"));
  await b;
  state.draft.trackId = "track-a";
  api.calls[0].resolve(detail("a"));
  await a;
  assert.equal(state.draft.competition.id, "b");
  const c = controller.select("c");
  assert.equal(state.draft.trackId, "");
  assert.equal(state.draft.competition, undefined);
  assert.equal(await controller.submit(), undefined);
  api.calls[2].resolve(detail("c"));
  await c;
  state.draft.trackId = "foreign";
  assert.equal(await controller.submit(), undefined);
  assert.match(state.errors.trackId, /赛道/);
  state.draft.trackId = "";
  const team = await controller.submit();
  assert.equal(team.competition.id, "c");
  assert.equal(team.trackId, undefined);
  assert.equal(session.teams.length, 9);
});

test("比赛 404 与网络错误区分，可重试；清除后迟到响应无效，普通项目可发布", async () => {
  const api = deferredApi();
  const { state, controller } = fixture(api);
  const a = controller.select("hidden");
  api.calls[0].reject(new RequestError("http", "missing", { statusCode: 404 }));
  await a;
  assert.match(state.selectionError, /不存在或未公开/);
  const b = controller.select("hidden");
  api.calls[1].reject(new RequestError("http", "failed", { statusCode: 503 }));
  await b;
  assert.match(state.selectionError, /服务暂时不可用/);
  const c = controller.select("hidden");
  await controller.select("");
  api.calls[2].resolve(detail("hidden"));
  await c;
  assert.equal(state.draft.competition, undefined);
  assert.ok(await controller.submit());
});

test("取消未完成提交与请求、重置后迟到响应不会建队或恢复旧草稿", async () => {
  const api = deferredApi();
  const { state, session, controller } = fixture(api);
  const selecting = controller.select("a");
  controller.reset();
  api.calls[0].resolve(detail("a"));
  await selecting;
  assert.equal(state.draft.competition, undefined);
  assert.equal(state.draft.title, "");
  Object.assign(state.draft, {
    type: "course",
    title: "课程项目",
    goal: "课程协作项目目标填写完整。",
    roles: ["编程"],
    mode: "online",
    deadline: "2026-10-21T12:00",
  });
  const publishing = controller.submit();
  controller.cancel();
  assert.equal(await publishing, undefined);
  assert.equal(session.teams.length, 8);
});

test("容量、文本、地点、角色与北京时间上下界按同一校验执行", () => {
  const { state } = fixture();
  for (const [capacity, valid] of [
    ["1", false],
    ["2", true],
    ["20", true],
    ["21", false],
    ["2.5", false],
  ]) {
    assert.equal(
      !validateDraft({ ...state.draft, capacity }, now).capacity,
      valid,
    );
  }
  for (const deadline of [
    "2026-02-30T12:00",
    "2026-10-20T12:00",
    "2026-10-21T",
    "2026-10-21T24:00",
  ])
    assert.ok(validateDraft({ ...state.draft, deadline }, now).deadline);
  for (const [key, values] of Object.entries({
    title: ["一", "字".repeat(61)],
    goal: ["不足十字", "字".repeat(2001)],
    progress: ["字".repeat(501)],
    skills: ["字".repeat(501)],
    location: ["字".repeat(201)],
  })) {
    for (const value of values)
      assert.ok(validateDraft({ ...state.draft, [key]: value }, now)[key]);
  }
  assert.equal(
    Object.keys(
      validateDraft(
        {
          ...state.draft,
          title: "标题",
          goal: "字".repeat(2000),
          progress: "字".repeat(500),
          skills: "字".repeat(500),
          location: "字".repeat(200),
        },
        now,
      ),
    ).length,
    0,
  );
  assert.ok(
    validateDraft({ ...state.draft, mode: "offline", location: " " }, now)
      .location,
  );
  assert.ok(validateDraft({ ...state.draft, roles: [] }, now).roles);
});
