import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  // 构建产物输出到 /docs 目录，与源码保持在同一分支内，
  // 便于直接用 GitHub Pages 的 "Deploy from a branch /docs" 方式做实时预览，
  // 不需要额外维护独立的 gh-pages 分支。
  build: {
    outDir: "docs",
    emptyOutDir: true,
  },
});
