import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { writeFileSync, mkdirSync, readFileSync } from "fs";

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

// v9.148.2（A3 P0-3）：构建时从 src/lib/version.ts 正则取 APP_VERSION 注入 title
// （两个 index.html 停止手写版本号，杜绝 title 乱码/旧版本号复发）
function injectVersionTitle() {
  return {
    name: "inject-version-title",
    transformIndexHtml(html: string) {
      const src = readFileSync(path.resolve(__dirname, "src/lib/version.ts"), "utf8");
      const m = src.match(/APP_VERSION\s*=\s*"([^"]+)"/);
      const v = m ? m[1] : "dev";
      return html.replace(/<title>[^<]*<\/title>/, `<title>A股实时交易辅助终端 ${v}</title>`);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), injectVersionTitle(), viteSingleFile(), writeNoJekyll()],
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
    // v9.84（分类统一）：src/shared/concept-groups.js 为 CJS（server require 同源），
    // 默认只处理 node_modules → 加入 include 让 rollup-commonjs 解析其 module.exports
    commonjsOptions: {
      include: [/node_modules/, /concept-groups\.js$/, /overseas-map\.js$/], // v9.103.0（T-D1）：外围映射表 CJS 共享
    },
  },
});
