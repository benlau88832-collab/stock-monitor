import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
// v9.25-local：本地部署云端同步（PG 双写 + localStorage 迁移 + 定时增量）
import { syncLocalWithCloud, startAutoSync } from "./lib/cloudStore";
import { syncNewsFromCloud } from "./lib/dataStore";

// 启动即同步：本地 localStorage → PG；PG news/ann → 本地合并（跨浏览器一致）
// GitHub Pages 上 isLocalServer()=false 自动跳过，线上行为不变
// v9.26.4：拉取窗口 3→10 天，覆盖 Chrome localStorage 恢复的历史（7/29~8/4）
syncLocalWithCloud();
syncNewsFromCloud(10);
startAutoSync();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
