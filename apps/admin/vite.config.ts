import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    proxy: { "/api": process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3001" },
  },
  build: { chunkSizeWarningLimit: 1100 },
  test: { environment: "jsdom", clearMocks: true },
});
