import { useState, useEffect, useCallback } from "react";
import { fmtMoney, pctColor } from "../lib/format";

// 机构资金观察卡片（宽基ETF资金流）
export default function InstitutionFund() {
  const [total, setTotal] = useState<number | null>(null);
  const [items, setItems] = useState<Array<{ name: string; mainNet: number }>>([]);

  const load = useCallback(async () => {
    try {
      // 宽基ETF主力资金：510300/510500/588000/159915/512100
      const url = "https://push2.eastmoney.com/api/qt/ulist.np/get?ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&fields=f12,f14,f62&secids=1.510300,1.510500,1.588000,0.159915,1.512100";
      const cbName = `etf_${Date.now()}`;
      const data = await new Promise<any>((resolve, reject) => {
        const script = document.createElement("script");
        const timer = setTimeout(() => { cleanup(); reject(new Error("timeout")); }, 8000);
        function cleanup() { clearTimeout(timer); delete (window as any)[cbName]; script.parentNode?.removeChild(script); }
        (window as any)[cbName] = (d: any) => { cleanup(); resolve(d); };
        script.src = `${url}&cb=${cbName}&_=${Date.now()}`;
        script.referrerPolicy = "no-referrer";
        script.onerror = () => { cleanup(); reject(new Error("error")); };
        document.head.appendChild(script);
      });
      const diff: any[] = Array.isArray(data?.data?.diff) ? data.data.diff : [];
      let t = 0;
      const names: Record<string, string> = { "510300": "沪深300ETF", "510500": "中证500ETF", "588000": "科创50ETF", "159915": "创业板ETF", "512100": "中证1000ETF" };
      const list = diff.map(d => {
        const mainNet = Number(d.f62) || 0;
        t += mainNet;
        return { name: names[d.f12] || d.f14, mainNet };
      });
      setTotal(t);
      setItems(list);
    } catch { /* 失败保持null */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2" style={{ minHeight: 120 }}>
      <div className="text-xs font-bold text-slate-300">宽基ETF主力资金</div>
      {total != null ? (
        <>
          <div className={`text-lg font-black ${pctColor(total)}`}>{fmtMoney(total)}</div>
          <div className="space-y-0.5">
            {items.map(e => (
              <div key={e.name} className="flex justify-between text-[11px]">
                <span className="text-slate-400">{e.name}</span>
                <span className={`font-semibold ${pctColor(e.mainNet)}`}>{fmtMoney(e.mainNet)}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="text-xs text-slate-600">加载中…</div>
      )}
    </div>
  );
}
