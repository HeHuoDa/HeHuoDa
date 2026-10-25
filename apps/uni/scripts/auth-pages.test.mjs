import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
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

test("登录页按平台分支：小程序挂微信面板，H5 保留未开放表单", () => {
  const source = read("pages/auth/login.vue");
  const weixin = preprocess(source, "MP-WEIXIN");
  const h5 = preprocess(source, "H5");
  assert.match(weixin, /<WechatLoginPanel :return-to="returnTo" \/>/);
  assert.doesNotMatch(weixin, /<AuthForm mode="login" \/>/);
  assert.match(h5, /<AuthForm mode="login" \/>/);
  assert.doesNotMatch(h5, /WechatLoginPanel/);
  // 页面只负责组合，不复制表单校验或登录实现。
  for (const platform of [weixin, h5]) {
    assert.match(platform, /<AuthBrandLayout>/);
    assert.doesNotMatch(platform, /AUTH_MESSAGES|validateField|validateValues/);
    assert.doesNotMatch(platform, /待开发|将在后续任务迁移/);
  }
});

test("注册页在小程序自动跳统一登录页，H5 保留原注册表单", () => {
  const source = read("pages/auth/register.vue");
  const weixin = preprocess(source, "MP-WEIXIN");
  const h5 = preprocess(source, "H5");
  // 跳转调用写在 onLoad 内，H5 分支只保留表单。
  assert.match(weixin, /\n {2}redirectToLogin\(\);/);
  assert.doesNotMatch(weixin, /<AuthForm mode="register" \/>/);
  assert.match(h5, /<AuthForm mode="register" \/>/);
  assert.doesNotMatch(h5, /\n {2}redirectToLogin\(\);/);
  assert.match(h5, /<AuthBrandLayout>/);
});

test("统一登录页地址只携带合法返回目标", async () => {
  // 导航模块内部使用无扩展名导入，需在 loader 注册后动态加载。
  const { withQuery } = await import("../src/navigation/navigate.ts");
  const { routePath } = await import("../src/navigation/routes.ts");
  assert.equal(
    withQuery(routePath("login"), { returnTo: "team-new" }),
    "/pages/auth/login?returnTo=team-new",
  );
  assert.equal(withQuery(routePath("login")), "/pages/auth/login");
});

test("微信登录面板不使用 DOM、浏览器存储与浏览器表单", () => {
  const weixin = preprocess(
    read("components/WechatLoginPanel.vue"),
    "MP-WEIXIN",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(
    weixin,
    /\b(?:document|window|localStorage|sessionStorage)\s*\.|querySelector|<form|showModal|history\./,
  );
  // 只允许跨端能力，不直接调用微信专有登录接口或索取手机号/头像。
  assert.doesNotMatch(
    weixin,
    /wx\.login|wx\.request|getUserProfile|getPhoneNumber/,
  );
});

test("认证表单在微信分支不使用 DOM 查询、浏览器表单与 dialog", () => {
  for (const file of ["components/AuthForm.vue", "forms/auth-form.ts"]) {
    const weixin = preprocess(read(file), "MP-WEIXIN")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(
      weixin,
      /\b(?:document|window|localStorage|sessionStorage)\s*\.|querySelector|<form|showModal|history\./,
      file,
    );
  }
});

test("提交只绑定提交按钮与单行输入 confirm，显隐和发送验证码不触发表单动作", () => {
  const source = read("components/AuthForm.vue");
  const template = source.slice(
    source.indexOf("<template>"),
    source.indexOf("</template>"),
  );
  // 不使用 HTML form 元素：显隐与发送验证码在结构上无法触发提交。
  assert.doesNotMatch(template, /<form|@submit|type="submit"/);
  // 提交入口只有三处：提交按钮点击（不含发送验证码）、密码框（仅登录）与验证码框的 confirm。
  assert.match(template, /@click="submit"/, "提交按钮");
  assert.match(
    template,
    /@confirm="registering \? undefined : submit\(\)"/,
    "登录密码框 Enter",
  );
  assert.match(template, /@confirm="submit\(\)"/, "验证码框 Enter");
  const enterHandlers = [...template.matchAll(/@confirm="([^"]*)"/g)].map(
    ([, handler]) => handler,
  );
  assert.deepEqual(
    enterHandlers.map((handler) => /submit\(\)/.test(handler)),
    [true, true],
    "只有密码框与验证码框可用 Enter 提交",
  );
  // 发送验证码只调用 sendCode，不调用 submit。
  assert.match(template, /@click="sendCode"/);
  assert.doesNotMatch(
    template,
    /@click="sendCode[^"]*submit/,
    "发送验证码不得触发提交",
  );
});

test("认证表单反馈区承担 role=status，切换链接可键盘操作", () => {
  const source = read("components/AuthForm.vue");
  assert.match(source, /role="status"/);
  assert.match(source, /aria-live="polite"/);
  // 微信没有 aria-live 与浏览器键盘事件，链接用点击 + 键盘触发同一入口。
  assert.match(source, /@keydown\.enter\.prevent="switchMode"/);
  assert.match(source, /@click="switchMode"/);
  assert.match(source, /role="link"/);
});
