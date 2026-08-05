// ============================================================
// v9.34（S1）：封单衰减实时监控 —— 游资打板最大雷区
// "龙一开板前 3 秒封单从 8 亿掉到 5000 万"：静态封单值没有意义，
// 必须对比相邻两轮 18s 高频快照的封单变化率。
// 封单环比 -50% → 黄色预警（开板前兆）；封单归零 → 红色炸板确认。
// ============================================================

export interface SealAlert {
  code: string;
  name: string;
  prevFund: number;   // 上轮封单（元）
  nowFund: number;    // 本轮封单（元）
  changePct: number;  // 变化率%（负 = 衰减）
  level: "yellow" | "red";
  boardCount: number; // 连板数
}

/** 相邻两轮封单快照的内存存储（模块级单例，App 高频通道调用） */
let prevSealMap = new Map<string, { fund: number; ts: number }>();

/** 封单衰减阈值：环比跌超该比例 → 黄色预警 */
const YELLOW_DROP = 0.5;   // -50%
/** 封单低于该绝对额（元）且曾封板 → 视为即将开板（配合跌幅阈值） */
const RED_FLOOR = 5_000_000; // 500万
/** 快照有效窗口（毫秒）：超过该时长视为数据过期，不比较 */
const STALE_MS = 120_000;

/**
 * 检测封单衰减。传入本轮涨停池（含 fund 封单额）：
 * - 与上一轮同代码比较，变化率 ≤ -50% → yellow
 * - 封单跌到 500万以下且变化率 ≤ -80% → red
 * - 更新内部快照供下轮比较
 */
export function detectSealDecay(
  pool: Array<{ c: string; n: string; fund?: number; lbc?: number }>,
): SealAlert[] {
  const now = Date.now();
  const alerts: SealAlert[] = [];
  const current = new Map<string, { fund: number; ts: number }>();

  for (const s of pool) {
    const code = String(s.c || "");
    const fund = Number(s.fund ?? 0);
    if (!code) continue;
    current.set(code, { fund, ts: now });

    const prev = prevSealMap.get(code);
    if (!prev) continue;
    // 过期快照不比较（涨停池偶尔抽风返回空 → 防止误报）
    if (now - prev.ts > STALE_MS) continue;
    // 上轮未封板（fund=0）或本轮未封板 → 跳过（炸板由炸板池管，不重复报）
    if (prev.fund <= 0 || fund <= 0) continue;

    const changePct = (fund - prev.fund) / prev.fund;
    if (changePct <= -0.8 && fund < RED_FLOOR) {
      alerts.push({
        code, name: String(s.n || code),
        prevFund: prev.fund, nowFund: fund,
        changePct: changePct * 100,
        level: "red",
        boardCount: Number(s.lbc ?? 1),
      });
    } else if (changePct <= -YELLOW_DROP) {
      alerts.push({
        code, name: String(s.n || code),
        prevFund: prev.fund, nowFund: fund,
        changePct: changePct * 100,
        level: "yellow",
        boardCount: Number(s.lbc ?? 1),
      });
    }
  }

  prevSealMap = current;
  return alerts;
}

/** 测试用：注入快照（vitest 预留） */
export function __resetSealMonitor() {
  prevSealMap = new Map();
}
