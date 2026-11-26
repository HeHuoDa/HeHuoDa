import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import vue from "eslint-plugin-vue";
import prettier from "eslint-config-prettier/flat";

/**
 * 跨平台防退化静态规则。
 *
 * 用 AST 匹配代码用法（注释与字符串字面量不参与），只覆盖约定的存储与微信 API 访问方式；
 * 运行期构造属性、跨模块数据流和第三方依赖内部仍靠代码审查与行为测试守护。
 * 唯一的三处受控例外见下方 `CROSS_PLATFORM_EXCEPTIONS`。
 */
const localMessage =
  "禁止直接使用 localStorage 持久化客户端数据；H5 协调元数据只能经 auth/h5-tab-sync.ts 的适配器写入。";
const sessionMessage =
  "禁止直接使用 sessionStorage；会话状态保存在内存 store，不落浏览器存储。";
const uniStorageMessage =
  "禁止在公共模块直接读写 uni 明文存储；凭据只能经 auth/platform-storage.ts 的端别适配器处理。";
const wxMessage =
  "禁止直接使用微信专有全局 wx 接口；H5 与 Android 只使用共享的 uni API。";
const uniLoginMessage =
  "禁止直接调用 uni.login；微信登录入口收敛在 auth/wechat-login.ts，现行交付端不使用。";
const weixinMemberMessage =
  "禁止使用带 Weixin 成员的平台专有入口；微信端已按 ADR 0011 退役。";

const computedLiteral = (names) =>
  `MemberExpression[computed=true] > Literal.property[value=/${names}/]`;
const uniMember = (names, computedOnly = false) =>
  computedOnly
    ? `MemberExpression[object.name="uni"][computed=true] > Literal.property[value=/${names}/]`
    : `MemberExpression[object.name="uni"] > Identifier.property[name=/${names}/]`;

const STORAGE_API = "^(get|set|remove|clear)Storage(Sync)?$";

const localSelectors = [
  'Identifier[name="localStorage"]',
  computedLiteral("^(local)Storage$"),
];
const sessionSelectors = [
  'Identifier[name="sessionStorage"]',
  computedLiteral("^(session)Storage$"),
];
const uniStorageSelectors = [
  uniMember(STORAGE_API),
  uniMember(STORAGE_API, true),
];
const wxSelectors = ['Identifier[name="wx"]', computedLiteral("^wx$")];
const uniLoginSelectors = [uniMember("^login$"), uniMember("^login$", true)];
const weixinMemberSelectors = [
  uniMember("[Ww]eixin"),
  uniMember("[Ww]eixin", true),
];

const group = (message, selectors) =>
  selectors.map((selector) => ({ selector, message }));

/** 规则选项按组拼接，便于例外文件只做一次完整重述。 */
const restrictedSyntax = (...groups) => ["error", ...groups.flat()];

const ALL_GROUPS = [
  group(localMessage, localSelectors),
  group(sessionMessage, sessionSelectors),
  group(uniStorageMessage, uniStorageSelectors),
  group(wxMessage, wxSelectors),
  group(uniLoginMessage, uniLoginSelectors),
  group(weixinMemberMessage, weixinMemberSelectors),
];

