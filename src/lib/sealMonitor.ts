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

/** 相邻两轮封单快照的内存存储（模块级单例，App 高频通道调用）
 *  v9.77（P0-10）：结构扩展 base（当前衰减段的封单基准）—— 新高抬升，支持"逐步撤单式出货"累计检测
 */
let prevSealMap = new Map<string, { fund: number; ts: number; base: number }>();

/** 封单衰减阈值：环比跌超该比例 → 黄色预警 */
const YELLOW_DROP = 0.5;   // -50%
/** 封单低于该绝对额（元）且曾封板 → 视为即将开板（配合跌幅阈值） */
const RED_FLOOR = 5_000_000; // 500万
/** 快照有效窗口（毫秒）：超过该时长视为数据过期，不比较 */
const STALE_MS = 120_000;

/**
 * 检测封单衰减。传入本轮涨停池（含 fund 封单额）：
 * - 相对"衰减段基准"（该段最高封单）变化率 ≤ -50% → yellow
 * - 相对基准 ≤ -80% 且 现封单 < max(500万, 基准×10%) → red（脱离亿级封单现实，8亿→5000万也出红牌）
 * - 封单从有到 0 → red 炸板确认（原代码 fund<=0 continue 导致归零红牌永不响）
 * - 更新内部快照供下轮比较
 */
export function detectSealDecay(
  pool: Array<{ c: string; n: string; fund?: number; lbc?: number }>,
): SealAlert[] {
  const now = Date.now();
  const alerts: SealAlert[] = [];
  const current = new Map<string, { fund: number; ts: number; base: number }>();

  for (const s of pool) {
    const code = String(s.c || "");
    const fund = Number(s.fund ?? 0);
    if (!code) continue;

    const prev = prevSealMap.get(code);
    if (!prev || now - prev.ts > STALE_MS || prev.fund <= 0) {
      // 首见 / 快照过期 / 上轮未封板 → 本轮作为新基准
      current.set(code, { fund, ts: now, base: fund });
      continue;
    }

    // 逐步撤单式出货（每轮 -30% 未达单步 -50%）用累计基准：本轮封单高于段基准则抬升，否则对基准算累计衰减
    const base = fund > prev.base ? fund : prev.base;
    const changePct = fund > 0 ? (fund - base) / base : -1;

    let alert: SealAlert | null = null;
    if (fund <= 0) {
      // v9.77（P0-10）：封单从有到 0 = 炸板确认，最高优先级红牌
      alert = {
        code, name: String(s.n || code),
        prevFund: prev.fund, nowFund: 0,
        changePct: -100, level: "red",
        boardCount: Number(s.lbc ?? 1),
      };
    } else if (changePct <= -0.8 && fund < Math.max(RED_FLOOR, base * 0.1)) {
      // v9.77（P0-10）：红档脱离 500万 绝对额 —— 亿级封单崩落（如 8亿→5000万）也出红牌
      alert = {
        code, name: String(s.n || code),
        prevFund: prev.fund, nowFund: fund,
        changePct: changePct * 100, level: "red",
        boardCount: Number(s.lbc ?? 1),
      };
    } else if (changePct <= -YELLOW_DROP) {
      alert = {
        code, name: String(s.n || code),
        prevFund: prev.fund, nowFund: fund,
        changePct: changePct * 100, level: "yellow",
        boardCount: Number(s.lbc ?? 1),
      };
    }

    if (alert) {
      alerts.push(alert);
      // 告警后重置基准为当前封单 → 下一段衰减（再 -50%）才再触发，避免持续衰减刷屏
      current.set(code, { fund, ts: now, base: fund });
    } else {
      current.set(code, { fund, ts: now, base });
    }
  }

  prevSealMap = current;
  return alerts;
}

/** 测试用：注入快照（vitest 预留） */
export function __resetSealMonitor() {
  prevSealMap = new Map();
}
