import { db } from "@/db";
import { fundFlowSnapshots } from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import type {
  FundFlowRow,
  MainlineBoard,
  MainlineStage,
  MarketFundStructure,
  PotentialStock,
} from "./types";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// 将一条真实抓取到的资金结构数据写入历史快照表（用于积累连续性判断的样本）。
export async function upsertSnapshot(params: {
  scope: "market" | "sector" | "stock";
  code: string;
  name: string;
  pctChange?: number | null;
  mainNet?: number | null;
  mainNet5d?: number | null;
  mainNet10d?: number | null;
  extraLargeNet?: number | null;
  largeNet?: number | null;
  mediumNet?: number | null;
  smallNet?: number | null;
  northNet?: number | null;
}) {
  try {
    const date = todayStr();
    const values = {
      scope: params.scope,
      code: params.code,
      name: params.name,
      tradeDate: date,
      pctChange: params.pctChange != null ? String(params.pctChange) : null,
      mainNet: params.mainNet != null ? String(params.mainNet) : null,
      mainNet5d: params.mainNet5d != null ? String(params.mainNet5d) : null,
      mainNet10d: params.mainNet10d != null ? String(params.mainNet10d) : null,
      extraLargeNet: params.extraLargeNet != null ? String(params.extraLargeNet) : null,
      largeNet: params.largeNet != null ? String(params.largeNet) : null,
      mediumNet: params.mediumNet != null ? String(params.mediumNet) : null,
      smallNet: params.smallNet != null ? String(params.smallNet) : null,
      northNet: params.northNet != null ? String(params.northNet) : null,
    };
    await db
      .insert(fundFlowSnapshots)
      .values(values)
      .onConflictDoUpdate({
        target: [fundFlowSnapshots.scope, fundFlowSnapshots.code, fundFlowSnapshots.tradeDate],
        set: values,
      });
  } catch {
    // 快照仅用于增强大局观展示，失败不影响主流程
  }
}

export async function getRecentSnapshots(scope: string, code: string, days = 5) {
  try {
    const rows = await db
      .select()
      .from(fundFlowSnapshots)
      .where(and(eq(fundFlowSnapshots.scope, scope), eq(fundFlowSnapshots.code, code)))
      .orderBy(desc(fundFlowSnapshots.tradeDate))
      .limit(days);
    return rows;
  } catch {
    return [];
  }
}

// ---------------- 市场资金结构 · 一票否决判断 ----------------
export function judgeMarketStructure(params: {
  mainNet: number;
  extraLargeNet: number;
  largeNet: number;
  mediumNet: number;
  smallNet: number;
  mainNet5d: number;
  mainNet10d: number;
  northAvailable: boolean;
  northNet: number;
  northNote: string;
}): MarketFundStructure {
  const { mainNet, extraLargeNet, largeNet, mediumNet, smallNet, mainNet5d, mainNet10d } = params;
  const reasons: string[] = [];
  let verdict: MarketFundStructure["verdict"] = "healthy";
  let vetoTriggered = false;

  const mainOutRetailIn = mainNet < 0 && smallNet > 0;
  const persistentOutflow = mainNet5d < 0 && mainNet10d < 0;

  if (mainOutRetailIn && persistentOutflow) {
    vetoTriggered = true;
    verdict = "danger";
    reasons.push("今日主力资金净流出且散户（小单）净流入，同时近5日、近10日主力资金均为净流出 —— 典型「主力出、散户进」结构，一票否决");
  } else if (mainOutRetailIn) {
    verdict = "warning";
    reasons.push("今日出现「主力净流出 + 散户净流入」结构，需警惕分歧加大，暂不建议加仓");
  } else if (mainNet5d < 0 && mainNet < 0) {
    verdict = "warning";
    reasons.push("主力资金连续净流出（今日 + 近5日），资金面偏弱");
  } else if (mainNet > 0 && mainNet5d > 0) {
    verdict = "healthy";
    reasons.push("今日与近5日主力资金均为净流入，资金面结构健康");
  } else {
    verdict = "caution";
    reasons.push("资金结构处于分歧状态，今日与近5日方向不一致，建议观望为主");
  }

  let actionHint = "";
  if (vetoTriggered) actionHint = "当前结构不适合加仓，存量仓位应考虑控制风险、逢反弹减仓。";
  else if (verdict === "warning") actionHint = "可小仓位试探，严格设置止损，不宜重仓追涨。";
  else if (verdict === "healthy") actionHint = "资金面支持顺势操作，仍需结合个股风险雷达确认。";
  else actionHint = "建议观望，等待资金结构方向进一步明确。";

  return {
    available: true,
    today: { mainNet, extraLargeNet, largeNet, mediumNet, smallNet },
    mainNet5d,
    mainNet10d,
    north: { available: params.northAvailable, net: params.northNet, note: params.northNote },
    verdict,
    vetoTriggered,
    reasons,
    actionHint,
  };
}

