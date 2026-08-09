// 概念词根合并表（v9.26.15 方案A：纯概念级聚类）
// 用户视角的"涨停原因"大类 ← 东财 datacenter 概念名（词根匹配）
// 与开盘啦/同花顺口径对齐：一只股票的一堆概念（通信/5G/光模块/华为…）折叠成一个用户熟悉的大类
//
// 用法：
//   conceptGroupOf("光模块") → "通信"
//   conceptGroupOf("PCB")    → "元器件"
//   无法折叠 → 原样返回（作为独立题材）
// v9.84（分类统一）：词表数据移至 src/shared/concept-groups.js（服务端 cron 同 require 这一份），
// 本文件只保留匹配函数 —— 消灭前后端双源漂移

import { CONCEPT_GROUPS } from "../shared/concept-groups.js";
export type { ConceptGroupDef } from "../shared/concept-groups.js";

/** 概念名 → 用户大类（V7-5：最长词根优先，同长按表序；无匹配返回 null） */
export function conceptGroupOf(conceptName: string): string | null {
  if (!conceptName) return null;
  let best: { group: string; len: number } | null = null;
  for (const def of CONCEPT_GROUPS) {
    for (const root of def.roots) {
      if (root.length < 2) continue; // V7-4：拒绝单字词根（防 硅/铜/铝 误命中）
      if (conceptName.includes(root)) {
        // 最长词根优先（"激光雷达"5字 > "雷达"2字 → 智能驾驶）；
        // 同长时靠本表顺序（前面的优先，故具体组尽量靠前定义）
        if (!best || root.length > best.len) {
          best = { group: def.group, len: root.length };
        }
      }
    }
  }
  return best?.group ?? null;
}

// v9.55（V7-6，P2 轻量版）：歧义概念检测 —— 命中 ≥2 个不同大类的概念名
// 供未来 LLM 二次确认（规则为主、LLM 兜底歧义）：命中歧义才调 Agnes，结果可缓存
export function ambiguousConcepts(conceptName: string): string[] | null {
  if (!conceptName) return null;
  const groups = new Set<string>();
  for (const def of CONCEPT_GROUPS) {
    for (const root of def.roots) {
      if (root.length >= 2 && conceptName.includes(root)) {
        groups.add(def.group);
        break;
      }
    }
  }
  return groups.size >= 2 ? [...groups] : null;
}

// v9.59（V8-7）：主线名 → 板块资金名反向映射
// LLM 起的主线名（"人工智能"）与 foldBoardFunds 折叠 key（"AI应用"）字面不同 → 匹配失败。
// 该函数以"主线名折叠后的大类"为桥梁：返回 boards 中折叠归属同一大类的板块名，
// 比纯模糊 includes 稳（"人工智能"→折叠"AI应用"→命中"AI应用/算力/服务器"等板块）。
export function mainlineToBoardNames(mainline: string, boards: BoardFund[]): string[] {
  if (!mainline || boards.length === 0) return [];
  const mg = conceptGroupOf(mainline) ?? mainline;
  return boards
    .filter(b => {
      const bg = conceptGroupOf(b.name) ?? b.name;
      return bg === mainline || bg === mg || b.name === mainline;
    })
    .map(b => b.name);
}

/** 把一批概念名折叠成用户大类集合（含无法折叠的原名） */
export function foldConcepts(concepts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of concepts) {
    const g = conceptGroupOf(c) ?? c;
    if (!seen.has(g)) { seen.add(g); out.push(g); }
  }
  return out;
}

// ============== 板块资金流聚合（v9.26.16） ==============
// 把 boards 列表（"人工智能"/"AI眼镜" 等原始名）折叠成用户大类（"AI应用"等）并聚合资金
// 解决：主线名是用户大类（"AI应用"），但 boards 原始名是细分概念（"人工智能"），模糊匹配对不上 → 资金 0
export interface BoardFund {
  name: string;
  pct: number;
  mainNet: number;
  mainNet5d?: number;
  mainNet5dPct?: number;
  /** v9.60（V9-D1）：该板块关键资金字段缺失（东财改字段）→ 折叠聚合后透传，UI 显示"数据缺失" */
  dataMissing?: boolean;
}

/** 把 boards 按用户大类折叠聚合资金（同大类的所有细分概念资金累加） */
export function foldBoardFunds(boards: BoardFund[]): Map<string, BoardFund> {
  const map = new Map<string, BoardFund>();
  for (const b of boards) {
    const g = conceptGroupOf(b.name) ?? b.name;
    const prev = map.get(g);
    if (prev) {
      prev.mainNet += b.mainNet;
      prev.mainNet5d = (prev.mainNet5d ?? 0) + (b.mainNet5d ?? 0);
      prev.mainNet5dPct = ((prev.mainNet5dPct ?? 0) + (b.mainNet5dPct ?? 0)) / 2; // 简单平均
      // pct 取加权（mainNet 绝对值大的板块更代表该大类）
      const totalAbs = Math.abs(prev.mainNet) + Math.abs(b.mainNet);
      prev.pct = totalAbs > 0
        ? (prev.pct * Math.abs(prev.mainNet) + b.pct * Math.abs(b.mainNet)) / totalAbs
        : prev.pct;
      // v9.60（V9-D1）：任一成员缺失 → 聚合结果也标缺失（不掩盖局部字段缺失）
      if (b.dataMissing) prev.dataMissing = true;
    } else {
      map.set(g, { name: g, pct: b.pct, mainNet: b.mainNet, mainNet5d: b.mainNet5d, mainNet5dPct: b.mainNet5dPct, dataMissing: b.dataMissing });
    }
  }
  return map;
}
