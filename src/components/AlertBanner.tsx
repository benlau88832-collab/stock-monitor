import { useState } from "react";
import { AlertTriangle, Info, VolumeX } from "lucide-react";
import { localDateStr } from "../lib/format";

// 三级警报体系
// 提示(info/灰) / 警告(warning/amber) / 严重(critical/red+横幅)
// 严重级：重度背离、情绪分穿越阈值、自选股否决

export interface AlertItem {
  id: string;
  level: "info" | "warning" | "critical";
  message: string;
}

const MUTED_KEY = "alert_muted_today";

function getMutedToday(): Set<string> {
  try {
    const raw = localStorage.getItem(MUTED_KEY);
    if (!raw) return new Set();
    const { date, ids } = JSON.parse(raw);
    // 修复：用本地日期判断是否过期（toISOString 在 CST 凌晨会取到"昨天"导致今日不静音）
    if (date !== localDateStr()) return new Set();
    return new Set(ids);
  } catch { return new Set(); }
}

function muteToday(id: string) {
  const muted = getMutedToday();
  muted.add(id);
  localStorage.setItem(MUTED_KEY, JSON.stringify({
    date: localDateStr(),
    ids: [...muted],
  }));
}

export default function AlertBanner({ alerts }: { alerts: AlertItem[] }) {
  const [mutedIds, setMutedIds] = useState(() => getMutedToday());
  // v9.149.0（B2）：多条严重预警合并一行可点开（不再逐条占多行）
  const [criticalOpen, setCriticalOpen] = useState(false);

  const criticals = alerts.filter(a => a.level === "critical" && !mutedIds.has(a.id));
  const warnings = alerts.filter(a => a.level === "warning" && !mutedIds.has(a.id));
  const infos = alerts.filter(a => a.level === "info" && !mutedIds.has(a.id));

  const handleMute = (id: string) => {
    muteToday(id);
    setMutedIds(prev => new Set([...prev, id]));
  };

  if (criticals.length === 0 && warnings.length === 0 && infos.length === 0) return null;

  return (
    <div className="space-y-0">
      {/* 严重级横幅（v9.149.0 B2：多条合并一行，点击展开） */}
      {criticals.length > 0 && (
        <div className="border-b border-rose-500/40 bg-rose-600/20 px-4 py-1.5 flex items-center justify-between">
          {criticals.length === 1 ? (
            <div className="flex items-center gap-2 text-sm text-rose-200">
              <AlertTriangle size={14} className="shrink-0" />
              <span className="font-bold">{criticals[0].message}</span>
            </div>
          ) : (
            <button onClick={() => setCriticalOpen(v => !v)} className="flex items-center gap-2 text-sm text-rose-200 hover:text-rose-100">
              <AlertTriangle size={14} className="shrink-0" />
              <span className="font-bold">⚠ {criticals.length} 条预警：{criticals[0].message.slice(0, 40)}…</span>
              <span className="text-[10px] text-rose-400/70">{criticalOpen ? "▲ 收起" : "▼ 展开"}</span>
            </button>
          )}
          {criticals.length === 1 && (
            <button onClick={() => handleMute(criticals[0].id)} className="flex items-center gap-1 text-[11px] text-rose-400/60 hover:text-rose-300 shrink-0"
              title="今日不再提示">
              <VolumeX size={12} /> 静音
            </button>
          )}
        </div>
      )}
      {criticals.length > 1 && criticalOpen && criticals.map(a => (
        <div key={a.id} className="border-b border-rose-500/20 bg-rose-600/10 px-6 py-1 flex items-center justify-between text-xs text-rose-300">
          <span>{a.message}</span>
          <button onClick={() => handleMute(a.id)} className="ml-1 text-rose-500/50 hover:text-rose-300">✕ 静音</button>
        </div>
      ))}
      {/* 警告级（小字） */}
      {warnings.length > 0 && (
        <div className="border-b border-amber-500/20 bg-amber-600/10 px-4 py-1 flex items-center gap-2 text-xs text-amber-300/80 overflow-x-auto">
          <Info size={12} className="shrink-0" />
          {warnings.map((a, i) => (
            <span key={a.id} className="whitespace-nowrap">
              {a.message}
              <button onClick={() => handleMute(a.id)} className="ml-1 text-amber-500/40 hover:text-amber-300">✕</button>
              {i < warnings.length - 1 && <span className="mx-1 text-amber-500/20">|</span>}
            </span>
          ))}
        </div>
      )}
      {/* 提示级（灰色小字） */}
      {infos.length > 0 && (
        <div className="border-b border-slate-500/20 bg-slate-600/10 px-4 py-1 flex items-center gap-2 text-xs text-slate-400 overflow-x-auto">
          <Info size={12} className="shrink-0 text-slate-500" />
          {infos.map((a, i) => (
            <span key={a.id} className="whitespace-nowrap">
              {a.message}
              <button onClick={() => handleMute(a.id)} className="ml-1 text-slate-600 hover:text-slate-400">✕</button>
              {i < infos.length - 1 && <span className="mx-1 text-slate-600">|</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
