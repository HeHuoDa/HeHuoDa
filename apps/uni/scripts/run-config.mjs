import { resolve } from "node:path";
import { applyPlatformManifest, platformConfig } from "./platform-config.mjs";

export const PLATFORMS = ["h5", "mp-weixin", "app"];

/**
 * App 入口由脚本独占控制平台、mode、编译输入目录与产物目录。
 * DCloud CLI 会用 `-p`/`-m`/`--outDir` 参数和这些环境变量改写实际产物，
 * 一旦被外部改掉，脚本报告的输出目录就不再是真实产物目录。
 */
export const APP_ENV_OVERRIDES = [
  "UNI_OUTPUT_DIR",
  "UNI_INPUT_DIR",
  "UNI_SUBPACKGE",
  "UNI_SUBPACKAGE",
  "UNI_MP_PLUGIN",
];

/**
 * 编译计划保持纯函数：命令、平台与已合并的环境决定 mode、生成配置、产物目录和子进程环境。
 * 子进程环境里的 NODE_ENV 会被 DCloud CLI 覆盖为同一值，这里显式传入便于测试与排错。
 */
export function runConfig({ command, platform, env, root }) {
  if (!["dev", "build"].includes(command) || !PLATFORMS.includes(platform)) {
    throw new Error("用法：run-uni.mjs dev|build h5|mp-weixin|app");
  }
  // 生产/开发各自使用正确的 Vite mode；进程环境优先于 .env 文件。
  const mode = command === "build" ? "production" : "development";
  const merged = { ...env, NODE_ENV: mode };
  const config = platformConfig(merged, platform);
  const manifest = applyPlatformManifest(
    JSON.parse(env.manifestTemplate),
    platform,
    config,
  );
  // App 回填校验后的归一化地址与超时，保证编译期校验与产物一致；H5/微信保持原样。
  const apiBaseUrl = config.apiBaseUrl ?? merged.VITE_API_BASE_URL ?? "";
  const app = platform === "app";
  return {
    mode,
    platform,
    config,
    manifest,
    // App-Plus 资源目录由 DCloud CLI 依据平台与 NODE_ENV 推导；App 由子进程 env 固定，不接受外部覆盖。
    outDir: app
      ? resolve(root, "dist", mode === "production" ? "build" : "dev", "app")
      : "",
    inDir: app ? resolve(root, "src") : "",
    env: {
      NODE_ENV: mode,
      ...(apiBaseUrl ? { VITE_API_BASE_URL: apiBaseUrl } : {}),
      // App 使用与预检同一份超时（默认沿用运行期默认 5000），避免 .env 与产物不一致。
      ...(app && config.timeout
        ? { VITE_API_TIMEOUT_MS: String(config.timeout) }
        : {}),
    },
  };
}

/**
 * 生成 DCloud CLI 的子进程参数与环境。
 * App 固定 `-p`/`-m`/`UNI_INPUT_DIR`/`UNI_OUTPUT_DIR` 并拒绝外部覆盖；
 * H5 与遗留小程序保持原有 CLI 参数透传和进程环境优先级（不从默认 mode 读出的 env 反向覆盖）。
 */
export function invocation({
  command,
  platform,
  mode,
  args,
  plan,
  processEnv,
}) {
  if (platform === "app") {
    if (args.length) {
      throw new Error(
        `App 入口由脚本固定平台、mode 与产物目录，不接受额外 CLI 参数（本次收到 ${args.length} 个）。`,
      );
    }
    const overridden = APP_ENV_OVERRIDES.filter((key) => processEnv[key]);
    if (overridden.length) {
      throw new Error(
        `App 入口不接受 ${overridden.join("、")} 覆盖；平台、mode 与输入/输出目录由脚本固定。`,
      );
    }
  }
  return {
    args: [
      ...(command === "build" ? ["build"] : []),
      "-p",
      platform,
      ...(platform === "app" ? ["-m", mode] : []),
      ...args,
    ],
    env:
      platform === "app"
        ? {
            ...processEnv,
            ...plan.env,
            UNI_INPUT_DIR: plan.inDir,
            UNI_OUTPUT_DIR: plan.outDir,
          }
        : processEnv,
  };
}
