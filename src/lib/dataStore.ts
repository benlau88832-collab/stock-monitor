// 存储抽象层（localStorage 现版 + v9.25-local 云端双写）
// PostgreSQL 后续替换此处：把读写换成 fetch('/api/news') 等，上层零改动。
// 去重 + summary 截断 + 30天滚动淘汰 + FIFO 硬上限 6000 条
// v9.25-local：本地部署时写 localStorage 的同时异步同步到 PostgreSQL（/api/db），
//             启动时从 PG 拉取合并（多浏览器一致、跨日数据不空洞）

import type { NewsItem, AnnItem } from "./llmNewsIntelligence";
import { localDateStrOffset } from "./format";
import { isLocalServer, pushNewsCloud, pushAnnsCloud, fetchNewsCloud, fetchAnnsCloud } from "./cloudStore";

const NEWS_KEY = "ds_news";
const ANN_KEY = "ds_ann";
/** 两库合计硬上限（可调） */
const HARD_LIMIT = 10000;
/** summary 截断长度（可调） */
const SUMMARY_MAX = 150;
/** 滚动淘汰天数（可调） */
const RETENTION_DAYS = 30;

// ============== 内部读写 ==============

function loadArr<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveArr<T>(key: string, arr: T[]): void {
  try { localStorage.setItem(key, JSON.stringify(arr)); }
  catch { /* localStorage 满 → 静默 */ }
}

function cutoffDate(): string {
  // 修复：用本地日期计算淘汰边界（toISOString 在 CST 凌晨会取到昨天）
  return localDateStrOffset(RETENTION_DAYS);
}

// ============== 公共接口 ==============

/** 追加/去重新闻（按 code 去重，summary 截断） */
export function upsertNews(items: NewsItem[]): void {
  try {
    const existing = loadArr<NewsItem>(NEWS_KEY);
    const codes = new Set(existing.map(n => n.code));
    let changed = false;
    for (const item of items) {
      if (!item.code || codes.has(item.code)) continue;
      codes.add(item.code);
      existing.push({
        ...item,
        summary: (item.summary ?? "").slice(0, SUMMARY_MAX),
      });
      changed = true;
    }
    if (!changed) return;
    // 30天淘汰
    const cutoff = cutoffDate();
    const filtered = existing.filter(n => (n.time ?? "").slice(0, 10) >= cutoff);
    // FIFO 硬上限
    const annCount = loadArr<AnnItem>(ANN_KEY).length;
    const budget = Math.max(100, HARD_LIMIT - annCount);
    const trimmed = filtered.length > budget ? filtered.slice(-budget) : filtered;
    saveArr(NEWS_KEY, trimmed);
    // v9.25-local：异步双写到 PostgreSQL（fire-and-forget，不阻塞）
    if (isLocalServer() && changed) {
      pushNewsCloud(trimmed.slice(-Math.min(items.length * 2, 200))).catch(() => {});
    }
  } catch { /* 静默 */ }
}

/** 追加/去重公告（按 artCode 去重） */
export function upsertAnnouncements(items: AnnItem[]): void {
  try {
    const existing = loadArr<AnnItem>(ANN_KEY);
    const codes = new Set(existing.map(a => a.artCode));
    let changed = false;
    for (const item of items) {
      if (!item.artCode || codes.has(item.artCode)) continue;
      codes.add(item.artCode);
      existing.push(item);
      changed = true;
    }
    if (!changed) return;
    const cutoff = cutoffDate();
    const filtered = existing.filter(a => (a.time ?? "").slice(0, 10) >= cutoff);
    const newsCount = loadArr<NewsItem>(NEWS_KEY).length;
    const budget = Math.max(100, HARD_LIMIT - newsCount);
    const trimmed = filtered.length > budget ? filtered.slice(-budget) : filtered;
    saveArr(ANN_KEY, trimmed);
    // v9.25-local：异步双写到 PostgreSQL
    if (isLocalServer() && changed) {
      pushAnnsCloud(trimmed.slice(-Math.min(items.length * 2, 200))).catch(() => {});
    }
  } catch { /* 静默 */ }
}

// ============== v9.25-local：云端拉取合并（启动/定时调用） ==============
/** 从 PostgreSQL 拉取近 N 天 news/ann，合并进 localStorage（补齐空洞、多设备一致） */
export async function syncNewsFromCloud(days = 3): Promise<void> {
  if (!isLocalServer()) return;
  try {
    const since = localDateStrOffset(days);
    const [cloudNews, cloudAnns] = await Promise.all([
      fetchNewsCloud(since),
      fetchAnnsCloud(since),
    ]);
    if (Array.isArray(cloudNews) && cloudNews.length > 0) upsertNews(cloudNews as NewsItem[]);
    if (Array.isArray(cloudAnns) && cloudAnns.length > 0) upsertAnnouncements(cloudAnns as AnnItem[]);
    console.log(`[cloud] syncNews: news=${cloudNews?.length ?? 0} ann=${cloudAnns?.length ?? 0}`);
  } catch { /* 网络失败静默，下次再试 */ }
}

