// 东方财富公开数据接口封装层。
// 所有函数均直接请求东方财富公开 JSON 接口，不使用任何模拟/伪造数据；
// 任意请求失败或字段缺失时会抛出错误或返回 available:false，由上层标注「数据不完整」。

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

export async function emGet<T = any>(url: string, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json,*/*" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const text = await res.text();
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** 判断 A 股代码所属市场，返回东方财富 secid 市场前缀（1=沪 0=深） */
export function marketPrefix(code: string): "0" | "1" {
  if (/^(60|68|90|110|113|118|132|204)/.test(code)) return "1";
  if (/^5/.test(code)) return "1";
  return "0";
}

export function toSecid(code: string): string {
  return `${marketPrefix(code)}.${code}`;
}

export function toSecuCode(code: string): string {
  return `${code}.${marketPrefix(code) === "1" ? "SH" : "SZ"}`;
}

// 常用东方财富字段编号说明（供页面底部“数据来源与计算逻辑”展示）：
// f2 最新价 f3 涨跌幅% f4 涨跌额 f12 代码 f14 名称
// f62 今日主力净额 f66/f69 超大单净额/净占比 f72/f75 大单净额/净占比
// f78/f81 中单净额/净占比 f84/f87 小单净额/净占比 f184 今日主力净占比%
// f164/f165 5日主力净额/净占比 f174/f175 10日主力净额/净占比
// f8 换手率 f9 市盈率(动) f10 量比
export const FIELDS = {
  quote: "f2,f3,f4,f12,f14,f8,f9,f10,f15,f16,f17,f18,f20,f21",
  fundToday: "f62,f66,f69,f72,f75,f78,f81,f84,f87,f184",
  fundPeriod: "f164,f165,f174,f175",
};
