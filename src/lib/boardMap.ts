// 板块映射（数据驱动）：每日刷新一次，localStorage 缓存
// 1) 股票代码 -> 申万行业（精确）
// 2) boardVocab：全部真实行业名 + 真实概念板块名（新闻文本匹配 & 产业链下拉用）
import { fetchStockIndustryMap, fetchBoardFundFlow, isRealConceptBoard } from "./api";
import { localDateStr } from "./format";

const DATE_KEY = "bm_date";
const MAP_KEY = "bm_industry_map";   // { code: industry }
const VOCAB_KEY = "bm_vocab";        // string[]
function todayStr(): string { return localDateStr(); }
function loadJSON<T>(k: string, fb: T): T {
  try { const r = localStorage.getItem(k); return r ? JSON.parse(r) as T : fb; } catch { return fb; }
}
function saveJSON(k: string, v: unknown): void {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 静默 */ }
}

/** 缓存不是今天则重建；同一天只构建一次；失败则沿用旧缓存 */
// v9.26.10：in-flight 锁（多组件并发首载只拉一次）+ 内存缓存（避免每次 parse 500 项 JSON）
let mapPromise: Promise<void> | null = null;
let memVocab: string[] | null = null;
let memMap: Record<string, string> | null = null;
function vocab(): string[] {
  if (memVocab == null) memVocab = loadJSON<string[]>(VOCAB_KEY, []);
  return memVocab;
}
function indMap(): Record<string, string> {
  if (memMap == null) memMap = loadJSON<Record<string, string>>(MAP_KEY, {});
  return memMap;
}

export async function ensureBoardMap(): Promise<void> {
  // v9.75-fix（板块加载不出）：完整度校验 —— 若今天缓存过但 map 明显残缺（<5000 只），
  // 说明是历史 bug（pz 截断/写死 40 页）产物 → 忽略日期缓存强制重建
  const cachedMap = indMap();
  const cachedDate = loadJSON<string>(DATE_KEY, "");
  const staleIncomplete = Object.keys(cachedMap).length > 0 && Object.keys(cachedMap).length < 5000;
  if (cachedDate === todayStr() && !staleIncomplete) return;
  if (mapPromise) return mapPromise;
  mapPromise = (async () => {
    try {
      const indMapData = await fetchStockIndustryMap();
      const codeCount = Object.keys(indMapData).length;
      // v9.75-fix（板块缺失）：拉取结果可能因网络中断而部分缺失 —— 若比现有缓存更全则保留，
      // 且不低于 5000 才标记当日完成（否则明天重试补全）
      if (codeCount >= Math.max(5000, Object.keys(indMap()).length)) {
        // v9.61（V9-S3）：非 debug 日志收敛到 ?debug=1
        if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1") {
          console.log(`[boardMap] 行业映射已加载: ${codeCount}个股票`);
        }
        const [ind, con] = await Promise.all([
          fetchBoardFundFlow("industry", 100, { all: "full" }),
          fetchBoardFundFlow("concept", 500, { all: "full" }),
        ]);
        const v = new Set<string>();
        ind.forEach(b => b.name && v.add(b.name));
        con.filter(b => isRealConceptBoard(b.name)).forEach(b => b.name && v.add(b.name));
        if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1") {
          console.log(`[boardMap] 板块词表已构建: ${v.size}个 (行业${ind.length}+概念${con.length})`);
        }
        saveJSON(MAP_KEY, indMapData);
        saveJSON(VOCAB_KEY, [...v]);
        saveJSON(DATE_KEY, todayStr());
        memVocab = [...v];
        memMap = indMapData;
      } else if (codeCount > Object.keys(indMap()).length) {
        // 部分成功：先存部分结果（至少覆盖大部分股票），不标记当日完成 → 明天自动补全
        if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1") {
          console.warn(`[boardMap] 行业映射部分成功(${codeCount})，保留部分结果待补全`);
        }
        saveJSON(MAP_KEY, indMapData);
        memMap = indMapData;
      }
    } catch (e) {
      // 网络失败沿用旧缓存，但打日志便于排错
      console.warn("[boardMap] 构建失败，沿用旧缓存:", e);
    }
  })();
  try { await mapPromise; } finally { mapPromise = null; }
}

/** 强制重建（清除日期缓存后重走 ensureBoardMap） */
export async function forceRebuildBoardMap(): Promise<{ vocabSize: number; mapSize: number }> {
  localStorage.removeItem(DATE_KEY);
  memVocab = null; memMap = null; // v9.26.10：清内存缓存
  await ensureBoardMap();
  const vocabList = vocab();
  const map = indMap();
  return { vocabSize: vocabList.length, mapSize: Object.keys(map).length };
}

/** 按股票代码取真实行业（精确） */
export function getIndustryByCode(code: string): string | undefined {
  return indMap()[code];
}

/** 用文本命中真实板块名（用于无股票代码的新闻/公告） */
export function matchBoardsByText(text: string): string[] {
  if (!text) return [];
  const vocabList = vocab();
  const hit = new Set<string>();
  for (const name of vocabList) { if (name && text.includes(name)) hit.add(name); }
  return [...hit];
}

/** 全部真实板块名（产业链下拉动态生成） */
export function getAllBoards(): string[] {
  return vocab();
}
