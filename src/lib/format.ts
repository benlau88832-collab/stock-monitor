export function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "--";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : v > 0 ? "+" : "";
  // 边界修复：当数值经四舍五入后达到1亿/1万整数时，改用上一级单位展示，
  // 避免出现"10000.0万"这类应显示为"1.00亿"的口径不一致问题
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) {
    const wan = abs / 1e4;
    if (Math.round(wan * 10) / 10 >= 10000) return `${sign}${(abs / 1e8).toFixed(2)}亿`;
    return `${sign}${wan.toFixed(1)}万`;
  }
  if (Math.round(abs) >= 10000) return `${sign}${(abs / 1e4).toFixed(1)}万`;
  return `${sign}${abs.toFixed(0)}`;
}

export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "--";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function pctColor(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return "text-slate-300";
  return v > 0 ? "text-rose-400" : "text-emerald-400";
}

export function pctBg(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return "bg-slate-700/40";
  return v > 0 ? "bg-rose-500/15" : "bg-emerald-500/15";
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "--:--:--";
  try {
    return new Date(iso).toLocaleTimeString("zh-CN", { hour12: false });
  } catch {
    return "--:--:--";
  }
}
