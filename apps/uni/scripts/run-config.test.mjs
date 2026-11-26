import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runConfig } from "./run-config.mjs";

const template = readFileSync(
  new URL("../manifest.template.json", import.meta.url),
  "utf8",
);
const plan = (command, platform, env) =>
  runConfig({
    command,
    platform,
    root: "C:/repo/apps/uni",
    env: { manifestTemplate: template, ...env },
  });

test("App 构建使用 production mode、App-Plus 资源目录与校验后的 HTTPS 地址", () => {
  const result = plan("build", "app", {
    VITE_API_BASE_URL: "https://api.example.test/api/v1/",
  });
  assert.equal(result.mode, "production");
  assert.equal(result.env.NODE_ENV, "production");
  assert.equal(result.env.VITE_API_BASE_URL, "https://api.example.test/api/v1");
  assert.equal(
    result.outDir.replaceAll("\\", "/"),
    "C:/repo/apps/uni/dist/build/app",
  );
  assert.equal(
    result.manifest["app-plus"].distribute.android.packagename,
    "com.example.hehuoda",
  );
});

test("App 开发同样要求 HTTPS，只切换 mode 与产物目录", () => {
  const result = plan("dev", "app", {
    VITE_API_BASE_URL: "https://api.example.test/api/v1",
  });
  assert.equal(result.mode, "development");
  assert.equal(result.env.NODE_ENV, "development");
  assert.equal(
    result.outDir.replaceAll("\\", "/"),
    "C:/repo/apps/uni/dist/dev/app",
  );
  assert.throws(
    () =>
      plan("dev", "app", { VITE_API_BASE_URL: "http://api.example.test/api" }),
    /https/,
  );
});

test("App 构建拒绝缺失 API 地址，且不产出编译计划", () => {
  assert.throws(() => plan("build", "app", {}), /VITE_API_BASE_URL/);
  assert.throws(
    () => plan("build", "app", { VITE_API_BASE_URL: "/api/v1" }),
    /VITE_API_BASE_URL/,
  );
});

test("H5 构建保持原行为：不打 App 标记、不改写 API 地址", () => {
  const result = plan("build", "h5", {});
  assert.equal(result.mode, "production");
  assert.equal(result.outDir, "");
  // 未配置时不再向子进程注入空字符串（那会覆盖 .env 之外的默认行为）。
  assert.equal("VITE_API_BASE_URL" in result.env, false);
  assert.equal(result.manifest["mp-weixin"].appid, "");
  const relative = plan("build", "h5", { VITE_API_BASE_URL: "/api/v1" });
  assert.equal(relative.env.VITE_API_BASE_URL, "/api/v1");
});

test("微信 release 回归：仍要求 UNI_MP_WEIXIN_APPID，App 目标接受同一环境", () => {
  assert.throws(
    () => plan("build", "mp-weixin", { UNI_RELEASE: "true" }),
    /缺少/,
  );
  const weixin = plan("build", "mp-weixin", {
    UNI_RELEASE: "true",
    UNI_MP_WEIXIN_APPID: "wx1234567890abcdef",
  });
  assert.equal(weixin.manifest["mp-weixin"].appid, "wx1234567890abcdef");
  const app = plan("build", "app", {
    UNI_RELEASE: "true",
    VITE_API_BASE_URL: "https://api.example.test/api/v1",
    UNI_ANDROID_PACKAGE_NAME: "cn.edu.sicau.hehuoda",
  });
  assert.equal(app.config.release, true);
  assert.equal(app.config.appid, "");
});

test("不支持的命令与平台被拒绝", () => {
  assert.throws(() => plan("serve", "app", {}), /用法/);
  assert.throws(() => plan("build", "mp-alipay", {}), /用法/);
});