// ---------------- 主线阶段判断 ----------------
export function judgeMainlineStage(b: {
  pct: number;
  mainNetPct: number;
  mainNet5dPct: number;
  mainNet10dPct: number;
}): { stage: MainlineStage; reason: string } {
  const { pct, mainNetPct, mainNet5dPct, mainNet10dPct } = b;

  if (mainNetPct < 0 && mainNet5dPct < 0) {
    return { stage: "退潮期", reason: "今日与近5日主力净占比均为负，资金持续撤出，赚钱效应消退" };
  }
  if (pct >= 7 && (mainNetPct < mainNet5dPct - 1 || mainNetPct < 0)) {
    return { stage: "高潮期", reason: "涨幅已明显放大但今日主力净占比走弱甚至转负，量价背离，警惕高位分歧" };
  }
  if (mainNet5dPct > 3 && mainNet10dPct > 1 && mainNetPct > 0) {
    return { stage: "发酵期", reason: "近5日、近10日主力净占比持续为正且在走强，资金介入意愿仍在提升" };
  }
  if (mainNetPct > 0 && Math.abs(mainNet5dPct) < 1.5) {
    return { stage: "启动期", reason: "今日资金净流入转正，但近5日累计净占比尚小，可能是刚启动的资金迹象" };
  }
  return { stage: "观察中", reason: "资金与涨幅信号不够一致，暂无法给出明确阶段判断" };
}

export function boardWeight(stage: MainlineStage): MainlineBoard["weight"] {
  if (stage === "高潮期" || stage === "退潮期") return "降级观察";
  if (stage === "观察中") return "谨慎参与";
  return "推荐关注";
}

// ---------------- 潜力股一票否决过滤 ----------------
export function evaluatePotentialStock(row: FundFlowRow, boardName: string): PotentialStock {
  const vetoReasons: string[] = [];
  const mainNet = row.mainNet ?? 0;
  const smallNet = row.smallNet ?? 0;
  const mainNet5d = row.mainNet5d ?? row.mainNet ?? 0;
  const turnoverRate = row.turnoverRate ?? 0;
  const volumeRatio = row.volumeRatio ?? 0;
  const pct = row.pct ?? 0;

  if (mainNet < 0 && smallNet > 0) {
    vetoReasons.push("主力净流出而散户（小单）净流入，结构不健康");
  }
  if (mainNet5d < 0 && pct > 5) {
    vetoReasons.push("近5日主力资金净流出，但今日涨幅偏大，量价背离");
  }
  if (turnoverRate > 25) {
    vetoReasons.push("换手率过高（>25%），交易过度拥挤，博弈风险大");
  }
  if (pct >= 9.8) {
    vetoReasons.push("已涨停，短线博弈风险陡增，非新入场时机");
  }

  let crowding: PotentialStock["crowding"] = "正常";
  if (turnoverRate > 20 || volumeRatio > 3) crowding = "极度拥挤";
  else if (turnoverRate > 10 || volumeRatio > 1.8) crowding = "偏高";

  return {
    code: row.code,
    name: row.name,
    price: row.price ?? 0,
    pct,
    mainNet,
    mainNetPct: row.mainNetPct ?? 0,
    turnoverRate,
    volumeRatio,
    pe: row.pe ?? null,
    boardName,
    vetoed: vetoReasons.length > 0,
    vetoReasons,
    crowding,
    riskTags: [],
  };
}

export { sql };
