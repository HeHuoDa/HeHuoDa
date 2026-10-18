import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  resolveSourceAddress,
  routeRegistry,
  sourceRoutes,
  tabRoutes,
} from "../src/navigation/routes.ts";
import {
  parseBusinessId,
  parseProfileSection,
  parseSingleParam,
  paramMessage,
} from "../src/navigation/params.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
/** 去掉注释，避免说明文字命中断言 */
const code = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const pages = JSON.parse(read("src/pages.json"));
const theme = read("src/styles/theme.css");
const routes = Object.values(routeRegistry);
const themeColor = (token) => {
  const value = theme.match(
    new RegExp(`--hhr-color-${token}:\\s*(#[0-9a-f]{3,6});`),
  )?.[1];
  if (!value) return undefined;
  return value.length === 4
    ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
    : value;
};

function listFiles(dir, extensions) {
  return readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap(
    (item) => {
      const path = `${dir}/${item.name}`;
      if (item.isDirectory()) return listFiles(path, extensions);
      return extensions.some((extension) => item.name.endsWith(extension))
        ? [path]
        : [];
    },
  );
}

test("导航注册表与 pages.json 双向一致，标题同源", () => {
  const pagePaths = pages.pages.map((page) => page.path);
  assert.equal(
    new Set(pagePaths).size,
    pagePaths.length,
    "pages.json 路径重复",
  );
  const registryPaths = routes.map((route) => route.path.slice(1));
  assert.deepEqual([...registryPaths].sort(), [...pagePaths].sort());

  for (const route of routes) {
    const page = pages.pages.find((item) => item.path === route.path.slice(1));
    assert.ok(page, `${route.name} 未在 pages.json 注册`);
    assert.equal(
      page.style?.navigationBarTitleText,
      route.title,
      `${route.name} 标题与注册表不一致`,
    );
    assert.ok(
      existsSync(resolve(root, `src${route.path}.vue`)),
      `${route.name} 缺少页面文件`,
    );
  }
});

test("主导航使用 tabBar 三项，颜色与主题一致", () => {
  assert.deepEqual(
    pages.tabBar.list.map((item) => item.text),
    tabRoutes.map((item) => item.text),
  );
  assert.equal(pages.tabBar.list.length, 3, "主导航保持三项");
  for (const [index, item] of pages.tabBar.list.entries()) {
    const route = routeRegistry[tabRoutes[index].name];
    assert.equal(item.pagePath, route.path.slice(1));
    assert.equal(route.kind, "tab");
  }
  assert.deepEqual(
    routes
      .filter((route) => route.kind === "tab")
      .map((route) => route.name)
      .sort(),
    tabRoutes.map((item) => item.name).sort(),
  );
  assert.equal(pages.tabBar.color, themeColor("muted"));
  assert.equal(pages.tabBar.selectedColor, themeColor("brand"));
  assert.equal(pages.tabBar.backgroundColor, themeColor("surface"));
});

test("旧 Web 路由映射清单完整，未迁移项写明原因", () => {
  const expectedSources = [
    "/",
    "/home",
    "/home/competitions/:id",
    "/teams",
    "/teams/new",
    "/teams/:id",
    "/my/teams",
    "/my/applications",
    "/my/favorites",
    "/notifications",
    "/profile",
    "/login",
    "/register",
    "/health",
    "*",
  ];
  assert.deepEqual(
    sourceRoutes.map((route) => route.source),
    expectedSources,
  );
  for (const route of sourceRoutes) {
    if (route.target === null) {
      assert.ok(route.note, `${route.source} 未迁移时必须写明原因`);
      continue;
    }
    assert.ok(routeRegistry[route.target], `${route.source} 目标不存在`);
  }
});

test("旧地址解析：静态、动态、旧个人中心分区与未知地址", () => {
  const cases = [
    ["/", "home", {}],
    ["/home", "home", {}],
    ["/home/", "home", {}],
    ["/home/competitions/abc123", "competition-detail", { id: "abc123" }],
    ["/home/competitions/preview", "competition-detail", { id: "preview" }],
    ["/teams", "teams", {}],
    ["/teams/new", "team-new", {}],
    ["/teams/demo-1", "team-detail", { id: "demo-1" }],
    ["/my/teams", "profile", {}],
    ["/my/applications", "profile", {}],
    ["/my/favorites", "favorites", {}],
    ["/notifications", "notifications", {}],
    ["/login", "login", {}],
    ["/register", "register", {}],
    ["/unknown", "not-found", {}],
    ["/home/competitions/", "not-found", {}],
    ["/teams/new/extra", "not-found", {}],
  ];
  for (const [source, name, params] of cases) {
    const resolved = resolveSourceAddress(source);
    assert.equal(resolved.name, name, `${source} 应解析为 ${name}`);
    assert.deepEqual(resolved.params, params, `${source} 参数不一致`);
  }

  assert.equal(resolveSourceAddress("/my/teams").section, "teams");
  assert.equal(
    resolveSourceAddress("/my/applications").section,
    "applications",
  );
  assert.equal(resolveSourceAddress("/profile").section, "profile");
  assert.equal(
    resolveSourceAddress("/profile", { section: "teams" }).section,
    "teams",
  );
  assert.equal(
    resolveSourceAddress("/profile", { section: "bogus" }).section,
    "profile",
  );
});

