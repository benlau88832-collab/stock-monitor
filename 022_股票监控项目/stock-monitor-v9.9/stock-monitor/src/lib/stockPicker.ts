// ============================================================
// v9.52（V7-1）：标的筛选引擎 —— 把"可上车"翻译成"买这只"
// 目标：对一条"可上车"主线，输出今日上车标的清单：
//   首选（龙一打板）/ 接力（龙二龙三接力）/ 低吸（首板/回踩）
//   + 买入逻辑 + 建议仓位（positionSizing）+ 止损 + 风险点
// 复用：themeLadder 梯队 / trapDetector 排雷 / positionSizing 仓位 / leaderContend 卡位
// 说明：涨停池原始字段无个股资金流（mainNet 等），故评分用"涨停池轻量五维"
//   （封单强度/连板高度/换手承接/炸板扣分/梯队角色）；资金增强由 mainline.potential（V7-13）补充。
// ============================================================
import { detectTrap } from "./trapDetector";
import { computePositionAdvice } from "./positionSizing";
import { detectLeaderContend } from "./leaderContend";
import type { MainlineGroup } from "./stockToMainline";
import type { ThemeStock } from "./themeLadder";

export type PickRole = "首选" | "接力" | "低吸";

/** mainline.potential 候选池项（V7-13：资金增强源） */
export interface PotentialStock {
  code: string;
  name: string;
  mainNetPct: number;
  mainNet5dPct: number;
  vetoed: boolean;
  vetoReasons: string[];
}

export interface StockPick {
  code: string;
  name: string;
  pct: number;
  role: PickRole;
  /** 0-100（涨停池轻量评分） */
  pickScore: number;
  boardCount: number;
  /** 封单/成交 比值（打板强度） */
  sealFundRatio: number;
  buyLogic: string;
  entryStrategy: string;
  suggestedPct: number;
  stopLoss: number;
  risks: string[];
  /** 资金增强（mainline.potential 命中时） */
  fundNote?: string;
}

export interface PickList {
  mainline: string;
  stage: string;
  ztCount: number;
  height: number;
  picks: StockPick[];
  /** 排雷剔除（trapDetector） */
  excluded: Array<{ code: string; name: string; role: string; reason: string }>;
  /** 卡位战提示（leaderContend） */
  contend: string;
}

/** 涨停池轻量评分（无个股资金流时用）：封单30 / 连板25 / 换手承接20 / 炸板-15 / 首板-10 */
function lightScore(s: ThemeStock): { score: number; sealFundRatio: number } {
  const sealRatio = s.amount > 0 ? Math.min(3, s.sealFund / s.amount) : 0; // 封单/成交，>3 封死
  const sealScore = Math.min(30, sealRatio * 15);
  const ladderScore = Math.min(25, (s.boardCount >= 4 ? 25 : s.boardCount * 6 + 3));
  // 换手承接：3-15% 健康（过高过底都扣）
  const turn = s.turnoverRate > 0 ? (s.turnoverRate >= 3 && s.turnoverRate <= 15 ? 20 : s.turnoverRate > 25 ? 5 : 12) : 10;
  const blast = Math.max(-15, -s.blastCount * 5);
  const firstBoard = s.boardCount === 1 ? -10 : 0; // 首板不确定性略扣
  return { score: Math.max(0, Math.round(sealScore + ladderScore + turn + blast + firstBoard)), sealFundRatio: Math.round(sealRatio * 100) / 100 };
}

/** 主线阶段推导（MainlineGroup 无 stage 字段，按高度推） */
function stageOf(g: MainlineGroup): string {
  if (g.height >= 4) return "高潮期";
  if (g.height >= 2) return "发酵期";
  return "启动期";
}

