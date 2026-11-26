import assert from "node:assert/strict";
import { test } from "node:test";
import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";

/**
 * 跨平台静态防退化规则的行为测试：用真实 ESLint 配置（不做替身）对虚拟源码做
 * `lintText`，断言诊断规则与严重级别。范围与生产规则一致：
 * `apps/uni/src`、`packages/client-domain/src` 的脚本以及 uni 的 Vue SFC。
 */
const cwd = fileURLToPath(new URL("../../../", import.meta.url));
const eslint = new ESLint({ cwd });

async function diagnostics(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((message) => ({
    ruleId: message.ruleId,
    severity: message.severity,
    message: message.message,
  }));
}
const rulesOf = (messages) => messages.map((message) => message.ruleId).sort();

/** 生产规则要求 error 级别：只有 error 才会让 `pnpm lint` 失败。 */
function assertError(messages, pattern, label) {
  const hit = messages.filter(
    (message) => message.severity === 2 && pattern.test(message.message ?? ""),
  );
  assert.ok(
    hit.length > 0,
    `${label} 期望命中 error 级诊断，实际为 ${JSON.stringify(messages)}`,
  );
}

for (const [label, code, filePath, pattern] of [
  [
    "H5 明文写入刷新令牌",
    `export function save(token: string) {
  localStorage.setItem("refresh", token);
}`,
    "apps/uni/src/pages/index/save.ts",
    /localStorage/,
  ],
  [
    "方括号形式的 Web Storage 访问",
    `export const store = window["sessionStorage"];`,
    "apps/uni/src/pages/index/probe.ts",
    /sessionStorage/,
  ],
  [
    "公共模块使用 uni 明文存储",
    `export function save(token: string) {
  uni.setStorageSync("refresh", token);
}`,
    "apps/uni/src/pages/index/cache.ts",
    /uni 明文存储/,
  ],
  [
    "公共模块使用 uni 明文存储（字面量下标）",
    `export const value = uni["getStorageSync"]("refresh");`,
    "apps/uni/src/pages/index/read.ts",
    /uni 明文存储/,
  ],
  [
    "直接使用 wx 全局接口",
    `export const call = () => wx.request({ url: "/x" });`,
    "apps/uni/src/pages/index/wx.ts",
    /wx/,
  ],
  [
    "非旧适配器中的 uni.login",
    `export const login = () => uni.login({ provider: "weixin" });`,
    "apps/uni/src/pages/index/login.ts",
    /uni\.login/,
  ],
  [
    "wx 专属成员入口",
    `export const setting = () => uni.getWeixinSetting();`,
    "apps/uni/src/pages/index/weixin.ts",
    /Weixin/,
  ],
  [
    "共享包直接依赖微信平台标识",
    `export const flag = globalThis.wx !== undefined;`,
    "packages/client-domain/src/platform.ts",
    /wx/,
  ],
]) {
  test(`${label}被静态规则拦截`, async () => {
    const messages = await diagnostics(code, filePath);
    assertError(messages, pattern, label);
    assert.ok(
      rulesOf(messages).some((rule) =>
        ["no-restricted-syntax", "vue/no-restricted-syntax"].includes(rule),
      ),
      `期望由 no-restricted-syntax 系列规则命中，实际 ${JSON.stringify(messages)}`,
    );
  });
}

test("Vue SFC 脚本中的 Web Storage 与微信调用被拦截", async () => {
  const code = `<script setup lang="ts">
const save = (token: string) => localStorage.setItem("refresh", token);
const call = () => uni.login({ provider: "weixin" });
</script>
<template><view @click="save('t')">保存</view></template>`;
  const messages = await diagnostics(code, "apps/uni/src/pages/index/Home.vue");
  assertError(messages, /localStorage/, "SFC 脚本 Web Storage");
  assertError(messages, /uni\.login/, "SFC 脚本 uni.login");
});

