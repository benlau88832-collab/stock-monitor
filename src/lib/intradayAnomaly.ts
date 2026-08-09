// ============================================================
// v9.84.3（4.2）：盘中板块集体异动前端接入
// 服务端 runIntradayBrain 每 5 分钟落 kv anomaly:日期（板块集体涨停/资金脉冲）
// 本模块 30s 轮询 → 新条目 emit alertBus（横幅+声音+标题闪烁）→ 强提示"强势资金批量接入"
// 已见条目存 localStorage 防刷新重复报；同日同类型去重
// ============================================================
import { emit } from "./alertBus";
import { isLocalServer, kvGet } from "./cloudStore";

export interface IntradayAnomaly {
  type: "集体涨停" | "资金脉冲";
  board: string;
  count?: number;
  lbc?: number;
  stocks?: string;
  pct?: number;
  mainNet?: number;
  ts: number;
  severity: "critical" | "warning";
}

const SEEN_KEY = "anomaly_seen_ids";
const POLL_MS = 30 * 1000;

function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch { return new Set(); }
}

function persistSeen(ids: Set<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-60)));
  } catch { /* 满 → 静默 */ }
}

/** 启动异动轮询（App 挂载时调用一次；返回停止函数） */
export function startAnomalyPolling(): () => void {
  if (!isLocalServer()) return () => {};
  let alive = true;
  let seen = loadSeen();

  const tick = async () => {
    if (!alive) return;
    try {
      const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      const v = (await kvGet(`anomaly:${today}`)) as IntradayAnomaly[] | null;
      if (Array.isArray(v) && v.length > 0) {
        const fresh = v.filter(a => {
          const id = `${a.board}|${a.type}|${Math.floor(Number(a.ts ?? 0) / 60000)}`; // 分钟级去重
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        if (fresh.length > 0) {
          persistSeen(seen);
          // 最多 3 条（critical 优先），避免页面打开瞬间刷屏
          const top = fresh.sort((a, b) => (a.severity === "critical" ? 0 : 1) - (b.severity === "critical" ? 0 : 1)).slice(0, 3);
          for (const a of top) {
            const msg = a.type === "集体涨停"
              ? `⚡ 板块集体涨停：${a.board} ${a.count}只（最高${a.lbc}板）${a.stocks ? " · " + a.stocks : ""}`
              : `💥 资金脉冲：${a.board} 涨${a.pct}% · 主力净流入${(Number(a.mainNet ?? 0) / 1e8).toFixed(1)}亿`;
            emit({ id: `anomaly:${a.board}`, severity: a.severity, message: msg });
          }
        }
      }
    } catch { /* 单轮失败静默（下轮重试） */ }
  };

  tick();
  const timer = setInterval(tick, POLL_MS);
  return () => { alive = false; clearInterval(timer); };
}
