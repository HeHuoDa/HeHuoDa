import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * 工具链检查默认只覆盖现行目标（H5 与 App-Plus）及其共用依赖。
 * 微信端已按 ADR 0011 退役，其专用包与内嵌运行时改由显式遗留开关校验。
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
});

test("显式遗留开关追加微信专用包与内嵌运行时校验", () => {
  const result = run("--include-legacy-weixin");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /uni-mp-vue/);
  assert.match(result.stdout, /uni-h5-vue/);
});

test("未知参数被拒绝，避免静默忽略拼错的开关", () => {
  const result = run("--include-legacy");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--include-legacy-weixin/);
});
