// P3-3：PWA Service Worker —— 离线缓存 + 可安装
// 注意：本项目是 vite-plugin-singlefile 单文件产物（docs/index.html 内联全部 JS/CSS），
// SW 只需缓存 index.html 本体即可实现"离线打开最近一次版本"。
const CACHE = "stock-monitor-v1";
const CORE = ["./", "./index.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // 仅缓存同源文档/静态资源；API 请求不缓存（实时数据）
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  // 网络优先，失败回退缓存（离线可看最近一次版本）
  e.respondWith(
    fetch(req)
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
