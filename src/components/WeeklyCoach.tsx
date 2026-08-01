import { useState, useEffect, useRef, useCallback } from "react";
import { callAI, type AIResult } from "../lib/ai";
import { getHitRateForPrompt } from "../lib/recTracker";
import { localDateStrOffset } from "../lib/format";

// 周报教练：周五15:30后或周末首次打开触发
// 存 weekly:YYYY-Www key，可回看历史

const WEEKLY_PREFIX = "weekly:";

function getBJNow(): Date { return new Date(); }

function getISOWeek(d: Date): string {
  // ISO 周号计算
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const days = Math.floor((d.getTime() - jan1.getTime()) / 86400000);
  const weekNum = Math.ceil((days + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function weekKey(): string {
  return WEEKLY_PREFIX + getISOWeek(getBJNow());
}

// 加载本周教练结果
function loadWeeklyCoach(): { text: string; degraded: boolean; ts: number } | null {
  try {
    const raw = localStorage.getItem(weekKey());
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveWeeklyCoach(text: string, degraded: boolean): void {
  try {
    localStorage.setItem(weekKey(), JSON.stringify({ text, degraded, ts: Date.now() }));
    // 清理旧周数据，保留最近8周
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(WEEKLY_PREFIX)) keys.push(k);
    }
    keys.sort().reverse();
    for (let i = 8; i < keys.length; i++) localStorage.removeItem(keys[i]);
  } catch { /* 静默 */ }
}

// 获取本周 playbook 条目
function getWeekPlaybookEntries(): Array<{
  date: string; plan: string; executed: string | null;
  aiHitRate: string; sentiment: number | null;
}> {
  const today = new Date();
  // 修复：直接用本地日期计算周一（toISOString 在 CST 凌晨会取到昨天，且 +86400000 在跨日时漂移）
  // 周一距今天数：周日为 6 天前，其他为 (周几-1) 天前
  const mondayDaysAgo = today.getDay() === 0 ? 6 : today.getDay() - 1;
  const entries: ReturnType<typeof getWeekPlaybookEntries> = [];
  for (let i = 0; i < 5; i++) {
    const dateStr = localDateStrOffset(mondayDaysAgo - i, today);
    try {
      const pbRaw = localStorage.getItem(`playbook:${dateStr}`);
      const sentRaw = localStorage.getItem(`sentiment:${dateStr}`);
      const pb = pbRaw ? JSON.parse(pbRaw) : null;
      // 提取命中率
      let hitRate = "—";
      if (pb?.aiReview) {
        const m = String(pb.aiReview).match(/命中度[】\s]*(\d+\/\d+)/);
        if (m) hitRate = m[1];
      }
      entries.push({
        date: dateStr,
        plan: pb?.plan || "",
        executed: pb?.executed || null,
        aiHitRate: hitRate,
        sentiment: sentRaw ? Number(sentRaw) : null,
      });
    } catch {
      entries.push({ date: dateStr, plan: "", executed: null, aiHitRate: "—", sentiment: null });
    }
  }
  return entries;
}

// 判断是否该触发
function shouldTrigger(): boolean {
  const d = new Date();
  const day = d.getDay();
  const hhmm = d.getHours() * 100 + d.getMinutes();
  // 周五15:30后 或 周末
  return (day === 5 && hhmm >= 1530) || day === 0 || day === 6;
}

export default function WeeklyCoach() {
  const [result, setResult] = useState<{ text: string; degraded: boolean } | null>(() => loadWeeklyCoach());
  const [loading, setLoading] = useState(false);
  const autoRef = useRef(false);

  const generate = useCallback(async () => {
    setLoading(true);
    try {
      const entries = getWeekPlaybookEntries();
      const r: AIResult = await callAI("weeklyCoach", { weekEntries: entries, hitRateContext: getHitRateForPrompt() });
      const data = { text: r.text, degraded: r.degraded };
      setResult(data);
      saveWeeklyCoach(r.text, r.degraded);
    } catch { /* 中枢已降级 */ }
    finally { setLoading(false); }
  }, []);

  // 自动触发
  useEffect(() => {
    if (autoRef.current || result || !shouldTrigger()) return;
    autoRef.current = true;
    generate();
  }, [result, generate]);

  if (!result && !loading) return null;

  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-violet-300">📊 周报教练</span>
        <div className="flex items-center gap-2">
          {result?.degraded && <span className="rounded px-1 py-0.5 text-[9px] font-bold bg-amber-500/20 text-amber-300">规则版</span>}
          <button onClick={generate} disabled={loading}
            className="text-[11px] text-violet-400 hover:text-violet-300 disabled:opacity-40">
            {loading ? "生成中…" : "重新生成"}
          </button>
        </div>
      </div>
      {loading && !result ? (
        <div className="text-[11px] text-slate-400 animate-pulse">生成周报中…</div>
      ) : result ? (
        <div className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap">{result.text}</div>
      ) : null}
    </div>
  );
}
