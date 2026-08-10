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
      headers: { "Content-Type": "application/json", ...(await localTokenHeader()) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

// ============== v9.85.0（P0-2）：LOCAL_TOKEN 自动携带 ==============
// 服务端未配置 env LOCAL_TOKEN 时自动生成并存 kv local_token（index.js ensureLocalToken）。
// 前端 /api/ai/*、/api/proxy/* 与全部写操作自动带 x-local-token —— 服务端未启用鉴权时带也无害（放行）。
// v9.85.0：token 改经专用端点 /api/auth/local-token 读取（kv 敏感 key 已脱敏，通用 KV 不再返回 token；
//   该端点校验同源 Origin，其他 localhost 端口网页拿不到）。
// 注意：getLocalToken 用原生 fetch 而非 api()（api 会回调 localTokenHeader 形成递归）
let tokenCache: { t: string | null; ts: number } = { t: null, ts: 0 };
export async function getLocalToken(): Promise<string | null> {
  if (!isLocalServer()) return null;
  if (tokenCache.t && Date.now() - tokenCache.ts < 10 * 60 * 1000) return tokenCache.t;
  try {
    const resp = await fetch("/api/auth/local-token", { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const r = await resp.json();
    const t = r?.token ? String(r.token) : null;
    tokenCache = { t, ts: Date.now() };
    return t;
  } catch { return null; }
}
async function localTokenHeader(): Promise<Record<string, string>> {
  try {
    const t = await getLocalToken();
    return t ? { "x-local-token": t } : {};
  } catch { return {}; }
}

/**
 * v9.85.0（P0-2）：统一鉴权 fetch —— 本地部署自动携带 x-local-token。
 * 服务端写操作（POST/PUT/DELETE /api/*）统一鉴权中间件要求 token；所有写类调用改走本函数。
 * 用法：apiFetch("/api/watch/update", { method: "POST", body: JSON.stringify(x) })
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (isLocalServer()) {
    const t = await getLocalToken();
    if (t) headers.set("x-local-token", t);
  }
  return fetch(path, { ...init, headers });
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
/** 不应上传到 PG 的 key 前缀（含明文 API Key / 敏感凭据的本地配置）
 *  v9.85.2（P2-9）：AI 对话历史（ai_console_msgs）与调研会话（ai_research_ctx）含持仓讨论/个股判断，
 *  属本地隐私 —— 不上云、不跨实例恢复 */
const SKIP_UPLOAD_PREFIXES = ["ai_settings", "llm_api_key", "ai_console_msgs", "ai_research_ctx"];

// v9.81（性能）：增量同步 —— 记录上次成功上传的原始字符串，只上传变更 key。
// 原实现每 5 分钟全量扫描 + 全量 JSON.parse + stringify 全部 localStorage（MB 级主线程卡顿），
// 且服务端 kv/bulk 限 100 条/请求 —— 超出的 key 被静默截断（潜在数据丢失）。
// 现在：字符串比对（不 parse）→ 只传变更 → 分批 ≤100 → 成功后才记 lastRaw（失败下次重试）。
const lastRawByKey = new Map<string, string>();
const BULK_CHUNK = 100;

/** 把所有本地变更的 key 上传到 PG（首次调用全量，之后只传变更；幂等 upsert） */
export async function migrateLocalStorageToCloud(): Promise<number> {
  if (!isLocalServer()) return 0;
  try {
    const changed: Array<{ key: string; value: unknown }> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      // v9.75（安全修复）：跳过含明文 API Key 的配置 key ——
      // 此前全量上传会把 ai_settings_v1（含 apiKey）复制进 PG，PG 备份泄漏即 Key 泄漏
      if (SKIP_UPLOAD_PREFIXES.some(p => key.startsWith(p))) continue;
      try {
        const raw = localStorage.getItem(key);
        if (raw == null) continue;
        if (lastRawByKey.get(key) === raw) continue; // v9.81：未变更 → 跳过（不 parse）
        // 尝试 JSON 解析，失败存原始字符串
        let value: unknown;
        try { value = JSON.parse(raw); } catch { value = raw; }
        changed.push({ key, value });
      } catch { /* skip */ }
    }
    if (changed.length === 0) return 0;
    // 分批上传（服务端 kv/bulk 限 100 条/请求，超量静默截断 → 必须分块）
    let uploaded = 0;
    for (let i = 0; i < changed.length; i += BULK_CHUNK) {
      const batch = changed.slice(i, i + BULK_CHUNK);
      const n = await kvBulk(batch);
      if (n > 0) {
        // 成功后才记 lastRaw（失败不记 → 下轮重试）
        for (const { key } of batch) {
          try {
            const raw = localStorage.getItem(key);
            if (raw != null) lastRawByKey.set(key, raw);
          } catch { /* skip */ }
        }
        uploaded += n;
      }
    }
    return uploaded;
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
        // v9.85.1（P1-14）：拉回侧同样过滤敏感 key —— 原只在上传侧过滤，
        // 历史/跨实例的 ai_settings_v1、llm_api_key 可能残留在 PG，拉回会把 Key 重新写回浏览器
        // v9.85.2（P2-9）：对话/调研会话同侧过滤 —— 不跨实例恢复本地隐私
        const SENSITIVE_PREFIXES = ["ai_settings", "llm_api_key", "local_token", "push_settings_v1", "ai_console_msgs", "ai_research_ctx"];
        const safeMissing = missing.filter((k: string) => !SENSITIVE_PREFIXES.some(p => k.startsWith(p)));
        // 分批拉取（每批 50 个 key），避免单次响应过大
        for (let i = 0; i < safeMissing.length; i += 50) {
          const batch = safeMissing.slice(i, i + 50);
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
        if (isDebug()) console.log(`[cloud] pull-back: 缺失 ${safeMissing.length} 个 key 已从 PG 拉回（过滤敏感 ${missing.length - safeMissing.length} 个）`);
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
