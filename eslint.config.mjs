import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import vue from "eslint-plugin-vue";
import prettier from "eslint-config-prettier/flat";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-openapi/**",
      "**/coverage/**",
      "**/src/generated/**",
      "apps/uni/unpackage/**",
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
    ],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
