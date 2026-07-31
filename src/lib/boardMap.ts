// 板块映射（数据驱动）：每日刷新一次，localStorage 缓存
// 1) 股票代码 -> 申万行业（精确）
// 2) boardVocab：全部真实行业名 + 真实概念板块名（新闻文本匹配 & 产业链下拉用）
import { fetchStockIndustryMap, fetchBoardFundFlow, isRealConceptBoard } from "./api";

const DATE_KEY = "bm_date";
const MAP_KEY = "bm_industry_map";   // { code: industry }
const VOCAB_KEY = "bm_vocab";        // string[]
function todayStr(): string { return new Date().toISOString().slice(0, 10); }
function loadJSON<T>(k: string, fb: T): T {
  try { const r = localStorage.getItem(k); return r ? JSON.parse(r) as T : fb; } catch { return fb; }
}
function saveJSON(k: string, v: unknown): void {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 静默 */ }
}

/** 缓存不是今天则重建；同一天只构建一次；失败则沿用旧缓存 */
export async function ensureBoardMap(): Promise<void> {
  if (loadJSON<string>(DATE_KEY, "") === todayStr()) return;
  try {
    const indMap = await fetchStockIndustryMap();
    const codeCount = Object.keys(indMap).length;
    console.log(`[boardMap] 行业映射已加载: ${codeCount}个股票`);
    const [ind, con] = await Promise.all([
      fetchBoardFundFlow("industry", 100),
      fetchBoardFundFlow("concept", 500),
    ]);
    const vocab = new Set<string>();
    ind.forEach(b => b.name && vocab.add(b.name));
    con.filter(b => isRealConceptBoard(b.name)).forEach(b => b.name && vocab.add(b.name));
    console.log(`[boardMap] 板块词表已构建: ${vocab.size}个 (行业${ind.length}+概念${con.length})`);
    saveJSON(MAP_KEY, indMap);
    saveJSON(VOCAB_KEY, [...vocab]);
    saveJSON(DATE_KEY, todayStr());
  } catch (e) {
    // 网络失败沿用旧缓存，但打日志便于排错
    console.warn("[boardMap] 构建失败，沿用旧缓存:", e);
  }
}

/** 强制重建（清除日期缓存后重走 ensureBoardMap） */
export async function forceRebuildBoardMap(): Promise<{ vocabSize: number; mapSize: number }> {
  localStorage.removeItem(DATE_KEY);
  await ensureBoardMap();
  const vocab = loadJSON<string[]>(VOCAB_KEY, []);
  const map = loadJSON<Record<string, string>>(MAP_KEY, {});
  return { vocabSize: vocab.length, mapSize: Object.keys(map).length };
}

/** 按股票代码取真实行业（精确） */
export function getIndustryByCode(code: string): string | undefined {
  return loadJSON<Record<string, string>>(MAP_KEY, {})[code];
}

/** 用文本命中真实板块名（用于无股票代码的新闻/公告） */
export function matchBoardsByText(text: string): string[] {
  if (!text) return [];
  const vocab = loadJSON<string[]>(VOCAB_KEY, []);
  const hit = new Set<string>();
  for (const name of vocab) { if (name && text.includes(name)) hit.add(name); }
  return [...hit];
}

/** 全部真实板块名（产业链下拉动态生成） */
export function getAllBoards(): string[] {
  return loadJSON<string[]>(VOCAB_KEY, []);
}