/** 受控例外：每个文件只放开它历史上必须使用的那一组选择器。 */
const CROSS_PLATFORM_EXCEPTIONS = [
  {
    files: ["apps/uni/src/auth/h5-tab-sync.ts"],
    rules: {
      "no-restricted-syntax": restrictedSyntax(
        group(sessionMessage, sessionSelectors),
        group(uniStorageMessage, uniStorageSelectors),
        group(wxMessage, wxSelectors),
        group(uniLoginMessage, uniLoginSelectors),
        group(weixinMemberMessage, weixinMemberSelectors),
      ),
      "vue/no-restricted-syntax": restrictedSyntax(
        group(sessionMessage, sessionSelectors),
        group(uniStorageMessage, uniStorageSelectors),
        group(wxMessage, wxSelectors),
        group(uniLoginMessage, uniLoginSelectors),
        group(weixinMemberMessage, weixinMemberSelectors),
      ),
    },
  },
  {
    files: ["apps/uni/src/auth/platform-storage.ts"],
    rules: {
      "no-restricted-syntax": restrictedSyntax(
        group(localMessage, localSelectors),
        group(sessionMessage, sessionSelectors),
        group(wxMessage, wxSelectors),
        group(uniLoginMessage, uniLoginSelectors),
        group(weixinMemberMessage, weixinMemberSelectors),
      ),
    },
  },
  {
    files: ["apps/uni/src/auth/wechat-login.ts"],
    rules: {
      "no-restricted-syntax": restrictedSyntax(
        group(localMessage, localSelectors),
        group(sessionMessage, sessionSelectors),
        group(uniStorageMessage, uniStorageSelectors),
        group(wxMessage, wxSelectors),
        group(weixinMemberMessage, weixinMemberSelectors),
      ),
    },
  },
];

const restrictedImports = [
  "error",
  {
    patterns: [
      {
        group: ["**/wechat-login", "**/wechat-login.ts"],
        message:
          "禁止导入旧微信登录适配器；现行交付端（H5 与 Android）使用学校统一身份认证。",
      },
      {
        group: ["@dcloudio/uni-mp-weixin", "@dcloudio/uni-mp-weixin/*"],
        message: "禁止静态导入遗留微信小程序编译层；微信端已按 ADR 0011 退役。",
      },
    ],
  },
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-openapi/**",
      "**/coverage/**",
      "**/src/generated/**",
      "apps/uni/unpackage/**",
      // 本地一次性脚本，与 .gitignore 保持一致
      "**/.tmp-*",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs["flat/recommended"],
  {
    files: ["apps/web/**/*.{ts,vue}", "apps/admin/**/*.{ts,vue}"],
    languageOptions: { globals: globals.browser },
  },
  {
    // 只有显式 H5 适配器可使用浏览器对象，公共 uni 组件继续受限。
    files: [
      "apps/uni/src/forms/*.h5.vue",
      "apps/uni/src/forms/*-h5.ts",
      "apps/uni/src/source/*-h5.ts",
    ],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["apps/web/**/*.vue", "apps/admin/**/*.vue", "apps/uni/**/*.vue"],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    files: ["apps/uni/**/*.vue"],
    rules: { "vue/multi-word-component-names": "off" },
    // uni 由 uni-app 运行时注入，类型来自 @dcloudio/types
    languageOptions: {
      globals: { uni: "readonly", getCurrentPages: "readonly" },
    },
  },
  {
    files: ["apps/uni/**/*.ts"],
    // uni 与页面栈 API 由 uni-app 运行时注入，类型来自 @dcloudio/types
    languageOptions: {
      globals: { uni: "readonly", getCurrentPages: "readonly" },
    },
  },
  {
    files: [
      "apps/api/**/*.ts",
      "packages/**/*.ts",
      "**/*.config.*",
      "apps/uni/scripts/**/*.mjs",
      "deploy/**/*.mjs",
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // 生产客户端脚本与 SFC：限定跨平台 API 与存储边界。
    // 同时覆盖 ESLint 可解析的 js/mjs/cjs/tsx/jsx：目录下新增这些脚本也必须受同一约束。
    files: [
      "apps/uni/src/**/*.{ts,tsx,js,mjs,cjs,jsx,vue}",
      "packages/client-domain/src/**/*.{ts,tsx,js,mjs,cjs,jsx}",
    ],
    rules: {
      "no-restricted-syntax": restrictedSyntax(...ALL_GROUPS),
      "vue/no-restricted-syntax": restrictedSyntax(...ALL_GROUPS),
      "no-restricted-imports": restrictedImports,
    },
  },
  ...CROSS_PLATFORM_EXCEPTIONS,
  prettier,
);
