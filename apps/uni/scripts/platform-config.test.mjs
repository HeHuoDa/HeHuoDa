import assert from "node:assert/strict";
import { test } from "node:test";
import { platformConfig } from "./platform-config.mjs";

test("账号未就绪时允许本地编译，不伪造 AppID", () => {
  assert.deepEqual(platformConfig({}), { appid: "", release: false });
});
test("正式平台构建缺少 AppID 时拒绝执行", () => {
  assert.throws(() => platformConfig({ UNI_RELEASE: "true" }), /缺少/);
});
test("拒绝游客 AppID 和含糊的正式构建开关", () => {
  assert.throws(
    () => platformConfig({ UNI_MP_WEIXIN_APPID: "touristappid" }),
    /AppID/,
  );
  assert.throws(() => platformConfig({ UNI_RELEASE: "yes" }), /true 或 false/);
});
test("格式有效不等于账号验收，配置仅透传受控 AppID", () => {
  assert.deepEqual(
    platformConfig({
      UNI_RELEASE: "true",
      UNI_MP_WEIXIN_APPID: " wx1234567890abcdef ",
    }),
    {
      appid: "wx1234567890abcdef",
      release: true,
    },
  );
});
