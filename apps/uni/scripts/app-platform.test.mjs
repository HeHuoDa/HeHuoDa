import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { preprocess } from "./component-host.mjs";

const source = readFileSync(
  new URL("../src/api/client.ts", import.meta.url),
  "utf8",
);

test("Android 端平台值为 app，并保持运行期 HTTPS 防护", () => {
  const app = preprocess(source, "APP-PLUS");
  // App-Plus 不进入 H5 分支，默认平台值就是 app。
  assert.match(app, /let platform = "app"/);
  assert.doesNotMatch(app, /platform = "h5"/);
  assert.match(app, /baseUrl\.startsWith\("https:\/\/"\)/);
  assert.match(app, /platform,\n\s*\}\);/);
});

test("H5 平台值覆盖为 h5，且不进入 App 独占的 HTTPS 运行时检查", () => {
  const h5 = preprocess(source, "H5");
  assert.match(h5, /platform = "h5"/);
  assert.doesNotMatch(h5, /Android 客户端 API 地址必须使用 HTTPS/);
  // H5 是唯一允许相对地址与 Cookie 凭据的通道。
  assert.match(h5, /requestOptions\.withCredentials = true/);
  assert.doesNotMatch(h5, /PATCH 仅在 H5 通道使用/);
});

test("非 H5 通道保留 PATCH 拒绝，不向传输层放行该方法", () => {
  const app = preprocess(source, "APP-PLUS");
  assert.match(app, /options\.method === "PATCH"/);
  assert.match(app, /PATCH 仅在 H5 通道使用/);
  // App 分支不设置 withCredentials：Cookie 会话只在同源 H5 使用。
  assert.doesNotMatch(app, /withCredentials = true/);
});
