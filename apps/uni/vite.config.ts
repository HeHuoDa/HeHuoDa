import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import uni from "@dcloudio/vite-plugin-uni";
import { WeappTailwindcss } from "weapp-tailwindcss/vite";

const require = createRequire(resolve(__dirname, "package.json"));

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, __dirname, "");
  return {
    plugins: [
      uni(),
      WeappTailwindcss({
        cssEntries: [resolve(__dirname, "src/app.css")],
        cssOptions: { rem2rpx: true },
      }),
    ],
    // uni-app H5 保留软链路径，devtools 的传递依赖因此丢失包边界。
    // 只将 H5 devtools 入口指向真实路径；小程序继续使用 DCloud 的平台适配。
    ...(process.env.UNI_PLATFORM === "h5"
      ? {
          resolve: {
            alias: {
              "@vue/devtools-api": realpathSync(
                require.resolve("@vue/devtools-api"),
              ),
            },
          },
        }
      : {}),
    server: {
      host: "127.0.0.1",
      port: 5174,
      ...(command === "serve" && mode === "development"
        ? {
            proxy: {
              "/api": {
                target: env.UNI_DEV_API_TARGET || "http://127.0.0.1:3001",
                changeOrigin: true,
              },
            },
          }
        : {}),
    },
  };
});
