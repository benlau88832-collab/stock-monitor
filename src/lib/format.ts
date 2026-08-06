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

// ============== 本地日期工具（统一时区，替代 toISOString().slice(0,10)） ==============
// 为什么不用 toISOString().slice(0,10)：
// toISOString 返回 UTC 时间。中国时区(CST, UTC+8)在本地凌晨 0:00-8:00 之间，
// UTC 仍在「昨天」→ 用 toISOString 取日期会少一天，导致凌晨时段：
//   1. AI 缓存命中「昨天」的旧结果，相同 payload 永远不会刷新
//   2. 信号账本/sentimentStore 写入昨日的 key
//   3. dataStore.getAllSince 取错日期，漏掉今日 0-8 点的数据
// 修复策略：统一使用本地年月日，输出格式为 "YYYY-MM-DD"。
export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 本地 YYYYMMDD（紧凑格式，涨停池 key/缓存 key 用） */
export function localDateStrCompact(d: Date = new Date()): string {
  return localDateStr(d).replace(/-/g, "");
}

/** 距今 d 天的本地日期 YYYY-MM-DD（d>0 向前，d<0 向后） */
export function localDateStrOffset(days: number, base: Date = new Date()): string {
  const x = new Date(base);
  x.setDate(x.getDate() - days);
  return localDateStr(x);
}

// ============== 北京时间日期工具（v9.60 V9-D3：统一时区判周末/回看日期） ==============
// 为什么：new Date().getDay() 用本机时区。服务器/客户端若非东八区（如部署在 UTC），
// "今天"和周末判定偏移 → 回测样本日期、因子 IC 日期、推荐落盘日期全错位。
// getBJDate() 返回一个"getFullYear/getMonth/getDate/getDay/getHours 等读取的正是北京时间字段"
// 的 Date 对象 —— 任何本机时区下，这些方法的结果都等于北京时间。
// 实现要点：Date.getTime() 返回的是 UTC epoch 毫秒（与时区无关），所以北京时间 = getTime() + 8h，
// 再用 getUTC* 读北京字段、本地构造。注意【不能】加 getTimezoneOffset() —— 那会把 UTC 字段
// 读成 UTC 小时（CST 机器上原 getBJTime 的 bug：返回 14 而非 22）。
export function getBJDate(d: Date = new Date()): Date {
  const bjMs = d.getTime() + 8 * 3600000; // 北京时间 epoch = UTC epoch + 8h
  const bj = new Date(bjMs);
  return new Date(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate(), bj.getUTCHours(), bj.getUTCMinutes(), bj.getUTCSeconds(), bj.getUTCMilliseconds());
}

/** 北京时间的星期几（0=周日，6=周六）—— 判周末/算周一用，替代 d.getDay() 的本机时区版 */
export function getBJWeekday(d: Date = new Date()): number {
  return getBJDate(d).getDay();
}

/** 北京时间的 YYYY-MM-DD（与 localDateStr 同格式，但按北京时间而非本机时区） */
export function getBJDateStr(d: Date = new Date()): string {
  const bj = getBJDate(d);
  return `${bj.getFullYear()}-${String(bj.getMonth() + 1).padStart(2, "0")}-${String(bj.getDate()).padStart(2, "0")}`;
}
