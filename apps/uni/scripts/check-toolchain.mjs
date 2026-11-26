import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

/**
 * 工具链检查默认只覆盖现行交付目标 H5 与 App-Plus 及其共用依赖。
 * 微信端已按 ADR 0011 退役，专用包与内嵌运行时版本改由
 * `--include-legacy-weixin` 显式校验，避免已退役平台阻塞默认门禁。
 */
const LEGACY_WEIXIN_FLAG = "--include-legacy-weixin";
const unknown = process.argv
  .slice(2)
  .filter((arg) => arg !== LEGACY_WEIXIN_FLAG);
if (unknown.length) {
  throw new Error(
    `未知参数 ${unknown.join(" ")}；仅支持 ${LEGACY_WEIXIN_FLAG}。`,
  );
}
const includeLegacyWeixin = process.argv.includes(LEGACY_WEIXIN_FLAG);

const require = createRequire(import.meta.url);
const packageVersion = (request, name) =>
  JSON.parse(readFileSync(request.resolve(`${name}/package.json`), "utf8"))
    .version;
const expected = {
  vue: "3.5.42",
  "@vue/runtime-core": "3.5.42",
  pinia: "3.0.4",
  tailwindcss: "4.3.3",
  // 两端共用同一套 Vite 插件链，包括只在微信构建里读取的 Tailwind 适配插件。
  "weapp-tailwindcss": "5.6.3",
  vite: "5.2.8",
  "vue-router": "4.4.4",
  "@dcloudio/uni-app": "3.0.0-5020420260813003",
  "@dcloudio/uni-app-plus": "3.0.0-5020420260813003",
  "@dcloudio/uni-h5": "3.0.0-5020420260813003",
  "@dcloudio/vite-plugin-uni": "3.0.0-5020420260813003",
};
if (includeLegacyWeixin) {
  expected["@dcloudio/uni-mp-weixin"] = "3.0.0-5020420260813003";
}
for (const [name, version] of Object.entries(expected)) {
  assert.equal(packageVersion(require, name), version, name);
}

const runtimes = ["uni-h5-vue", "uni-app-vue"];
if (includeLegacyWeixin) runtimes.push("uni-mp-vue");
for (const owner of [
  "@dcloudio/uni-cli-shared",
  "@dcloudio/uni-h5",
  "@dcloudio/uni-h5-vue",
]) {
  const requester =
    owner === "@dcloudio/uni-h5-vue"
      ? createRequire(require.resolve("@dcloudio/uni-h5/package.json"))
      : require;
  const ownerRequire = createRequire(
    requester.resolve(`${owner}/package.json`),
  );
  const rendererRequire = createRequire(
    ownerRequire.resolve("@vue/server-renderer/package.json"),
  );
  assert.equal(
    packageVersion(rendererRequire, "vue"),
    packageVersion(ownerRequire, "@vue/server-renderer"),
    `${owner} renderer peer`,
  );
}
const owners = {
  "uni-h5-vue": "@dcloudio/uni-h5",
  "uni-app-vue": "@dcloudio/uni-app-plus",
  "uni-mp-vue": "@dcloudio/uni-mp-weixin",
};
for (const runtime of runtimes) {
  const ownerRequire = createRequire(
    require.resolve(`${owners[runtime]}/package.json`),
  );
  // App 端渲染层只提供按环境拆分的 prod/dev 产物，采用与正式构建一致的 prod 文件。
  const entry = resolve(
    dirname(ownerRequire.resolve(`@dcloudio/${runtime}/package.json`)),
    runtime === "uni-app-vue"
      ? "dist/vue.runtime.esm.prod.js"
      : "dist/vue.runtime.esm.js",
  );
  const source = readFileSync(entry, "utf8");
  assert.match(source, /(?:const|var) version = ["']3\.4\.21["']/);
  assert.equal(
    packageVersion(ownerRequire, `@dcloudio/${runtime}`),
    expected["@dcloudio/uni-app"],
    `${runtime} 须与 DCloud 编译层同版`,
  );
  console.info(`DCloud 内嵌 ${runtime}: 3.4.21（区别于应用依赖 Vue 3.5.42）`);
}
console.info(
  `工具链版本与 DCloud 内部 renderer 配套检查通过（${includeLegacyWeixin ? "含" : "不含"}遗留微信平台）；不代表微信实际运行、Android 真机或完整 Vue 3.5 API 支持。`,
);
