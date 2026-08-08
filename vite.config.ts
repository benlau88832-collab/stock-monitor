import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { writeFileSync, mkdirSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 自定义插件：build 后写 .nojekyll（GitHub Pages 需要，emptyOutDir 会清掉）
function writeNoJekyll() {
  return {
    name: "write-nojekyll",
    closeBundle() {
      const outDir = path.resolve(__dirname, "docs");
      mkdirSync(outDir, { recursive: true });
      writeFileSync(path.join(outDir, ".nojekyll"), "");
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile(), writeNoJekyll()],
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