test("旧个人中心映射保留附加 query，固定分区不被 query 覆盖", () => {
  for (const [path, section] of [
    ["/my/teams", "teams"],
    ["/my/applications", "applications"],
  ]) {
    const query = { section: "bogus", keep: "x", page: "2", tag: ["a", "b"] };
    const resolved = resolveSourceAddress(path, query);
    assert.equal(resolved.section, section);
    assert.deepEqual(resolved.query, { keep: "x", page: "2", tag: ["a", "b"] });
    query.tag.push("changed");
    assert.deepEqual(resolved.query.tag, ["a", "b"]);
  }
});

test("参数解析：缺失、重复一致、重复冲突与非法业务 ID", () => {
  assert.deepEqual(parseSingleParam(undefined), {
    value: "",
    issue: "missing",
  });
  assert.deepEqual(parseSingleParam("  "), { value: "", issue: "missing" });
  assert.deepEqual(parseSingleParam([]), { value: "", issue: "missing" });
  assert.deepEqual(parseSingleParam(["abc", " abc "]), { value: "abc" });
  assert.deepEqual(parseSingleParam(["abc", "abd"]), {
    value: "",
    issue: "conflict",
  });
  // uni-app H5 会把重复键合并成逗号串
  assert.deepEqual(parseSingleParam("abc,abc"), { value: "abc" });
  assert.deepEqual(parseSingleParam("abc,abd"), {
    value: "",
    issue: "conflict",
  });
  assert.deepEqual(parseSingleParam(42), { value: "", issue: "invalid" });

  assert.deepEqual(parseBusinessId("demo-1"), { value: "demo-1" });
  assert.deepEqual(parseBusinessId("12345"), { value: "12345" });
  for (const invalid of ["-abc", "a b", "中文", "a".repeat(65), "a/b"]) {
    assert.equal(parseBusinessId(invalid).issue, "invalid", invalid);
  }
  assert.equal(parseBusinessId(undefined).issue, "missing");

  assert.equal(
    paramMessage("missing", "比赛"),
    "缺少比赛参数，无法确定要查看的内容。",
  );
  assert.match(paramMessage("invalid", "比赛"), /比赛参数无效/);
  assert.match(paramMessage("conflict", "比赛"), /重复且取值不一致/);
});

test("个人中心分区只接受 teams / applications，其余回落到资料区", () => {
  assert.deepEqual(parseProfileSection(undefined), { section: "profile" });
  assert.deepEqual(parseProfileSection("teams"), { section: "teams" });
  assert.deepEqual(parseProfileSection("applications"), {
    section: "applications",
  });
  assert.deepEqual(parseProfileSection("bogus"), {
    section: "profile",
    issue: "invalid",
  });
  assert.deepEqual(parseProfileSection(""), {
    section: "profile",
    issue: "invalid",
  });
  assert.deepEqual(parseProfileSection(["teams", "applications"]), {
    section: "profile",
    issue: "conflict",
  });
  assert.deepEqual(parseProfileSection("teams,teams"), { section: "teams" });
  assert.deepEqual(parseProfileSection("teams,applications"), {
    section: "profile",
    issue: "conflict",
  });
});

test("页面跳转只走统一入口，不依赖浏览器 History 与 document.title", () => {
  const sources = listFiles("src", [".vue", ".ts"]);
  assert.ok(sources.length > 0);
  for (const file of sources) {
    const source = code(read(file));
    if (file !== "src/navigation/navigate.ts") {
      assert.ok(
        !/\buni\.(?:navigateTo|switchTab|redirectTo|reLaunch|navigateBack)\b/.test(
          source,
        ),
        `${file} 应通过 navigation/navigate.ts 跳转`,
      );
    }
    assert.ok(
      !/\b(?:document|window)\s*\./.test(source),
      `${file} 不应依赖浏览器 document / window`,
    );
    assert.ok(
      !/apps\/web|\.\.\/\.\.\/web\//.test(source),
      `${file} 不应跨应用导入旧 Web 源码`,
    );
  }
});
