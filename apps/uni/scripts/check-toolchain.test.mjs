import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * 工具链检查只覆盖现行目标（H5 与 App-Plus）及其共用依赖。
 * 微信小程序已按 ADR 0011 退役，其遗留开关与遗留平台包都不再接受。
 */
const root = fileURLToPath(new URL("..", import.meta.url));
const script = fileURLToPath(new URL("./check-toolchain.mjs", import.meta.url));
const run = (...args) =>
  spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
  });

test("默认检查只覆盖 H5 与 App 及共用工具链，不校验微信专用运行时", () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /uni-h5-vue/);
  assert.match(result.stdout, /uni-app-vue/);
  assert.doesNotMatch(result.stdout, /uni-mp-vue/);
  assert.doesNotMatch(result.stdout, /uni-mp-weixin/);
});

test("已退役的遗留开关被明确拒绝，并提示现行有效目标", () => {
  const result = run("--include-legacy-weixin");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--include-legacy-weixin/);
  assert.match(result.stderr, /H5 与 App-Plus/);
});

test("未知参数被拒绝，避免静默忽略拼错的开关", () => {
  const result = run("--include-legacy");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /不接受任何参数|H5 与 App-Plus/);
});
