import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const packageVersion = (request, name) =>
  JSON.parse(readFileSync(request.resolve(`${name}/package.json`), "utf8"))
    .version;
const expected = {
  vue: "3.5.42",
  "@vue/runtime-core": "3.5.42",
  pinia: "3.0.4",
  tailwindcss: "4.3.3",
  "weapp-tailwindcss": "5.6.3",
  vite: "5.2.8",
  "vue-router": "4.4.4",
  "@dcloudio/uni-app": "3.0.0-5020420260813003",
  "@dcloudio/uni-h5": "3.0.0-5020420260813003",
  "@dcloudio/uni-mp-weixin": "3.0.0-5020420260813003",
  "@dcloudio/vite-plugin-uni": "3.0.0-5020420260813003",
};
for (const [name, version] of Object.entries(expected)) {
  assert.equal(packageVersion(require, name), version, name);
}
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
for (const runtime of ["uni-h5-vue", "uni-mp-vue"]) {
  const owner =
    runtime === "uni-h5-vue" ? "@dcloudio/uni-h5" : "@dcloudio/uni-mp-weixin";
  const ownerRequire = createRequire(require.resolve(`${owner}/package.json`));
  const entry = resolve(
    dirname(ownerRequire.resolve(`@dcloudio/${runtime}/package.json`)),
    "dist/vue.runtime.esm.js",
  );
  const source = readFileSync(entry, "utf8");
  assert.match(source, /(?:const|var) version = ["']3\.4\.21["']/);
  console.info(`DCloud 内嵌 ${runtime}: 3.4.21（区别于应用依赖 Vue 3.5.42）`);
}
console.info(
  "工具链版本与 DCloud 内部 renderer 配套检查通过；不代表微信实际运行或完整 Vue 3.5 API 支持。",
);
