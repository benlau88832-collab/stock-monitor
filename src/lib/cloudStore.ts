// ============================================================
// 云端存储同步层（v9.25-local）
// 本地部署时：数据优先读写 PostgreSQL（通过 /api/db 同源接口），localStorage 作离线缓存
// GitHub Pages 部署时：/api 不可用 → 自动降级纯 localStorage（线上行为不变）
// 数据流：
//   写：localStorage 立即写（响应快） + 异步同步到 PG
//   读：先读 localStorage（秒开），后台从 PG 拉取合并（多设备一致）
// ============================================================

const SYNC_INTERVAL = 5 * 60 * 1000; // 5 分钟增量同步

/** 当前是否运行在本地服务（存在 /api/health 即视为本地） */
let serverOk: boolean | null = null;
export function isLocalServer(): boolean {
  if (serverOk !== null) return serverOk;
  // GitHub Pages 域名为 github.io，无 /api 后端
  if (typeof window === "undefined") { serverOk = false; return false; }
  const host = window.location.hostname;
  const looksRemote = host.endsWith("github.io") || host.includes("pages.dev");
  serverOk = !looksRemote;
  return serverOk;
}

async function api(method: string, path: string, body?: unknown): Promise<any> {
  if (!isLocalServer()) return null;
  try {
    const resp = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

// ============== 通用 kv ==============
export async function kvGet(key: string): Promise<unknown> {
  const r = await api("GET", `/api/db/kv?key=${encodeURIComponent(key)}`);
  if (!r) return null;
  const v = r.value;
  if (v && typeof v === "object" && "__raw" in v) return v.__raw; // 原始字符串还原
  return v;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  // 字符串存为 {__raw} 以便还原
  const payload = typeof value === "string" ? { key, value: { __raw: value } } : { key, value };
  await api("PUT", "/api/db/kv", payload);
}

/** 批量上传（localStorage → PG 全量迁移） */
export async function kvBulk(items: Array<{ key: string; value: unknown }>): Promise<number> {
  const payload = items.map(({ key, value }) => ({
    key,
    value: typeof value === "string" ? { __raw: value } : (value ?? null),
  }));
  const r = await api("POST", "/api/db/kv/bulk", payload);
  return r?.count ?? 0;
}

// ============== 快讯 / 公告 ==============
export async function fetchNewsCloud(since: string): Promise<any[]> {
  const r = await api("GET", `/api/db/news?since=${encodeURIComponent(since)}&limit=500`);
  return Array.isArray(r) ? r : [];
}

export async function pushNewsCloud(items: any[]): Promise<void> {
  await api("POST", "/api/db/news", items);
}

export async function fetchAnnsCloud(since: string): Promise<any[]> {
  const r = await api("GET", `/api/db/anns?since=${encodeURIComponent(since)}&limit=500`);
  return Array.isArray(r) ? r : [];
}

export async function pushAnnsCloud(items: any[]): Promise<void> {
  await api("POST", "/api/db/anns", items);
}

// ============== localStorage 全量迁移 ==============
/** 把所有 localStorage key 上传到 PG（首次部署时调用） */
export async function migrateLocalStorageToCloud(): Promise<number> {
  if (!isLocalServer()) return 0;
  try {
    const items: Array<{ key: string; value: unknown }> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      try {
        const raw = localStorage.getItem(key);
        if (raw == null) continue;
        // 尝试 JSON 解析，失败存原始字符串
        let value: unknown;
        try { value = JSON.parse(raw); } catch { value = raw; }
        items.push({ key, value });
      } catch { /* skip */ }
    }
    return await kvBulk(items);
  } catch {
    return 0;
  }
}

/** 启动同步：本地有数据 → 推 PG；PG 有数据 → 拉回合并（保证多浏览器一致） */
export async function syncLocalWithCloud(): Promise<void> {
  if (!isLocalServer()) return;
  try {
    // 1. 本地 → 云端（全量迁移，幂等 upsert）
    const uploaded = await migrateLocalStorageToCloud();
    // 2. 云端 → 本地（拉回 k/v，填充本机缺失或更新的数据）
    //    只拉取关键 key（news/ann 单独处理）
    const keys = ["stock_watchlist", "daily_reviews_v1", "discipline_state_v1", "ai_settings_v1"];
    for (const key of keys) {
      try {
        const v = await kvGet(key);
        if (v != null && localStorage.getItem(key) == null) {
          localStorage.setItem(key, typeof v === "string" ? v : JSON.stringify(v));
        }
      } catch { /* skip */ }
    }
    console.log(`[cloud] sync done: uploaded=${uploaded} keys`);
  } catch (e) {
    console.warn("[cloud] sync failed:", e);
  }
}

/** 每 5 分钟把 localStorage 变化同步到 PG（增量，幂等） */
export function startAutoSync(): void {
  if (!isLocalServer()) return;
  setInterval(() => {
    migrateLocalStorageToCloud().then(n => {
      if (n > 0) console.log(`[cloud] auto-sync pushed ${n} keys`);
    });
  }, SYNC_INTERVAL);
  // 页面卸载前也同步一次
  window.addEventListener("beforeunload", () => {
    migrateLocalStorageToCloud();
  });
}
