import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createHttpClient,
  RequestError,
  requestErrorMessage,
} from "../src/api/http.ts";
import { createHealthApi } from "../src/api/health.ts";
import { createCompetitionApi } from "../src/api/competition-client.ts";
import {
  initialTeamPublishState,
  createTeamPublishController,
} from "../src/stores/team-publish-controller.ts";
import {
  createDetailController,
  initialDetailState,
} from "../src/stores/detail-controller.ts";
import {
  createDiscoveryController,
  initialDiscoveryState,
} from "../src/stores/discovery-controller.ts";
import {
  createFavoritesController,
  initialFavoritesState,
} from "../src/stores/favorites-controller.ts";
import {
  createHealthController,
  initialHealthState,
} from "../src/stores/health-controller.ts";
import { parseFilters } from "@hehuoda/client-domain/competition-discovery";

function platform() {
  const calls = [];
  const http = createHttpClient(
    (options) => {
      calls.push(options);
      return { abort() {} };
    },
    () => ({ baseUrl: "https://api.example.test/api/v1", timeout: 5000 }),
  );
  return { calls, http };
}

test("公开查询安全反馈区分无效参数、资源失效、频率限制与服务失败", () => {
  for (const [statusCode, message] of [
    [400, "请求参数无效，请调整条件后重试。"],
    [404, "请求的资源不存在或未公开。"],
    [429, "请求过于频繁，请稍后重试。"],
    [500, "服务暂时不可用，请稍后重试。"],
    [503, "服务暂时不可用，请稍后重试。"],
  ]) {
    const error = new RequestError("http", "内部实现信息", { statusCode });
    assert.equal(requestErrorMessage(error), message);
    assert.equal(error.message, "内部实现信息", "保留原始错误供契约调用方读取");
  }
  assert.equal(
    requestErrorMessage(
      new RequestError("network", "暂时无法连接服务，请稍后重试。"),
    ),
    "暂时无法连接服务，请稍后重试。",
  );
  assert.equal(
    requestErrorMessage(new Error("内部实现信息")),
    "加载失败，请稍后重试。",
  );
});

test("健康与比赛查询共用注入的跨端传输入口及非 2xx 错误契约", async () => {
  const { calls, http } = platform();
  const health = createHealthApi(http).getHealth();
  assert.equal(calls[0].url, "https://api.example.test/api/v1/health");
  calls[0].success({
    statusCode: 200,
    data: { status: "ok", requestId: "health-78" },
  });
  assert.equal((await health.promise).requestId, "health-78");
  const directory = createCompetitionApi(http).colleges();
  assert.equal(calls[1].url, "https://api.example.test/api/v1/colleges");
  calls[1].success({
    statusCode: 429,
    data: {
      code: "RATE_LIMITED",
      message: "Too many requests",
      requestId: "limit-78",
      details: { retry: true },
    },
  });
  await assert.rejects(
    directory.promise,
    (error) =>
      error.statusCode === 429 &&
      error.requestId === "limit-78" &&
      error.details.retry === true,
  );
});

test("招募比赛选择保留错误请求编号，重试清理旧错误且 reset 后迟到结果无效", async () => {
  const { calls, http } = platform();
  const state = initialTeamPublishState();
  const controller = createTeamPublishController(
    state,
    { publish() {} },
    createCompetitionApi(http),
  );
  const search = controller.search();
  calls[0].success({
    statusCode: 429,
    data: { requestId: "search-limit", message: "internal" },
  });
  await search;
  assert.equal(state.searchError, "请求过于频繁，请稍后重试。");
  assert.equal(state.searchRequestId, "search-limit");
  assert.equal(state.items.length, 0);
  const retry = controller.retrySearch();
  assert.equal(state.searchError, "");
  assert.equal(state.searchRequestId, null);
  controller.reset();
  calls[1].success({ statusCode: 500, data: { requestId: "late" } });
  await retry;
  assert.deepEqual(state, initialTeamPublishState());
  const select = controller.select("hidden");
  calls[2].success({
    statusCode: 404,
    data: { requestId: "selection-missing" },
  });
  await select;
  assert.match(state.selectionError, /不存在或未公开/);
  assert.equal(state.selectionRequestId, "selection-missing");
  const unavailable = controller.select("visible");
  calls[3].success({
    statusCode: 503,
    data: { requestId: "selection-down", message: "internal" },
  });
  await unavailable;
  assert.equal(state.selectionError, "服务暂时不可用，请稍后重试。");
  assert.equal(state.selectionRequestId, "selection-down");
});

