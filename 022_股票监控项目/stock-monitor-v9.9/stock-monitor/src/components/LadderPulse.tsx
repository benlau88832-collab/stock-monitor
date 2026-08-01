import { useState, useEffect, useRef, useCallback } from "react";
import { callAI, type AIResult } from "../lib/ai";
import { getCurrentSession } from "../lib/tradingSession";
import { buildThemeLadder, detectBrokenBoards, type ZTPoolItem } from "../lib/themeLadder";
import type { OverviewData } from "../App";

// 梯队把脉：盘中每15分钟+收盘各一次
// 命中限速→顺延到下一触发窗口

interface Props {
  overview: OverviewData | null;
}

function getBJHHMM(): string {
  const n = new Date();
  const bj = new Date(n.getTime() + (n.getTimezoneOffset() + 480) * 60000);
  return `${String(bj.getHours()).padStart(2, "0")}:${String(bj.getMinutes()).padStart(2, "0")}`;
}

export default function LadderPulse({ overview }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [genTime, setGenTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const lastTrigger = useRef<string>("");

  const generate = useCallback(async () => {
    const pool = overview?.limitPool;
    const rawPool = pool?.rawZTPool as ZTPoolItem[] | undefined;
    if (!rawPool || rawPool.length === 0) return;

    const groups = buildThemeLadder(rawPool);
    const top5 = groups.slice(0, 5).map(g => ({
      theme: g.theme, height: g.height, count: g.count,
      pioneer: g.pioneer?.name || "—",
    }));

    // 断板名单
    let brokenStr = "";
    try {
      const d = new Date();
      const day = d.getDay();
      if (day === 0) d.setDate(d.getDate() - 2);
      else if (day === 6) d.setDate(d.getDate() - 1);
      d.setDate(d.getDate() - 1);
      const nd = d.getDay();
      if (nd === 0) d.setDate(d.getDate() - 2);
      else if (nd === 6) d.setDate(d.getDate() - 1);
      const yd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
      const yRaw = localStorage.getItem(`ztpool:${yd}`);
      if (yRaw) {
        const yPool = JSON.parse(yRaw) as ZTPoolItem[];
        const broken = detectBrokenBoards(yPool, rawPool);
        brokenStr = broken.map(b => `${b.name}(昨${b.yesterdayLbc}板)`).join("、");
      }
    } catch { /* 无快照 */ }

    setLoading(true);
    try {
      const result: AIResult = await callAI("ladderScan", {
        groups: top5,
        sentiment: overview?.sentiment ?? 50,
        blastedRate: pool?.blastedRate ?? 0,
        brokenBoards: brokenStr,
      });
      setText(result.text);
      setDegraded(result.degraded);
      setGenTime(getBJHHMM());
    } catch { /* callAI 内部已降级 */ }
    finally { setLoading(false); }
  }, [overview]);

  // 定时触发：盘中每15分钟
  useEffect(() => {
    const check = () => {
      const session = getCurrentSession();
      const hhmm = getBJHHMM();
      // 盘中(trading)每15分钟一次
      if (session.phase === "trading") {
        const min = parseInt(hhmm.slice(3, 5), 10);
        const slot = `${hhmm.slice(0, 2)}:${min < 15 ? "00" : min < 30 ? "15" : min < 45 ? "30" : "45"}`;
        if (slot !== lastTrigger.current) {
          lastTrigger.current = slot;
          generate();
        }
      }
      // 收盘一次 (15:00-15:05)
      if (session.phase === "post" && lastTrigger.current !== "close") {
        lastTrigger.current = "close";
        generate();
      }
    };
    check();
    const t = setInterval(check, 60000);
    return () => clearInterval(t);
  }, [generate]);

  if (!text && !loading) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-amber-200">🧠 AI把脉</span>
        <div className="flex items-center gap-2">
          {degraded && <span className="rounded px-1 py-0.5 text-[9px] font-bold bg-amber-500/20 text-amber-300">规则版</span>}
          {genTime && <span className="text-[11px] text-slate-600">{genTime}</span>}
          <button onClick={generate} disabled={loading}
            className="text-[11px] text-violet-400 hover:text-violet-300 disabled:opacity-40">
            {loading ? "分析中…" : "刷新"}
          </button>
        </div>
      </div>
      {loading && !text ? (
        <div className="text-[11px] text-slate-400 animate-pulse">梯队分析中…</div>
      ) : text ? (
        <div className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap">{text}</div>
      ) : null}
    </div>
  );
}
