import assert from "node:assert/strict";
import { test } from "node:test";
import { createHttpClient } from "../src/api/http.ts";
import {
  createCompetitionApi,
  isCompetitionList,
  isCollegeDirectory,
} from "../src/api/competition-client.ts";

test("公开比赛查询保留显式空学院，清洗关键词并固定每页四条", async () => {
  const calls = [];
  const http = createHttpClient(
    (options) => {
      calls.push(options);
      return { abort() {} };
    },
    () => ({ baseUrl: "/api/v1", timeout: 5000 }),
  );
  const request = createCompetitionApi(http).list({
    hosts: [],
    q: " 春季 ",
    status: "open",
    page: 3,
  });
  assert.equal(
    calls[0].url,
    "/api/v1/competitions?hosts=&q=%E6%98%A5%E5%AD%A3&status=open&page=3&pageSize=4",
  );
  calls[0].success({
    statusCode: 200,
    data: {
      items: [],
      page: 1,
      pageSize: 4,
      hasMore: false,
      totalStages: 0,
      totalCompetitions: 0,
      totalPages: 1,
      evaluatedAt: "2026-10-19T00:00:00Z",
    },
  });
  assert.equal((await request.promise).totalStages, 0);
});

test("无效计数、分页、时间与卡片内容拒绝，不把损坏响应显示为空结果", () => {
  const valid = {
    items: [],
    page: 1,
    pageSize: 4,
    hasMore: false,
    totalStages: 0,
    totalCompetitions: 0,
    totalPages: 1,
    evaluatedAt: "2026-10-19T00:00:00Z",
  };
  assert.equal(isCompetitionList(valid), true);
  for (const patch of [
    { totalStages: -1 },
    { totalStages: 5 },
    { totalCompetitions: 1 },
    { page: 2 },
    { pageSize: 20 },
    { hasMore: true },
    { totalPages: 0 },
    { evaluatedAt: "无效日期" },
    { items: [{}] },
  ])
    assert.equal(
      isCompetitionList({ ...valid, ...patch }),
      false,
      JSON.stringify(patch),
    );
  assert.equal(isCollegeDirectory([{ id: "a", name: "学院", order: 0 }]), true);
  assert.equal(
    isCollegeDirectory([{ id: "a", name: "学院", order: "0" }]),
    false,
  );
});
