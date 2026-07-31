import { useState } from "react";
import { PROVIDERS, loadSettings, saveSettings, applyProvider, testAISettings, type AISettings, type ProviderId } from "../lib/aiSettings";
import { getAIStats } from "../lib/ai";
import { exportMemoBackup } from "../lib/newsMemoStore";
import { forceRebuildBoardMap } from "../lib/boardMap";

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<AISettings>(loadSettings());
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState<{ ok: boolean; msg: string } | null>(null);
  const stats = getAIStats();
  const upd = (p: Partial<AISettings>) => setS({ ...s, ...p });

  const onTest = async () => {
    setTesting(true); setTestRes(null);
    const r = await testAISettings(s);
    setTestRes(r); setTesting(false);
    if (r.ok) { saveSettings(s); }
  };
  const onSave = () => { saveSettings(s); onClose(); };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-5 text-slate-200" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">⚙️ 模型与数据设置</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg">✕</button>
        </div>

        <label className="text-xs text-slate-400">模型厂商</label>
        <select className="mb-3 w-full rounded bg-slate-800 px-3 py-2 text-sm"
          value={s.provider}
          onChange={e => setS({ ...s, ...applyProvider(e.target.value as ProviderId), apiKey: s.apiKey })}>
          {Object.entries(PROVIDERS).map(([id, p]) => (
            <option key={id} value={id}>{p.label}{p.corsOk ? "" : "（需代理）"}</option>
          ))}
        </select>
        {!PROVIDERS[s.provider].corsOk && (
          <p className="mb-3 rounded bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            ⚠️ 该厂商浏览器直连通常被 CORS 拦截，线上静态页可能无法使用，建议选 Agnes 或等本地部署后端代理。
          </p>
        )}

        <label className="text-xs text-slate-400">Base URL</label>
        <input className="mb-3 w-full rounded bg-slate-800 px-3 py-2 text-sm" value={s.baseUrl} onChange={e => upd({ baseUrl: e.target.value })} />

        <label className="text-xs text-slate-400">模型名称</label>
        <input className="mb-3 w-full rounded bg-slate-800 px-3 py-2 text-sm" value={s.model} onChange={e => upd({ model: e.target.value })} />

        <label className="text-xs text-slate-400">API Key</label>
        <div className="mb-3 flex gap-2">
          <input className="flex-1 rounded bg-slate-800 px-3 py-2 text-sm" type={showKey ? "text" : "password"}
            value={s.apiKey} onChange={e => upd({ apiKey: e.target.value })} placeholder="sk-..." />
          <button onClick={() => setShowKey(v => !v)} className="rounded bg-slate-700 px-3 text-xs">{showKey ? "隐藏" : "显示"}</button>
        </div>

        <div className="mb-3 flex items-center gap-4 flex-wrap">
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={s.thinking} disabled={!PROVIDERS[s.provider].supportsThinking} onChange={e => upd({ thinking: e.target.checked })} /> 思考模式
          </label>
          <label className="text-xs">maxTokens 上限
            <input type="number" className="ml-1 w-24 rounded bg-slate-800 px-2 py-1 text-xs" value={s.maxTokens} onChange={e => upd({ maxTokens: Number(e.target.value) || 0 })} />
            <span className="ml-1 text-slate-500">(0=用任务默认)</span>
          </label>
        </div>

        <div className="mb-4 flex gap-2 items-center">
          <button onClick={onTest} disabled={testing} className="rounded bg-sky-600 px-3 py-2 text-sm hover:bg-sky-500 disabled:opacity-50">{testing ? "测试中…" : "测试连接"}</button>
          <button onClick={onSave} className="rounded bg-emerald-600 px-4 py-2 text-sm hover:bg-emerald-500">保存</button>
          {testRes && <span className={`text-xs ${testRes.ok ? "text-emerald-400" : "text-rose-400"}`}>{testRes.msg}</span>}
        </div>

        <div className="border-t border-white/10 pt-3 text-xs text-slate-400">
          <div className="mb-2">今日 AI 调用：{stats.calls} 次 · 失败 {stats.failures} · 平均 {stats.avgLatency}ms</div>
          <div className="flex flex-wrap gap-2">
            <button className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600" onClick={() => { if (confirm("清空 AI 缓存？")) { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k?.startsWith("ai:cache:")) localStorage.removeItem(k); } } }}>清空AI缓存</button>
            <button className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600" onClick={() => { if (confirm("清空累积素材库？")) { localStorage.removeItem("ds_news"); localStorage.removeItem("ds_ann"); } }}>清空素材库</button>
            <button className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600" onClick={exportMemoBackup}>导出情报记忆</button>
            <button className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600" onClick={async () => {
              try {
                const r = await forceRebuildBoardMap();
                alert(`板块表已重建：词表${r.vocabSize}个板块、映射${r.mapSize}只股票`);
              } catch (e) { alert("重建失败：" + (e as Error).message); }
            }}>🔄 重建板块表</button>
          </div>
        </div>
      </div>
    </div>
  );
}
