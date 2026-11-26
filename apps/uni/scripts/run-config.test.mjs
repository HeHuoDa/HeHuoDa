import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { invocation, runConfig } from "./run-config.mjs";

const fakeRoot = resolve("/repo/apps/uni");
const template = readFileSync(
  new URL("../manifest.template.json", import.meta.url),
  "utf8",
);
const plan = (command, platform, env) =>
  runConfig({
    command,
    platform,
    root: fakeRoot,
    env: { manifestTemplate: template, ...env },
  });
const appPlan = (command = "build", env = {}) =>
  plan(command, "app", {
    VITE_API_BASE_URL: "https://api.example.test/api/v1",
    ...env,
  });
const spawnFor = (command, platform, args, processEnv = {}, env = {}) => {
  const result = plan(command, platform, env);
  return {
    ...invocation({
      command,
      platform,
      mode: result.mode,
      args,
      plan: result,
      processEnv,
    }),
    plan: result,
    processEnv,
  };
};

test("App 构建使用 production mode、App-Plus 资源目录与校验后的 HTTPS 地址", () => {
  const result = appPlan("build", {
    VITE_API_BASE_URL: "https://api.example.test/api/v1/",
  });
  assert.equal(result.mode, "production");
  assert.equal(result.env.NODE_ENV, "production");
  assert.equal(result.env.VITE_API_BASE_URL, "https://api.example.test/api/v1");
  assert.equal(result.outDir, resolve(fakeRoot, "dist", "build", "app"));
  assert.equal(result.inDir, resolve(fakeRoot, "src"));
  assert.equal(
    result.manifest["app-plus"].distribute.android.packagename,
    "com.example.hehuoda",
  );
});

test("App 开发同样要求 HTTPS，只切换 mode 与产物目录", () => {
  const result = appPlan("dev");
  assert.equal(result.mode, "development");
  assert.equal(result.env.NODE_ENV, "development");
  assert.equal(result.outDir, resolve(fakeRoot, "dist", "dev", "app"));
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

test("App 子进程的实际参数与 env：平台、mode 与输入/输出目录都由脚本固定", () => {
  const { args, env } = spawnFor(
    "build",
    "app",
    [],
    { UNI_PLATFORM: "h5", UNI_OUTPUT_DIR: "" },
    { VITE_API_BASE_URL: "https://api.example.test/api/v1" },
  );
  // 参数里不得出现可覆盖平台/mode 以外的项目，且平台与 mode 由脚本写入。
  assert.deepEqual(args, ["build", "-p", "app", "-m", "production"]);
  assert.equal(env.UNI_INPUT_DIR, resolve(fakeRoot, "src"));
  assert.equal(env.UNI_OUTPUT_DIR, resolve(fakeRoot, "dist", "build", "app"));
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.VITE_API_BASE_URL, "https://api.example.test/api/v1");
  // 预检与子进程使用同一份超时（默认沿用运行期默认 5000）。
  assert.equal(env.VITE_API_TIMEOUT_MS, "5000");
  // 开发入口同样固定为 development。
  const dev = spawnFor(
    "dev",
    "app",
    [],
    {},
    { VITE_API_BASE_URL: "https://api.example.test/api/v1" },
  );
  assert.deepEqual(dev.args, ["-p", "app", "-m", "development"]);
  assert.equal(dev.env.UNI_OUTPUT_DIR, resolve(fakeRoot, "dist", "dev", "app"));
});

test("App 入口拒绝额外 CLI 参数与环境覆盖，避免报告目录与真实产物不一致", () => {
  const validEnv = { VITE_API_BASE_URL: "https://api.example.test/api/v1" };
  for (const args of [
    ["--outDir", "dist/elsewhere"],
    ["-p", "h5"],
    ["-m", "staging"],
    ["--emptyOutDir"],
    ["--subpackage", "ext"],
  ]) {
    assert.throws(
      () => spawnFor("build", "app", args, {}, validEnv),
      /不接受额外 CLI 参数/,
      args.join(" "),
    );
  }
  for (const key of [
    "UNI_OUTPUT_DIR",
    "UNI_INPUT_DIR",
    "UNI_SUBPACKAGE",
    "UNI_SUBPACKGE",
    "UNI_MP_PLUGIN",
  ]) {
    assert.throws(
      () =>
        spawnFor("build", "app", [], { [key]: "C:/tmp/override" }, validEnv),
      /不接受.*覆盖/,
      key,
    );
  }
});

test("H5 与遗留小程序保持旧入口的参数透传与进程 env 优先级", () => {
  const h5 = spawnFor("build", "h5", ["--outDir", "custom"], {
    VITE_API_BASE_URL: "/api/v1",
  });
  // 旧入口参数原样透传，且不额外注入 -m。
  assert.deepEqual(h5.args, ["build", "-p", "h5", "--outDir", "custom"]);
  // 子进程环境就是进程环境本身（不从默认 mode 读出的 .env 反向覆盖自定义 mode）。
  assert.equal(h5.env, h5.processEnv);
  assert.equal("UNI_OUTPUT_DIR" in h5.env, false);
  assert.equal("UNI_INPUT_DIR" in h5.env, false);

  const weixin = spawnFor("dev", "mp-weixin", [], {
    VITE_API_BASE_URL: "http://127.0.0.1:3001/api",
  });
  assert.deepEqual(weixin.args, ["-p", "mp-weixin"]);
  assert.equal(weixin.plan.mode, "development");
});

test("H5 构建保持原行为：不打 App 标记、不改写 API 地址", () => {
  const result = plan("build", "h5", {});
  assert.equal(result.mode, "production");
  assert.equal(result.outDir, "");
  assert.equal(result.inDir, "");
  // 未配置时不再向子进程注入空字符串（那会覆盖 .env 之外的默认行为）。
  assert.equal("VITE_API_BASE_URL" in result.env, false);
  assert.equal(result.manifest["mp-weixin"].appid, "");
  const relative = plan("build", "h5", { VITE_API_BASE_URL: "/api/v1" });
  assert.equal(relative.env.VITE_API_BASE_URL, "/api/v1");
});

test("H5 构建在正式开关与遗留 AppID 存在时仍能生成编译计划", () => {
  // 缺陷复现：H5 曾落入微信 AppID 校验，正式构建被已退役平台卡死。
  const result = plan("build", "h5", {
    UNI_RELEASE: "true",
    UNI_MP_WEIXIN_APPID: "touristappid",
    VITE_API_BASE_URL: "/api/v1",
  });
  assert.equal(result.config.appid, "");
  assert.equal(result.config.release, true);
  assert.equal(result.manifest["mp-weixin"].appid, "");
  assert.equal(result.env.VITE_API_BASE_URL, "/api/v1");
});

test("App 构建忽略无效的遗留微信 AppID", () => {
  const result = appPlan("build", {
    UNI_MP_WEIXIN_APPID: "touristappid",
    UNI_ANDROID_PACKAGE_NAME: "cn.edu.sicau.hehuoda",
  });
  assert.equal(result.config.appid, "");
  assert.equal(
    result.manifest["app-plus"].distribute.android.packagename,
    "cn.edu.sicau.hehuoda",
  );
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
