import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

/**
 * 工具链检查只覆盖现行交付目标 H5 与 App-Plus 及其共用依赖。
 * 微信端已按 ADR 0011 退役：遗留开关与遗留平台包都不再接受，
 * 传入即非零退出，避免把已退役平台误当现行门禁。
 */
const RETIRED_FLAG = "--include-legacy-weixin";
if (process.argv.slice(2).length) {
  const unknown = process.argv.slice(2);
  throw new Error(
    unknown.includes(RETIRED_FLAG)
      ? `未知参数 ${RETIRED_FLAG}：微信小程序已按 ADR 0011 退役，工具链只校验 H5 与 App-Plus。`
      : `未知参数 ${unknown.join(" ")}；check-toolchain 不接受任何参数（现行目标为 H5 与 App-Plus）。`,
  );
}

const require = createRequire(import.meta.url);
const packageVersion = (request, name) =>
  JSON.parse(readFileSync(request.resolve(`${name}/package.json`), "utf8"))
    .version;
const expected = {
  vue: "3.5.42",
  "@vue/runtime-core": "3.5.42",
  pinia: "3.0.4",
  tailwindcss: "4.3.3",
  // 两端共用同一套 Vite 插件链，包括由 vite.config.ts 注册的 Tailwind 适配插件。
  "weapp-tailwindcss": "5.6.3",
  vite: "5.2.8",
  "vue-router": "4.4.4",
  "@dcloudio/uni-app": "3.0.0-5020420260813003",
  "@dcloudio/uni-app-plus": "3.0.0-5020420260813003",
  "@dcloudio/uni-h5": "3.0.0-5020420260813003",
  "@dcloudio/vite-plugin-uni": "3.0.0-5020420260813003",
};
for (const [name, version] of Object.entries(expected)) {
  assert.equal(packageVersion(require, name), version, name);
}

const runtimes = ["uni-h5-vue", "uni-app-vue"];
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
  "工具链版本与 DCloud 内部 renderer 配套检查通过（H5 与 App-Plus，不含已退役的微信小程序）；不代表 Android 真机或完整 Vue 3.5 API 支持。",
);
