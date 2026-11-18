import assert from "node:assert/strict";
import { after, test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { preprocess } from "./component-host.mjs";

const read = (path) =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const loader = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && !extname(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return next(url.href, context);
    }
    return next(specifier, context);
  },
});
after(() => loader.deregister());

test("登录与注册页在两端都只说明认证未开放，不渲染凭据表单", () => {
  for (const [file, expect] of [
    ["pages/auth/login.vue", /统一身份认证登录即将开放/],
    ["pages/auth/register.vue", /暂不开放单独注册/],
  ]) {
    const source = read(file);
    for (const platform of ["H5", "MP-WEIXIN"]) {
      const view = preprocess(source, platform);
      assert.match(view, /<AuthBrandLayout>/, file);
      assert.match(view, /<AuthPendingNotice/, file);
      assert.match(view, expect, file);
      // M1 不提供任何登录渠道：旧微信面板、邮箱表单都已移除。
      assert.doesNotMatch(
        view,
        /AuthForm|WechatLoginPanel|<form|type="password"/,
        file,
      );
    }
  }
});

test("认证说明组件不收集凭据，也不调用认证接口", () => {
  const source = read("components/AuthPendingNotice.vue");
  assert.match(source, /function goBack/);
  for (const pattern of [
    /password/i,
    /verificationCode/,
    /uni\.request/,
    /api\/auth/,
    /<input|<form/,
    /localStorage|sessionStorage/,
  ])
    assert.doesNotMatch(source, pattern);
  // 返回目标仍只接受注册表内页面。
  assert.match(source, /resolveReturnTarget/);
  assert.match(source, /backOrHome/);
});

test("统一登录页地址只携带合法返回目标", async () => {
  const { withQuery } = await import("../src/navigation/navigate.ts");
  const { routePath } = await import("../src/navigation/routes.ts");
  assert.equal(
    withQuery(routePath("login"), { returnTo: "team-new" }),
    "/pages/auth/login?returnTo=team-new",
  );
  assert.equal(withQuery(routePath("login")), "/pages/auth/login");
});

test("返回目标只接受注册表内的平台页面", async () => {
  const { resolveReturnTarget } =
    await import("../src/navigation/return-target.ts");
  assert.equal(resolveReturnTarget("team-new"), "team-new");
  assert.equal(resolveReturnTarget("/pages/teams/new"), "team-new");
  assert.equal(
    resolveReturnTarget("/pages/home/competition?id=abc"),
    "competition-detail",
  );
  for (const raw of [
    "https://evil.example.com",
    "//evil.example.com",
    "weixin://dl/business",
    "javascript:alert(1)",
    "login",
    "register",
    "not-found",
    "pages/unknown/index",
    "",
    null,
    42,
  ])
    assert.equal(resolveReturnTarget(raw), null, String(raw));
});
