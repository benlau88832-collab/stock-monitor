"use client";

import { useEffect, useState } from "react";

export default function Settings() {
  const [items, setItems] = useState<any[]>([]);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/watchlist");
    const json = await res.json();
    setItems(json.items ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function add() {
    const c = code.trim();
    if (!/^\d{6}$/.test(c)) {
      setMsg("请输入正确的 6 位股票代码");
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg(json.message || "添加失败");
      } else {
        setItems(json.items ?? []);
        setCode("");
      }
    } finally {
      setLoading(false);
    }
  }

  async function remove(c: string) {
    const res = await fetch(`/api/watchlist?code=${c}`, { method: "DELETE" });
    const json = await res.json();
    setItems(json.items ?? []);
  }

  return (
    <section className="max-w-2xl space-y-4">
      <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
        自选股监控列表：这里添加的代码将同步出现在「风险扫描」模块中，自动扫描质押、减持、现金流、偿债与监管风险。
      </div>
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="输入6位股票代码后回车添加"
          className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-amber-400"
        />
        <button
          onClick={add}
          disabled={loading}
          className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-black hover:bg-amber-300 disabled:opacity-50"
        >
          添加
        </button>
      </div>
      {msg && <div className="text-sm text-rose-400">{msg}</div>}
      <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
        {items.length === 0 && <div className="p-4 text-sm text-slate-500">暂无自选股，添加后将纳入风险雷达监控</div>}
        {items.map((it) => (
          <div key={it.code} className="flex items-center justify-between p-3 text-sm">
            <div>
              <span className="font-semibold text-slate-100">{it.name}</span>{" "}
              <span className="text-slate-500">{it.code}</span>
            </div>
            <button onClick={() => remove(it.code)} className="text-xs text-rose-400 hover:text-rose-300">
              移除
            </button>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-xs text-slate-500">
        <div className="mb-1 font-semibold text-slate-300">产品说明</div>
        本终端为 A 股实盘交易辅助监控工具，所有展示数据均来自东方财富公开接口的真实抓取，接口异常或字段缺失时会明确标注「数据不完整」，不会以任何形式填充模拟数据。所有结论仅供参考，不构成投资建议。
      </div>
    </section>
  );
}
