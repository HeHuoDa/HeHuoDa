import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pageRouteQuery,
  resolveH5Address,
} from "../src/navigation/h5-address.ts";

test("旧比赛链接转换成原生页面，筛选规范化且赛段不被路由 hash 吞掉", () => {
  assert.equal(
    resolveH5Address(
      "https://example.test/home/competitions/demo-1?q=%20%E4%B8%AD%E6%96%87%20&page=2&page=9&category=old&eligible=old&utm=a&utm=b#stage-1",
    ),
    "/pages/home/competition?utm=a&utm=b&id=demo-1&stage=stage-1&hosts=all&q=%E4%B8%AD%E6%96%87&page=2",
  );
});

test("H5 页面参数读取只解码一次，保留问号与重复附加参数", () => {
  const original = globalThis.location;
  globalThis.location = { hash: "#/pages/teams/detail?id=%252F&utm=a?b&utm=c" };
  try {
    assert.deepEqual(pageRouteQuery({ id: "/", utm: "a?b,c" }), {
      id: "%2F",
      utm: ["a?b", "c"],
    });
    assert.equal(
      resolveH5Address("https://example.test/teams/demo-1?utm=a?b"),
      "/pages/teams/detail?utm=a%3Fb&id=demo-1",
    );
    assert.equal(
      resolveH5Address("https://example.test/#/"),
      "/pages/index/index?hosts=all",
    );
  } finally {
    if (original === undefined) delete globalThis.location;
    else globalThis.location = original;
  }
});

test("完整历史地址清单与未知页面可独立转换，旧固定分区优先", () => {
  for (const [source, target] of [
    ["/", "/pages/index/index?hosts=all"],
    ["/home", "/pages/index/index?hosts=all"],
    ["/teams", "/pages/teams/index"],
    ["/teams/new", "/pages/teams/new"],
    ["/teams/demo-1", "/pages/teams/detail?id=demo-1"],
    ["/profile", "/pages/profile/index"],
    ["/my/teams?section=applications", "/pages/profile/index?section=teams"],
    ["/my/applications", "/pages/profile/index?section=applications"],
    ["/my/favorites", "/pages/my/favorites"],
    ["/notifications", "/pages/notifications/index"],
    ["/about", "/pages/about/index"],
    ["/login", "/pages/auth/login"],
    ["/register", "/pages/auth/register"],
    ["/health", "/pages/health/index"],
    ["/unknown", "/pages/not-found/index"],
    ["/#/unknown", "/pages/not-found/index"],
    ["/#unknown", "/pages/not-found/index"],
  ])
    assert.equal(resolveH5Address(`https://example.test${source}`), target);
});

test("编码 ID 和合法附加参数只解码一次，原生页面地址规范化幂等", () => {
  const target = resolveH5Address(
    "https://example.test/teams/%E4%B8%AD%252F?utm=%252F&role=bad&page=-1",
  );
  assert.equal(target, "/pages/teams/detail?utm=%252F&id=%E4%B8%AD%252F");
  assert.equal(resolveH5Address(`https://example.test/#${target}`), target);
  assert.equal(
    resolveH5Address("https://example.test/teams/%XX"),
    "/pages/not-found/index",
  );
  assert.equal(
    resolveH5Address(
      "https://example.test/my/applications?recordId=history-0&revision=2",
    ),
    "/pages/profile/index?recordId=history-0&revision=2&section=applications",
  );
});

test("旧比赛详情转换后刷新地址稳定，原生页面不重排已规范化参数", () => {
  const target = resolveH5Address(
    "https://example.test/home/competitions/demo-1?q=test#stage-1",
  );
  assert.equal(resolveH5Address(`https://example.test/#${target}`), target);
});