test("健康、首页、详情和收藏通过同一传输失败时均显示安全反馈及请求编号", async () => {
  const { calls, http } = platform();
  const api = createCompetitionApi(http);
  const healthState = initialHealthState();
  const discoveryState = initialDiscoveryState();
  const detailState = initialDetailState();
  const favoritesState = initialFavoritesState();
  const health = createHealthController(
    healthState,
    createHealthApi(http).getHealth,
  );
  const discovery = createDiscoveryController(discoveryState, api);
  const detail = createDetailController(detailState, api);
  const favorites = createFavoritesController(
    favoritesState,
    () => [{ id: "competition-a", order: 1 }],
    api,
  );
  const loads = [
    health.refresh(),
    discovery.load(),
    detail.load("competition-a"),
  ];
  favorites.start();
  for (const call of calls)
    call.success({
      statusCode: 503,
      data: {
        message: "database password/internal",
        requestId: "unavailable-78",
      },
    });
  await Promise.all(loads);
  await new Promise((resolve) => setImmediate(resolve));
  for (const message of [
    healthState.errorMessage,
    discoveryState.error,
    detailState.error,
    favoritesState.rows[0].error,
  ]) {
    assert.match(message, /服务暂时不可用/);
    assert.doesNotMatch(message, /database/);
  }
  for (const id of [
    healthState.requestId,
    discoveryState.requestId,
    detailState.requestId,
    favoritesState.rows[0].requestId,
  ])
    assert.equal(id, "unavailable-78");
  assert.equal(detailState.status, "error");
  assert.equal(favoritesState.rows[0].status, "error");
  assert.equal(discoveryState.response, null);
  favorites.stop();
});

test("跨端列表保留空/全部学院、去重自选优先和 URL 编码，客户端清洗独立于服务端拒绝", async () => {
  const { calls, http } = platform();
  const api = createCompetitionApi(http);
  const inputs = [
    [{}, "hosts=all&page=1&pageSize=4"],
    [{ hosts: "" }, "hosts=&page=1&pageSize=4"],
    [
      {
        hosts: ["all,law", "science,law"],
        q: " 中文 &+?/# ",
        status: "open",
        page: "3",
      },
      "hosts=science%2Claw&q=%E4%B8%AD%E6%96%87%20%26%2B%3F%2F%23&status=open&page=3&pageSize=4",
    ],
    [
      { q: "x".repeat(101), status: "", page: "9007199254740992" },
      `hosts=all&q=${"x".repeat(100)}&page=1&pageSize=4`,
    ],
  ];
  for (const [query, suffix] of inputs) {
    const request = api.list(parseFilters(query));
    assert.equal(
      calls.at(-1).url,
      "https://api.example.test/api/v1/competitions?" + suffix,
    );
    request.cancel();
    await assert.rejects(request.promise, (e) => e.kind === "cancelled");
  }
  // 直达 HTTP 边界的恶意/重复参数不再清洗，保留服务端的 400 语义。
  const raw = http.get("/competitions?q=a&q=b", () => true);
  assert.match(calls.at(-1).url, /q=a&q=b$/);
  calls.at(-1).success({
    statusCode: 400,
    data: { code: "BAD_REQUEST", requestId: "duplicate-78" },
  });
  await assert.rejects(
    raw.promise,
    (e) => e.statusCode === 400 && e.requestId === "duplicate-78",
  );
});

test("跨端公开查询取消后迟到成功/失败不改变结果，超时与断网保持独立错误", async () => {
  for (const endpoint of ["health", "colleges", "list", "detail"]) {
    const { calls, http } = platform();
    const api = createCompetitionApi(http);
    const request = () =>
      endpoint === "health"
        ? createHealthApi(http).getHealth()
        : endpoint === "list"
          ? api.list(parseFilters({}))
          : endpoint === "detail"
            ? api.detail("competition-a")
            : api.colleges();
    const cancelled = request();
    cancelled.cancel();
    calls[0].success({ statusCode: 200, data: {} });
    calls[0].fail({ errMsg: "request:fail network" });
    await assert.rejects(cancelled.promise, (e) => e.kind === "cancelled");
    for (const [errMsg, kind] of [
      ["request:fail timeout", "timeout"],
      ["request:fail offline", "network"],
    ]) {
      const pending = request();
      calls.at(-1).fail({ errMsg });
      await assert.rejects(pending.promise, (e) => e.kind === kind);
    }
  }
});