test("Vue SFC 模板表达式中的微信专属调用被拦截", async () => {
  const code = `<template>
  <view @click="uni.login({ provider: 'weixin' })">登录</view>
  <view>{{ localStorage.getItem("refresh") }}</view>
</template>`;
  const messages = await diagnostics(
    code,
    "apps/uni/src/pages/index/Template.vue",
  );
  assertError(messages, /uni\.login/, "SFC 模板 uni.login");
  assertError(messages, /localStorage/, "SFC 模板 Web Storage");
});

test("旧微信登录适配器与遗留平台包不允许被生产源码导入", async () => {
  for (const [file, source] of [
    [
      "apps/uni/src/pages/index/legacy.ts",
      `import { requestWechatCode } from "../../auth/wechat-login.ts";
export const use = requestWechatCode;`,
    ],
    [
      "apps/uni/src/pages/index/legacy-noext.ts",
      `import { requestWechatCode } from "../../auth/wechat-login";
export const use = requestWechatCode;`,
    ],
    [
      "apps/uni/src/pages/index/platform.ts",
      `import "@dcloudio/uni-mp-weixin";
export const ready = true;`,
    ],
  ]) {
    const messages = await diagnostics(source, file);
    const hit = messages.filter(
      (message) =>
        message.severity === 2 &&
        ["no-restricted-imports", "no-restricted-syntax"].includes(
          message.ruleId,
        ),
    );
    assert.ok(
      hit.length > 0,
      `${file} 期望命中导入限制，实际 ${JSON.stringify(messages)}`,
    );
  }
});

test("受控例外与合法用法不产生相关诊断", async () => {
  const cases = [
    [
      "h5-tab-sync 的协调存储",
      `const raw = localStorage.getItem("hehuoda.auth.h5.coord.v1");
export const value = raw;`,
      "apps/uni/src/auth/h5-tab-sync.ts",
      [/localStorage/],
    ],
    [
      "platform-storage 的遗留适配器",
      `export const read = () => uni.getStorageSync("hehuoda.auth.refresh");`,
      "apps/uni/src/auth/platform-storage.ts",
      [/uni 明文存储/, /wx/],
    ],
    [
      "wechat-login 的 uni.login",
      `export const login = () => uni.login({ provider: "weixin" });`,
      "apps/uni/src/auth/wechat-login.ts",
      [/uni\.login/],
    ],
    [
      "普通共享 uni API",
      `export const go = () => uni.switchTab({ url: "/pages/index/index" });
export const fetchIt = () => uni.request({ url: "/api/v1/health" });`,
      "apps/uni/src/pages/index/ok.ts",
      [/wx/, /uni 明文存储/, /uni\.login/],
    ],
    [
      "注释中的术语",
      `// wx.request 与 localStorage 只出现在说明里
export const note = "禁止明文持久化刷新令牌";`,
      "apps/uni/src/pages/index/note.ts",
      [/wx/, /localStorage/],
    ],
  ];
  for (const [label, code, filePath, patterns] of cases) {
    const messages = await diagnostics(code, filePath);
    for (const pattern of patterns) {
      assert.equal(
        messages.filter((message) => pattern.test(message.message ?? ""))
          .length,
        0,
        `${label} 不应命中 ${pattern}：${JSON.stringify(messages)}`,
      );
    }
  }
});

test("h5-tab-sync 仍受 sessionStorage 限制，例外不外溢到其他文件", async () => {
  const inSyncFile = await diagnostics(
    `export const probe = sessionStorage.getItem("k");`,
    "apps/uni/src/auth/h5-tab-sync.ts",
  );
  assertError(inSyncFile, /sessionStorage/, "h5-tab-sync 的 sessionStorage");
  const elsewhere = await diagnostics(
    `export const probe = localStorage.getItem("k");`,
    "apps/uni/src/auth/platform-storage.ts",
  );
  assertError(elsewhere, /localStorage/, "例外文件不得共享 localStorage 豁免");
});

test("规则不覆盖测试替身与脚本目录，避免误伤夹具", async () => {
  const messages = await diagnostics(
    `export const fake = localStorage.getItem("token");`,
    "apps/uni/scripts/fixtures/local-storage-double.ts",
  );
  assert.equal(
    messages.filter((message) => /localStorage/.test(message.message ?? ""))
      .length,
    0,
    JSON.stringify(messages),
  );
});
