// P3-3：PWA Service Worker —— 离线缓存 + 可安装
// 注意：本项目是 vite-plugin-singlefile 单文件产物（docs/index.html 内联全部 JS/CSS），
// SW 只需缓存 index.html 本体即可实现"离线打开最近一次版本"。
// v9.83.1：CACHE v1→v2 —— 触发 SW 更新并清掉旧缓存（activate 删除非当前 CACHE）
// v9.99.1：CACHE v2→v3 —— ①fetch 显式 { cache: "no-store" }：服务端 ETag + max-age=0 时
//   SW 的 fetch() 会拿到 304 回退 HTTP 磁盘缓存的旧 body（network-first 形同虚设，发新版页面旧版 JS 的坑）；
//   ②v3 强制旧 SW 退役（activate 清 v2 缓存）
// v9.113.1（T1-1）：CACHE v28→v29 —— 主面板 PG-first 改造发版
// v9.114.0（T5-3）：SW 版本强制更新 —— CACHE 名 +1 同时，activate 通知所有打开页面强制 reload，
//   消除"需硬刷新"约定（浏览器可能持旧 SW/旧页面；skipWaiting 已保证新 SW 立即接管）
// v9.122.0（卓越 S3-2b）：CACHE v37→v38 —— 前瞻预判接入发版
// v9.123.0（卓越审查修复）：CACHE v38→v39 —— 决策卡游资战术/认知时段/资金明暗盘前端口径发版
// v9.125.0（蓝图批次 B）：CACHE v39→v40 —— 个股雷达资讯聚合区发版（v9.124 纯服务端未 +1）
// v9.128.0（一致性审查修复）：CACHE v40→v41 —— 决策卡阶段口径/决策窗口边界/颜色惯例前端发版
// v9.129.0（一致性收敛重构）：CACHE v41→v42 —— 情绪体系单源化（情绪分/阶段词表四面板同口径）
// v9.130.0（终审修复批次）：CACHE v42→v43 —— 竞价五步流水/竞价作战区上移/个股监控资讯聚合
// v9.131.0（终审修复批次二）：CACHE v43→v44 —— 场景真实数据/纪律教练接线/推送去重
// v9.132.0（终审复核 D2 修正）：CACHE v44→v45 —— 竞价上车机会候选池修复
// v9.133.0（游资改造·阶段一）：CACHE v45→v46 —— 三时段作战台布局收敛
// v9.135.0（游资改造·阶段二~五）：CACHE v46→v47 —— 交易闭环/主线徽标/阈值收口/竞价补强
// v9.136.0（交接 0813 五任务批次）：主线单源/闸门收敛/decisions 契约/台账闭环 发版
const CACHE = "stock-monitor-v48";
const CORE = ["./", "./index.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      // 清理旧缓存（CACHE 名每次 +1，旧缓存一律删除）
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
      // v9.114.0（T5-3）：新 SW 激活 = 新版本上线 → 通知所有窗口强制刷新（无硬刷新即生效）
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      wins.forEach((c) => c.postMessage({ type: "FORCE_RELOAD" }));
    })()
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // 仅缓存同源文档/静态资源；API 请求不缓存（实时数据）
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  // 网络优先，失败回退缓存（离线可看最近一次版本）
  // v9.99.1：cache: "no-store" —— 绕过 HTTP 磁盘缓存（ETag/max-age=0 场景下 304 会回退旧 body）
  e.respondWith(
    fetch(req, { cache: "no-store" })
      .then((resp) => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
  );
});
