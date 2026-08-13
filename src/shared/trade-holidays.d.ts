// v9.137.0（审查 P3-07）：trade-holidays.js 的类型声明（与 concept-groups.d.ts 同机制）
export const TRADE_HOLIDAY_RANGES: Record<string, Array<[string, string]>>;
export function buildHolidaySet(ranges?: Record<string, Array<[string, string]>>): Set<string>;
export const HOLIDAY_NAMES: Array<{ start: string; end: string; name: string }>;
