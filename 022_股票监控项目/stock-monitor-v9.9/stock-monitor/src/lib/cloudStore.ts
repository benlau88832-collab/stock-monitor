// ============================================================
// 云端存储同步层（v9.25-local）
// 本地部署时：数据优先读写 PostgreSQL（通过 /api/db 同源接口），localStorage 作离线缓存
// GitHub Pages 部署时：/api 不可用 → 自动降级纯 localStorage（线上行为不变）
// 数据流：
//   写：localStorage 立即写（响应快） + 异步同步到 PG
//   读：先读 localStorage（秒开），后台从 PG 拉取合并（多设备一致）
// ============================================================

const SYNC_INTERVAL = 5 * 60 * 1000; // 5 分钟增量同步

// v9.61（V9-S3）：非 debug 的 console.log 收敛到 ?debug=1 开关 —— 生产静默，排查时开 debug 看
// v14-8（P2）：isDebug 导出供其他模块复用（boardMap/dataStore/App 的 log 统一门控）
export function isDebug(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("debug") === "1";
}

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
    // v9.26.6：全量拉回 PG 历史 key（seats/playbook/rec_tracker/sentiment/ai缓存等），
    //          只填本机缺失的 key，不覆盖本地已有数据（避免覆盖新写入）
    try {
      const kr = await api("GET", "/api/db/kv/keys");
      if (kr && Array.isArray(kr.keys) && kr.keys.length > 0) {
        const localKeys = new Set<string>();
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k) localKeys.add(k);
        }
        const missing = kr.keys.filter((k: string) => !localKeys.has(k));
        // 分批拉取（每批 50 个 key），避免单次响应过大
        for (let i = 0; i < missing.length; i += 50) {
          const batch = missing.slice(i, i + 50);
          const br = await api("GET", `/api/db/kv/bulk?keys=${encodeURIComponent(batch.join(","))}`);
          if (br && Array.isArray(br.items)) {
            for (const item of br.items) {
              try {
                const val = item.value;
                if (val && typeof val === "object" && "__raw" in val) {
                  localStorage.setItem(item.key, String(val.__raw));
                } else if (val != null) {
                  localStorage.setItem(item.key, JSON.stringify(val));
                }
              } catch { /* localStorage 满 → 跳过 */ }
            }
          }
        }
        if (isDebug()) console.log(`[cloud] pull-back: 缺失 ${missing.length} 个 key 已从 PG 拉回`);
      }
    } catch (e) {
      console.warn("[cloud] pull-back failed:", e);
    }
    if (isDebug()) console.log(`[cloud] sync done: uploaded=${uploaded} keys`);
  } catch (e) {
    console.warn("[cloud] sync failed:", e);
  }
}

/** 每 5 分钟把 localStorage 变化同步到 PG（增量，幂等） */
export function startAutoSync(): void {
  if (!isLocalServer()) return;
  setInterval(() => {
    migrateLocalStorageToCloud().then(n => {
      if (n > 0 && isDebug()) console.log(`[cloud] auto-sync pushed ${n} keys`);
    });
  }, SYNC_INTERVAL);
  // 页面卸载前也同步一次
  window.addEventListener("beforeunload", () => {
    migrateLocalStorageToCloud();
  });
}