// ============== v9.26.8：分析数据直接读 PostgreSQL（本地部署，突破 localStorage 5MB） ==============
/** 返回类型：全量快讯/公告 + 统计（供全栈情报分析等直接使用） */
export interface CloudAnalysisData {
  news: NewsItem[];
  ann: AnnItem[];
  newsCount: number;
  annCount: number;
  totalCount: number;
  oldestDate: string | null;
  fromCloud: boolean;
}

/**
 * 本地部署时直接从 PG 拉取分析数据（绕过 localStorage，无 5MB 上限）。
 * 线上 GitHub Pages 返回 null（组件回退 localStorage 数据源）。
 */
export async function fetchAnalysisDataFromCloud(sinceDays = 30): Promise<CloudAnalysisData | null> {
  if (!isLocalServer()) return null;
  try {
    const since = localDateStrOffset(sinceDays);
    const [cloudNews, cloudAnns] = await Promise.all([
      fetchNewsCloud(since),
      fetchAnnsCloud(since),
    ]);
    const news = Array.isArray(cloudNews) ? (cloudNews as NewsItem[]) : [];
    const ann = Array.isArray(cloudAnns) ? (cloudAnns as AnnItem[]) : [];
    const allTimes = [...news.map(n => n.time), ...ann.map(a => a.time)].filter(Boolean).sort();
    return {
      news,
      ann,
      newsCount: news.length,
      annCount: ann.length,
      totalCount: news.length + ann.length,
      oldestDate: allTimes.length > 0 ? allTimes[0].slice(0, 10) : null,
      fromCloud: true,
    };
  } catch {
    return null; // 网络失败 → 回退 localStorage
  }
}

/** 按板块查新闻（板块名模糊匹配 boards 数组） */
export function getNewsByBoard(board: string, days = 7): NewsItem[] {
  try {
    const cutoff = localDateStrOffset(days);
    return loadArr<NewsItem>(NEWS_KEY).filter(n =>
      (n.time ?? "").slice(0, 10) >= cutoff && n.boards?.some(b => b.includes(board) || board.includes(b))
    );
  } catch { return []; }
}

/** 按板块查公告（boards 数组模糊匹配） */
export function getAnnByBoard(board: string, days = 7): AnnItem[] {
  try {
    const cutoff = localDateStrOffset(days);
    return loadArr<AnnItem>(ANN_KEY).filter(a =>
      (a.time ?? "").slice(0, 10) >= cutoff &&
      (a as any).boards?.some((b: string) => b.includes(board) || board.includes(b))
    );
  } catch { return []; }
}

/** 产业链追溯：新闻+公告合并 */
export function getChainItems(board: string, days = 7): { news: NewsItem[]; ann: AnnItem[] } {
  return { news: getNewsByBoard(board, days), ann: getAnnByBoard(board, days) };
}

/** 精确取某一日全部素材（日期格式 YYYY-MM-DD） */
export function getAllOnDate(dateStr: string): { news: NewsItem[]; ann: AnnItem[] } {
  try {
    const isOn = (t: string) => (t ?? "").slice(0, 10) === dateStr;
    return {
      news: loadArr<NewsItem>(NEWS_KEY).filter(n => isOn(n.time)),
      ann:  loadArr<AnnItem>(ANN_KEY).filter(a => isOn(a.time)),
    };
  } catch { return { news: [], ann: [] }; }
}

/** 获取指定日期之后的全部新闻+公告 */
export function getAllSince(dateStr: string): { news: NewsItem[]; ann: AnnItem[] } {
  try {
    return {
      news: loadArr<NewsItem>(NEWS_KEY).filter(n => (n.time ?? "").slice(0, 10) >= dateStr),
      ann: loadArr<AnnItem>(ANN_KEY).filter(a => (a.time ?? "").slice(0, 10) >= dateStr),
    };
  } catch { return { news: [], ann: [] }; }
}

/** 获取存储统计 */
export function getStats(): { newsCount: number; annCount: number; totalCount: number; oldestDate: string | null } {
  try {
    const news = loadArr<NewsItem>(NEWS_KEY);
    const ann = loadArr<AnnItem>(ANN_KEY);
    const allTimes = [...news.map(n => n.time), ...ann.map(a => a.time)].filter(Boolean).sort();
    return {
      newsCount: news.length,
      annCount: ann.length,
      totalCount: news.length + ann.length,
      oldestDate: allTimes.length > 0 ? allTimes[0].slice(0, 10) : null,
    };
  } catch { return { newsCount: 0, annCount: 0, totalCount: 0, oldestDate: null }; }
}