/** 主入口：给一条主线 + 其涨停池 → 今日上车标的清单 */
export function pickStocks(
  mainline: MainlineGroup,
  pool: ThemeStock[],
  opts?: { gateMode?: string; strengthScore?: number | null; fundBoost?: Map<string, { mainNetPct: number; mainNet5dPct: number }> },
): PickList {
  const byCode = new Map(pool.map(s => [s.code, s]));
  const leaders = mainline.leaders ?? [];
  const stage = stageOf(mainline);
  const gateMode = opts?.gateMode ?? "full";
  const strengthScore = opts?.strengthScore ?? mainline.strengthScore ?? null;
  const picks: StockPick[] = [];
  const excluded: PickList["excluded"] = [];

  // ---- 卡位战（决定"首选"是否敢上） ----
  const contendInput = leaders.map(l => ({
    code: l.code, name: l.name,
    height: l.boardCount,
    sealFund: byCode.get(l.code)?.sealFund ?? 0,
    firstBoardTime: byCode.get(l.code)?.firstBoardTime ?? "00:00:00",
  }));
  let contend = "";
  try {
    const cr = detectLeaderContend({ mainline: mainline.mainline, leaders: contendInput });
    if (cr.status === "卡位胶着") contend = `⚠ 卡位胶着：${cr.contenders.join("、")}封单接近，龙一未定`;
    else if (cr.status === "明确龙一") contend = `龙一地位明确（${cr.leader}）`;
  } catch { /* 卡位检测失败不阻塞 */ }

  // ---- 排雷 + 评分助手 ----
  const evaluate = (s: ThemeStock, role: PickRole): { pick: StockPick; trap: string | null } | null => {
    const trap = detectTrap({
      code: s.code, name: s.name, pct: s.pct,
      sealFund: s.sealFund, amount: s.amount, blastCount: s.blastCount,
      isMainline: true,
    });
    if (trap.isTrap) {
      return { pick: undefined as unknown as StockPick, trap: `${trap.type}（置信${trap.confidence}）` };
    }
    const { score, sealFundRatio } = lightScore(s);
    // 仓位：positionSizing（闸门×强度）
    let suggestedPct = 20, stopLoss = 5;
    try {
      const adv = computePositionAdvice({
        mainline: mainline.mainline,
        strengthScore: strengthScore ?? 60,
        stage: stage as never,
        gate: { mode: gateMode as never, factor: 0.7, positionLimit: 100, riskLevel: "low", label: "stockPicker", reason: [] },
        discipline: { maxSinglePct: 30, maxTotalPct: 100, maxNewPositionsPerDay: 3, totalCapital: 1e6, cooldownLossStreak: 3 },
        currentTotalPct: 0,
        todayNewPositions: 0,
        mainlineTrap: false,
      });
      suggestedPct = adv.suggestedPct ?? 20;
      // v9.52 修正：标的清单语义 = "上这条主线就买这些、各配多少仓" —— 即使闸门收紧也保底 5% 参与仓
      // （0 仓 = 不买，清单即无意义；真正禁止应由上层"可上车"裁决拦截，而非引擎内部归零）
      suggestedPct = Math.max(5, suggestedPct);
      stopLoss = role === "首选" ? 5 : role === "接力" ? 6 : 7; // 低吸给宽止损
    } catch { /* 仓位失败用默认 */ }

    // 资金增强（potential 命中）
    const boost = opts?.fundBoost?.get(s.code);
    let fundNote: string | undefined;
    if (boost) {
      const dir = boost.mainNet5dPct > 1 ? "5日资金连续流入" : boost.mainNet5dPct < -1 ? "5日资金流出" : "资金平稳";
      fundNote = `${dir}（今日主力占比${boost.mainNetPct.toFixed(1)}%）`;
    }

    const buyLogic =
      role === "首选"
        ? `龙一（${s.boardCount}板）封单/成交 ${sealFundRatio.toFixed(2)}${sealFundRatio >= 0.5 ? "，封板坚决" : "，封单一般"}；板块梯队完整，卡位确认`
        : role === "接力"
        ? `${s.boardCount}板接力：梯队延续（晋级率支撑），换手${s.turnoverRate.toFixed(1)}% 承接健康`
        : `首板低吸：板块发酵初期，回踩不破均线可介入（资金连续流入为加分项）`;
    const entryStrategy =
      role === "首选" ? "竞价/首封打板（9:30-9:45 封单>0.8亿且不炸）" :
      role === "接力" ? "换手接力（10:00 后承接稳、不破分时均线）" :
      "低吸（回踩5日线/竞价弱转强）";

    return {
      pick: {
        code: s.code, name: s.name, pct: s.pct, role,
        pickScore: score, boardCount: s.boardCount, sealFundRatio,
        buyLogic, entryStrategy, suggestedPct, stopLoss,
        risks: trap.type !== "无明显诱多" ? [trap.type] : [role === "首选" ? "追高炸板风险" : "板块退潮风险"],
        fundNote,
      },
      trap: null,
    };
  };

  // ---- 角色分桶 ----
  const handled = new Set<string>();
  // 首选：龙一（无卡位胶着时）；胶着时给"首选=卡位胜出提示"但仍列最强
  const leader1 = leaders[0];
  if (leader1 && byCode.has(leader1.code)) {
    const s = byCode.get(leader1.code)!;
    const r = evaluate(s, "首选");
    if (r?.pick) { picks.push(r.pick); handled.add(s.code); }
    else if (r?.trap) { excluded.push({ code: s.code, name: s.name, role: "首选", reason: r.trap }); handled.add(s.code); }
  }
  // 接力：龙二/龙三 + 二板以上中 pickScore 最高（未处理的）
  const relayCandidates = [...pool]
    .filter(s => !handled.has(s.code) && s.boardCount >= 2)
    .sort((a, b) => (b.boardCount - a.boardCount) || (lightScore(b).score - lightScore(a).score));
  for (const l of leaders.slice(1, 3)) {
    if (handled.has(l.code)) continue;
    const s = byCode.get(l.code);
    if (!s) continue;
    const r = evaluate(s, "接力");
    if (r?.pick) { picks.push(r.pick); handled.add(s.code); }
    else if (r?.trap) { excluded.push({ code: s.code, name: s.name, role: "接力", reason: r.trap }); handled.add(s.code); }
  }
  for (const s of relayCandidates) {
    if (picks.filter(p => p.role === "接力").length >= 2) break;
    if (handled.has(s.code)) continue;
    const r = evaluate(s, "接力");
    if (r?.pick) { picks.push(r.pick); handled.add(s.code); }
  }
  // 低吸：首板中 pickScore 最高（≤2 只）
  const dipCandidates = pool
    .filter(s => !handled.has(s.code) && s.boardCount === 1)
    .sort((a, b) => lightScore(b).score - lightScore(a).score);
  for (const s of dipCandidates) {
    if (picks.filter(p => p.role === "低吸").length >= 2) break;
    const r = evaluate(s, "低吸");
    if (r?.pick) { picks.push(r.pick); handled.add(s.code); }
  }

  return {
    mainline: mainline.mainline,
    stage,
    ztCount: mainline.ztCount ?? pool.length,
    height: mainline.height,
    picks,
    excluded,
    contend,
  };
}
