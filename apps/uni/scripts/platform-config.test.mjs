import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  ANDROID_PLACEHOLDER_PACKAGENAME,
  applyPlatformManifest,
  parseAppApiBaseUrl,
  platformConfig,
  validateAndroidPackageName,
} from "./platform-config.mjs";

const HTTPS = "https://api.example.test/api/v1";
const releaseEnv = (extra = {}) => ({
  UNI_RELEASE: "true",
  VITE_API_BASE_URL: HTTPS,
  UNI_ANDROID_PACKAGE_NAME: "cn.edu.sicau.hehuoda",
  NODE_ENV: "production",
  ...extra,
});

test("账号未就绪时允许本地编译，不伪造任何平台 AppID", () => {
  assert.deepEqual(platformConfig({}), { appid: "", release: false });
});
test("含糊的正式构建开关被拒绝", () => {
  assert.throws(() => platformConfig({ UNI_RELEASE: "yes" }), /true 或 false/);
});
test("未知构建目标显式报错，不静默按 H5 处理", () => {
  for (const target of ["mp-weixin", "MP-WEIXIN", "web", "", null]) {
    assert.throws(
      () => platformConfig({}, target),
      /ADR 0011|h5 \| app/u,
      String(target),
    );
  }
  // 默认参数行为不变：仍按 H5 返回。
  assert.deepEqual(platformConfig({}), { appid: "", release: false });
});
test("已退役的微信 AppID 环境变量不再被读取或校验", () => {
  // 本机残留的无效 AppID 既不应阻断构建，也不应被透传到生成配置。
  for (const appid of ["touristappid", "wx1234567890abcdef", ""]) {
    for (const target of [undefined, "h5", "app"]) {
      const env =
        target === "app"
          ? { VITE_API_BASE_URL: HTTPS, UNI_MP_WEIXIN_APPID: appid }
          : { UNI_MP_WEIXIN_APPID: appid };
      const config = platformConfig(env, target);
      assert.equal(config.appid, "", `${target}: ${appid}`);
    }
  }
});

test("H5 目标不读取、不校验微信 AppID，也不再因遗留 AppID 阻止正式构建", () => {
  assert.deepEqual(platformConfig({ UNI_RELEASE: "true" }, "h5"), {
    appid: "",
    release: true,
  });
  // 本机残留的无效 AppID 与 H5 无关，不拒绝也不透传。
  assert.deepEqual(
    platformConfig(
      { UNI_MP_WEIXIN_APPID: "touristappid", VITE_API_BASE_URL: "/api/v1" },
      "h5",
    ),
    { appid: "", release: false },
  );
  assert.deepEqual(
    platformConfig({ UNI_MP_WEIXIN_APPID: "wx1234567890abcdef" }, "h5"),
    { appid: "", release: false },
  );
  // 含糊的 UNI_RELEASE 是共享开关，H5 同样拒绝。
  assert.throws(
    () => platformConfig({ UNI_RELEASE: "yes" }, "h5"),
    /true 或 false/,
  );
});

test("Android 目标不读取微信 AppID，也不因此阻断编译", () => {
  const config = platformConfig({ VITE_API_BASE_URL: HTTPS }, "app");
  assert.equal(config.appid, "");
  assert.equal(config.apiBaseUrl, HTTPS);
  assert.equal(config.packagename, ANDROID_PLACEHOLDER_PACKAGENAME);
  assert.equal(config.release, false);
  // 旧开关对 Android 无影响：正式构建仍需显式包名，但不看任何 AppID。
  assert.equal(
    platformConfig(
      {
        VITE_API_BASE_URL: HTTPS,
        UNI_MP_WEIXIN_APPID: "touristappid",
        UNI_ANDROID_PACKAGE_NAME: "cn.edu.sicau.hehuoda",
      },
      "app",
    ).packagename,
    "cn.edu.sicau.hehuoda",
  );
});

