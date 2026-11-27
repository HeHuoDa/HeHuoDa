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

test("H5 登录与注册页均挂载统一学校登录面板，非 H5 保留暂缓说明且无旧微信面板", () => {
  for (const [file, entry, nonH5Text] of [
    ["pages/auth/login.vue", 'entry="login"', /统一身份认证登录即将开放/],
    ["pages/auth/register.vue", 'entry="register"', /暂不开放单独注册/],
  ]) {
    const source = read(file);
    const h5View = preprocess(source, "H5");
    assert.match(h5View, /<AuthBrandLayout>/, file);
    assert.match(h5View, /<SchoolLoginPanel/, file);
    assert.match(h5View, new RegExp(entry), file);
    assert.doesNotMatch(
      h5View,
      /WechatLoginPanel|AuthPendingNotice|AuthForm/,
      file,
    );

    const nativeView = preprocess(source, "APP-PLUS");
    assert.match(nativeView, /<AuthBrandLayout>/, file);
    assert.match(nativeView, /<AuthPendingNotice/, file);
    assert.match(nativeView, nonH5Text, file);
    assert.doesNotMatch(
      nativeView,
      /AuthForm|WechatLoginPanel|SchoolLoginPanel/,
      file,
    );
  }
});

test("认证说明组件（非 H5 回退）不收集凭据，也不调用认证接口", () => {
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
