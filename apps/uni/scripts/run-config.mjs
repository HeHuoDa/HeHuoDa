import { resolve } from "node:path";
import { applyPlatformManifest, platformConfig } from "./platform-config.mjs";

export const PLATFORMS = ["h5", "mp-weixin", "app"];

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
  // App 回填校验后的归一化地址，保证编译期校验与产物一致；H5/微信保持原样。
  const apiBaseUrl = config.apiBaseUrl ?? merged.VITE_API_BASE_URL ?? "";
  return {
    mode,
    platform,
    config,
    manifest,
    // App-Plus 资源目录由 DCloud CLI 依据平台与 NODE_ENV 推导，不接受外部覆盖。
    outDir:
      platform === "app"
        ? resolve(root, "dist", mode === "production" ? "build" : "dev", "app")
        : "",
    env: {
      NODE_ENV: mode,
      ...(apiBaseUrl ? { VITE_API_BASE_URL: apiBaseUrl } : {}),
    },
  };
}