test("Android 只接受完整 HTTPS 基址，缺省/相对/协议相对一律拒绝", () => {
  for (const [env, pattern] of [
    [{}, /必须显式配置/],
    [{ VITE_API_BASE_URL: "" }, /必须显式配置/],
    [{ VITE_API_BASE_URL: "   " }, /必须显式配置|首尾空白/],
    [{ VITE_API_BASE_URL: " /api/v1 " }, /首尾空白/],
    [{ VITE_API_BASE_URL: "/api/v1" }, /https:\/\//],
    [{ VITE_API_BASE_URL: "//api.example.test/api/v1" }, /https:\/\//],
    [{ VITE_API_BASE_URL: "http://api.example.test/api/v1" }, /https:\/\//],
    [{ VITE_API_BASE_URL: "https:///api/v1" }, /多级 DNS/],
    [{ VITE_API_BASE_URL: "https://localhost:8443/api/v1" }, /多级 DNS/],
    [{ VITE_API_BASE_URL: "https://intranet/api/v1" }, /多级 DNS/],
    [{ VITE_API_BASE_URL: "https://127.0.0.1/api/v1" }, /多级 DNS/],
    [{ VITE_API_BASE_URL: "https://[::1]/api/v1" }, /DNS 名称/],
    [{ VITE_API_BASE_URL: "https://api.example.test\\api" }, /反斜杠/],
    [{ VITE_API_BASE_URL: "https://user:pw@api.example.test/api" }, /凭据/],
    [{ VITE_API_BASE_URL: "https://api.example.test/api?token=1" }, /查询/],
    [{ VITE_API_BASE_URL: "https://api.example.test/api#frag" }, /片段/],
    [{ VITE_API_BASE_URL: "https://api.example.test:0/api" }, /端口/],
    [{ VITE_API_BASE_URL: "https://api.example.test:65536/api" }, /端口/],
    [{ VITE_API_BASE_URL: "https://api.example.test:0443/api" }, /前导零/],
    [{ VITE_API_BASE_URL: "https://api.example.test:/api" }, /主机/],
    [{ VITE_API_BASE_URL: "https://api.example.test:8443:443/api" }, /主机/],
    [{ VITE_API_BASE_URL: "https://api.example.test/\napi" }, /控制字符|空白/],
    [{ VITE_API_BASE_URL: "https://api.example.test/api//v1" }, /重复斜杠/],
    [{ VITE_API_BASE_URL: "https://api.example.test/../api" }, /上级目录/],
    [{ VITE_API_BASE_URL: "https://api.example.test/a b" }, /反斜杠|空白/],
    [
      {
        VITE_API_BASE_URL: "https://api.example.test/api ",
        NODE_ENV: "production",
      },
      /首尾空白/,
    ],
  ]) {
    assert.throws(
      () => platformConfig(env, "app"),
      pattern,
      JSON.stringify(env),
    );
  }
});

test("拒绝输入时不回显原值，错误信息只说明变量与约束", () => {
  const secret = "https://user:super-secret-token@api.example.test/api";
  assert.throws(
    () => platformConfig({ VITE_API_BASE_URL: secret }, "app"),
    (error) => {
      assert.match(error.message, /VITE_API_BASE_URL/);
      assert.doesNotMatch(error.message, /super-secret-token/);
      assert.doesNotMatch(error.message, /api\.example\.test/);
      return true;
    },
  );
});

test("合法地址归一化为与运行期一致的基址", () => {
  const parse = (value, development = false, timeout = "5000") =>
    parseAppApiBaseUrl(value, { development, timeout });
  assert.equal(parse(HTTPS).baseUrl, HTTPS);
  // 未显式传入超时时沿用运行期默认值，而不是读 process.env。
  assert.equal(parse(HTTPS).timeout, 5000);
  assert.equal(
    parse("https://API.Example.TEST/api/v1/").baseUrl,
    "https://api.example.test/api/v1",
  );
  // 主机与协议大小写不敏感是解析器的正常归一，不算"纠正"。
  assert.equal(
    parse("HTTPS://API.Example.TEST/api/v1").baseUrl,
    "https://api.example.test/api/v1",
  );
  assert.equal(
    parse("https://api.example.test:8443/api/v1").baseUrl,
    "https://api.example.test:8443/api/v1",
  );
  assert.equal(
    parse("https://api.example.test").baseUrl,
    "https://api.example.test",
  );
  // 默认端口 443 由 WHATWG URL 归一为无端口，预检必须接受并与解析结果一致。
  assert.equal(parse("https://api.example.test:443/api/v1").baseUrl, HTTPS);
  assert.equal(
    parse("https://api.example.test:443").baseUrl,
    "https://api.example.test",
  );
  assert.equal(
    parse("https://API.Example.TEST:443/api/v1/").baseUrl,
    "https://api.example.test/api/v1",
  );
  // 开发模式同样是 HTTPS 要求，只改变 mode 标记。
  assert.equal(parse(HTTPS, true).baseUrl, HTTPS);
  assert.throws(() => parse("http://api.example.test", true), /https/);
});

test("超时取自同一份合并 env，非法值在预检阶段就拒绝", () => {
  const plan = (env) => platformConfig(env, "app");
  // 空白值等同未设置（运行时纯函数已如此），非法值必须在预检阶段拒绝。
  for (const invalid of ["abc", "0", "-1", "60001", "1.5", "5000ms"]) {
    assert.throws(
      () => plan({ VITE_API_BASE_URL: HTTPS, VITE_API_TIMEOUT_MS: invalid }),
      /VITE_API_TIMEOUT_MS/,
      JSON.stringify(invalid),
    );
  }
  assert.equal(
    plan({ VITE_API_BASE_URL: HTTPS, VITE_API_TIMEOUT_MS: " 8000 " }).timeout,
    8000,
  );
  assert.equal(plan({ VITE_API_BASE_URL: HTTPS }).timeout, 5000);
  // 纯函数不读 process.env：环境变量无法绕过显式入参。
  process.env.VITE_API_TIMEOUT_MS = "abc";
  try {
    assert.equal(plan({ VITE_API_BASE_URL: HTTPS }).timeout, 5000);
  } finally {
    delete process.env.VITE_API_TIMEOUT_MS;
  }
  assert.throws(
    () =>
      plan({
        VITE_API_BASE_URL: "https://user:pw@api.example.test/api",
        VITE_API_TIMEOUT_MS: "999999",
      }),
    (error) => {
      assert.doesNotMatch(error.message, /999999|super-secret/u);
      return true;
    },
  );
});

test("合法地址的结构化字段与运行期一致：解析器改写过的输入拒绝", () => {
  // 这些输入在 JSON/URL 解析器中会被静默纠正，必须在预检阶段拒绝，而不是接受纠正后的结果。
  for (const [value, pattern] of [
    ["https://api.example.test:65536/api", /端口|改写/],
    ["https://api.example.test:/api", /主机/],
    ["https://api.example.test./api", /多级 DNS/],
    ["https://api.example.test/\u0000api", /控制字符/],
  ]) {
    assert.throws(
      () => parseAppApiBaseUrl(value, { development: false }),
      pattern,
      value,
    );
  }
});

test("Android 包名：占位可用于本地编译，正式构建必须显式注入受控包名", () => {
  assert.equal(
    validateAndroidPackageName("com.example.hehuoda", { release: false }),
    "com.example.hehuoda",
  );
  for (const packagename of [
    "cn.edu.sicau.hehuoda",
    "cn.edu.sicau.hehuoda_beta",
  ]) {
    assert.equal(
      validateAndroidPackageName(packagename, { release: true }),
      packagename,
    );
  }
  for (const packagename of [
    "",
    " com.example.hehuoda",
    "CN.Edu.Sicau",
    "hehuoda",
    "cn..edu",
    "cn.1edu.sicau",
    "cn.edu.sicau-he",
    "cn/edu/sicau",
  ]) {
    assert.throws(
      () => validateAndroidPackageName(packagename, { release: false }),
      /UNI_ANDROID_PACKAGE_NAME/,
      packagename,
    );
  }
  for (const packagename of [
    "com.example.hehuoda",
    "io.dcloud.hehuoda",
    "io.uni.hehuoda",
    "com.dcloud.hehuoda",
    "com.android.hehuoda",
  ]) {
    assert.throws(
      () => validateAndroidPackageName(packagename, { release: true }),
      /UNI_ANDROID_PACKAGE_NAME|示例|保留/,
      packagename,
    );
  }
});

test("正式 Android 构建必须显式注入包名，不能沿用示例 ID", () => {
  assert.throws(
    () => platformConfig(releaseEnv({ UNI_ANDROID_PACKAGE_NAME: "" }), "app"),
    /UNI_ANDROID_PACKAGE_NAME/,
  );
  assert.throws(
    () =>
      platformConfig(
        releaseEnv({
          UNI_ANDROID_PACKAGE_NAME: ANDROID_PLACEHOLDER_PACKAGENAME,
        }),
        "app",
      ),
    /UNI_ANDROID_PACKAGE_NAME/,
  );
  assert.deepEqual(platformConfig(releaseEnv(), "app"), {
    appid: "",
    release: true,
    apiBaseUrl: HTTPS,
    timeout: 5000,
    packagename: "cn.edu.sicau.hehuoda",
  });
});

const template = () =>
  JSON.parse(
    readFileSync(new URL("../manifest.template.json", import.meta.url), "utf8"),
  );

test("受跟踪模板不含小程序段，Android 应用名、包名、版本、SDK 与仅 INTERNET 权限保持", () => {
  const manifest = template();
  assert.equal(manifest.name, "禾伙搭");
  assert.equal(manifest.versionName, "0.0.3");
  assert.equal(manifest.versionCode, "4");
  // DCloud 顶层 appid 是另一身份，不能被写成包名或伪造 AppID。
  assert.equal(manifest.appid, "");
  // 小程序目标已按 ADR 0011 退役：模板不再声明 mp-weixin 段。
  assert.equal(manifest["mp-weixin"], undefined);
  const android = manifest["app-plus"].distribute.android;
  assert.equal(android.packagename, ANDROID_PLACEHOLDER_PACKAGENAME);
  assert.equal(android.minSdkVersion, 23);
  assert.equal(android.targetSdkVersion, 34);
  assert.deepEqual(android.permissions, [
    '<uses-permission android:name="android.permission.INTERNET"/>',
  ]);
  // 不声明签名、证书、密码或渠道，避免把未受控凭据写入模板。
  assert.equal(manifest["app-plus"].distribute.ios, undefined);
  assert.doesNotMatch(
    JSON.stringify(manifest),
    /keystore|certificate|password|appkey|channel/iu,
  );
  assert.equal(manifest["app-plus"].splashscreen.autoclose, true);
});

test("生成配置按目标隔离：Android 只改包名，不新增任何小程序键", () => {
  const templateManifest = template();
  const appManifest = applyPlatformManifest(templateManifest, "app", {
    appid: "",
    packagename: "cn.edu.sicau.hehuoda",
    apiBaseUrl: HTTPS,
    release: false,
  });
  assert.equal(
    appManifest["app-plus"].distribute.android.packagename,
    "cn.edu.sicau.hehuoda",
  );
  assert.equal(appManifest["mp-weixin"], undefined);
  assert.equal(appManifest.appid, "");
  assert.equal(
    templateManifest["app-plus"].distribute.android.packagename,
    ANDROID_PLACEHOLDER_PACKAGENAME,
  );
});

test("H5 生成配置是模板副本，不新增任何平台专属字段", () => {
  const templateManifest = template();
  const config = platformConfig(
    { UNI_MP_WEIXIN_APPID: "wx1234567890abcdef" },
    "h5",
  );
  const h5Manifest = applyPlatformManifest(templateManifest, "h5", config);
  // 不落任何 AppID，也不改 Android 包名，更不新增小程序段。
  assert.deepEqual(h5Manifest, templateManifest);
  assert.equal(h5Manifest["mp-weixin"], undefined);
  assert.notEqual(h5Manifest, templateManifest, "必须返回副本而非改模板");
});
