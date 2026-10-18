import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { platformConfig } from "./platform-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [command, platform, ...args] = process.argv.slice(2);
if (
  !["dev", "build"].includes(command) ||
  !["h5", "mp-weixin"].includes(platform)
) {
  throw new Error("用法：run-uni.mjs dev|build h5|mp-weixin");
}
const env = {
  ...loadEnv(command === "build" ? "production" : "development", root, ""),
  ...process.env,
};
const config = platformConfig(env);
const manifest = JSON.parse(
  readFileSync(resolve(root, "manifest.template.json"), "utf8"),
);
manifest["mp-weixin"].appid = config.appid;
writeFileSync(
  resolve(root, "src/manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
if (platform === "mp-weixin" && !config.appid) {
  console.info(
    "[本地编译] 未配置 AppID；DCloud 会生成 touristappid，仅用于编译检查，不用于平台运行或发布。",
  );
}
const require = createRequire(import.meta.url);
const cli = resolve(
  dirname(require.resolve("@dcloudio/vite-plugin-uni/package.json")),
  "bin/uni.js",
);
const child = spawn(
  process.execPath,
  [cli, ...(command === "build" ? ["build"] : []), "-p", platform, ...args],
  {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
