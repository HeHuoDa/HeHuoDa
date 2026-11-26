import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { preprocess } from "./component-host.mjs";

const source = readFileSync(
  new URL("../src/api/client.ts", import.meta.url),
  "utf8",
);

test("Android 条件编译把请求配置标为 app，并保持运行期 HTTPS 防护", () => {
  const app = preprocess(source, "APP-PLUS");
  assert.match(app, /platform = "app"/);
  assert.doesNotMatch(app, /platform = "h5"/);
  assert.match(app, /baseUrl\.startsWith\("https:\/\/"\)/);
  assert.match(app, /platform,\n\s*\}\);/);
});

test("H5 与微信分支保持原样：H5 标为 h5，微信不进入 App 代码块", () => {
  const h5 = preprocess(source, "H5");
  assert.match(h5, /platform = "h5"/);
  assert.doesNotMatch(h5, /platform = "app"/);
  assert.doesNotMatch(h5, /Android 客户端 API 地址必须使用 HTTPS/);
  const weixin = preprocess(source, "MP-WEIXIN");
  assert.match(weixin, /let platform = "mp-weixin"/);
  assert.doesNotMatch(weixin, /platform = "h5"/);
  assert.doesNotMatch(weixin, /platform = "app"/);
  assert.doesNotMatch(weixin, /Android 客户端 API 地址必须使用 HTTPS/);
});
