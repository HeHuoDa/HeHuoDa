import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  build: { chunkSizeWarningLimit: 1100 },
  test: { environment: "jsdom", clearMocks: true },
});
