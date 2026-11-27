import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { invocation, runConfig } from "./run-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [command, platform, ...args] = process.argv.slice(2);
const USAGE =
  "用法：run-uni.mjs dev|build h5|app。微信小程序（mp-weixin）已按 ADR 0011 退役，不再接受该目标。";
if (!["dev", "build"].includes(command) || !["h5", "app"].includes(platform)) {
  throw new Error(
    platform === "mp-weixin"
      ? `${USAGE} 本次收到 ${platform}，请改用 pnpm build:h5 或 pnpm build:app。`
      : USAGE,
  );
}
// 生产/开发各自使用正确的 Vite mode；进程环境优先于 .env 文件。
const mode = command === "build" ? "production" : "development";
const plan = runConfig({
  command,
  platform,
  root,
  env: {
    ...loadEnv(mode, root, ""),
    ...process.env,
    manifestTemplate: readFileSync(
      resolve(root, "manifest.template.json"),
      "utf8",
    ),
  },
});
const { config, manifest, outDir } = plan;
// App 由脚本固定平台、mode、编译输入与产物目录；H5 沿用原参数透传与进程环境。
const { args: cliArgs, env: childEnv } = invocation({
  command,
  platform,
  mode,
  args,
  plan,
  processEnv: process.env,
});
if (platform === "app") {
  // 资源构建产物（App-Plus www 资源）不等于 APK；签名与原生工程仍属后续验收。
  console.info(
    `[App 资源编译] API 基址 ${config.apiBaseUrl}；超时 ${config.timeout}ms；包名 ${config.packagename}。`,
  );
}
writeFileSync(
  resolve(root, "src/manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
const require = createRequire(import.meta.url);
const cli = resolve(
  dirname(require.resolve("@dcloudio/vite-plugin-uni/package.json")),
  "bin/uni.js",
);
// 脚本不预清理产物目录：DCloud/Vite 在编译开始时才清空 outDir，
// 因此配置预检失败的启动会保留上一次成功构建的产物，成功与否只以退出码为准。
const child = spawn(process.execPath, [cli, ...cliArgs], {
  cwd: root,
  stdio: "inherit",
  env: childEnv,
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
  if (platform === "app" && code === 0 && outDir) {
    console.info(
      `[App 资源编译] 输出目录 ${outDir}；生成签名 APK 的后续步骤见 docs/android-app-build.md。`,
    );
  }
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
