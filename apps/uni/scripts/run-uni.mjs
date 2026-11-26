import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { runConfig } from "./run-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [command, platform, ...args] = process.argv.slice(2);
if (!["dev", "build"].includes(command)) {
  throw new Error("用法：run-uni.mjs dev|build h5|mp-weixin|app");
}
// 生产/开发各自使用正确的 Vite mode；进程环境优先于 .env 文件。
const mode = command === "build" ? "production" : "development";
// App 资源目录由 DCloud CLI 依据平台与 NODE_ENV 固定推导。
// 在配置校验前先清空，使被拒绝的构建不会留下可被误认成新构建的旧产物。
const appOutDir =
  platform === "app"
    ? resolve(root, "dist", mode === "production" ? "build" : "dev", "app")
    : "";
if (appOutDir && existsSync(appOutDir)) rmSync(appOutDir, { recursive: true });
const { config, manifest, outDir, env } = runConfig({
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
if (platform === "mp-weixin" && !config.appid) {
  console.info(
    "[本地编译] 未配置 AppID；DCloud 会生成 touristappid，仅用于编译检查，不用于平台运行或发布。",
  );
}
if (platform === "app") {
  // 资源构建产物（App-Plus www 资源）不等于 APK；签名与原生工程仍属后续验收。
  console.info(
    `[App 资源编译] API 基址 ${config.apiBaseUrl}；包名 ${config.packagename}。`,
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
if (outDir && existsSync(outDir)) rmSync(outDir, { recursive: true });
const child = spawn(
  process.execPath,
  [
    cli,
    ...(command === "build" ? ["build"] : []),
    "-p",
    platform,
    "-m",
    mode,
    ...args,
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
  if (platform === "app" && outDir) {
    console.info(
      `[App 资源编译] 输出目录 ${outDir}；生成签名 APK 的后续步骤见 docs/agents/uni-app-migration.md 的「#219 Android 本地资源构建」。`,
    );
  }
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
