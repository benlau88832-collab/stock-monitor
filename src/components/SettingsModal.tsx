import { useEffect, useState } from "react";
import { PROVIDERS, loadSettings, saveSettings, applyProvider, testAISettings, fetchServerAIConfig, testServerAI, type AISettings, type ProviderId, type ServerAIConfig } from "../lib/aiSettings";
import { getAIStats } from "../lib/ai";
import { exportMemoBackup } from "../lib/newsMemoStore";
import { forceRebuildBoardMap } from "../lib/boardMap";
import { loadPushSettings, savePushSettings, type PushSettings, type PushChannel } from "../lib/pushSettings";
import { pushMessage } from "../lib/pushGateway";

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<AISettings>(loadSettings());
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState<{ ok: boolean; msg: string } | null>(null);
  const [serverCfg, setServerCfg] = useState<ServerAIConfig | null>(null);
  const [serverChecked, setServerChecked] = useState(false);
  // P0-4：推送通道配置
  const [push, setPush] = useState<PushSettings>(loadPushSettings());
  const [pushTesting, setPushTesting] = useState(false);
  const [pushTestRes, setPushTestRes] = useState<{ ok: boolean; msg: string } | null>(null);
  const stats = getAIStats();
  const upd = (p: Partial<AISettings>) => setS({ ...s, ...p });
  const updPush = (p: Partial<PushSettings>) => setPush({ ...push, ...p });

  // v9.26.2 方案A：本地部署时检测服务端 AI 中转配置（Key 在 server/.env，浏览器不持有）
  useEffect(() => {
    fetchServerAIConfig().then(c => { setServerCfg(c); setServerChecked(true); });
  }, []);
  const serverMode = serverChecked && serverCfg?.enabled === true;

  const onTest = async () => {
    setTesting(true); setTestRes(null);
    // 服务端中转模式下：测试服务端 /api/ai/call（Key 在服务端）
    const r = serverMode ? await testServerAI() : await testAISettings(s);
    setTestRes(r); setTesting(false);
    if (r.ok && !serverMode) { saveSettings(s); }
  };
  const onSave = () => { saveSettings(s); onClose(); };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-5 text-slate-200" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">⚙️ 模型与数据设置</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg">✕</button>
        </div>

        {serverMode && (
          <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            ✅ 服务端 AI 中转已启用 · 模型 {serverCfg?.model} · API Key 存储在 <code className="text-emerald-200">server/.env</code>，浏览器不再需要填写
          </div>
        )}
        {serverChecked && !serverMode && (
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            {serverCfg ? "⚠️ 服务端 AI 中转未启用（server/.env 未配置 Key）——请在下方填入浏览器 Key 直连" : "💡 当前为线上页面（无本地服务端）——请在下方填入浏览器 Key 直连"}
          </div>
        )}

        <label className="text-xs text-slate-400">模型厂商</label>
        <select className="mb-3 w-full rounded bg-slate-800 px-3 py-2 text-sm"
          value={s.provider}
          disabled={serverMode}
          onChange={e => setS({ ...s, ...applyProvider(e.target.value as ProviderId), apiKey: s.apiKey })}>
          {Object.entries(PROVIDERS).map(([id, p]) => (
            <option key={id} value={id}>{p.label}{p.corsOk ? "" : "（需代理）"}</option>
          ))}
        </select>
        {!PROVIDERS[s.provider].corsOk && !serverMode && (
          <p className="mb-3 rounded bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            ⚠️ 该厂商浏览器直连通常被 CORS 拦截，线上静态页可能无法使用，建议选 Agnes 或等本地部署后端代理。
          </p>
        )}

        <label className="text-xs text-slate-400">Base URL</label>
        <input className="mb-3 w-full rounded bg-slate-800 px-3 py-2 text-sm disabled:opacity-50" value={s.baseUrl} disabled={serverMode} onChange={e => upd({ baseUrl: e.target.value })} />

        <label className="text-xs text-slate-400">模型名称</label>
        <input className="mb-3 w-full rounded bg-slate-800 px-3 py-2 text-sm disabled:opacity-50" value={s.model} disabled={serverMode} onChange={e => upd({ model: e.target.value })} />

        <label className="text-xs text-slate-400">API Key {serverMode && <span className="text-emerald-400">（🔒 服务端已配置）</span>}</label>
        <div className="mb-3 flex gap-2">
          <input className="flex-1 rounded bg-slate-800 px-3 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed" type={showKey ? "text" : "password"}
            value={s.apiKey} disabled={serverMode}
            onChange={e => upd({ apiKey: e.target.value })} placeholder={serverMode ? "服务端中转模式，无需填写" : "sk-..."} />
          <button onClick={() => setShowKey(v => !v)} className="rounded bg-slate-700 px-3 text-xs">{showKey ? "隐藏" : "显示"}</button>
        </div>

        <div className="mb-3 flex items-center gap-4 flex-wrap">
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={s.thinking} disabled={serverMode || !PROVIDERS[s.provider].supportsThinking} onChange={e => upd({ thinking: e.target.checked })} /> 思考模式
          </label>
          <label className="text-xs">maxTokens 上限
            <input type="number" className="ml-1 w-24 rounded bg-slate-800 px-2 py-1 text-xs" value={s.maxTokens} onChange={e => upd({ maxTokens: Number(e.target.value) || 0 })} />
            <span className="ml-1 text-slate-500">(0=用任务默认)</span>
          </label>
        </div>

        <div className="mb-4 flex gap-2 items-center">
          <button onClick={onTest} disabled={testing} className="rounded bg-sky-600 px-3 py-2 text-sm hover:bg-sky-500 disabled:opacity-50">{testing ? "测试中…" : serverMode ? "测试服务端" : "测试连接"}</button>
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

        {/* P0-4：外部推送通道配置 */}
        <div className="mt-4 border-t border-white/10 pt-3">
          <h3 className="mb-2 text-sm font-bold text-slate-200">📲 外部推送通道（手机接收 critical 事件）</h3>
          <p className="mb-3 text-xs text-slate-500">本地部署时通过服务端中转推送至 Server酱/企业微信/Bark（仅本地生效；线上无 server 静默不推）。Key 仅存 localStorage，不上 git。</p>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={push.enabled} onChange={e => updPush({ enabled: e.target.checked })} />
            启用推送
          </label>
          <div className="mt-2 grid grid-cols-1 gap-2">
            <label className="text-xs text-slate-400">通道选择</label>
            <select className="w-full rounded bg-slate-800 px-3 py-2 text-sm"
              value={push.channel ?? ""}
              onChange={e => updPush({ channel: (e.target.value || null) as PushChannel | null })}>
              <option value="">未配置</option>
              <option value="serverchan">Server酱（SCTSendKey）</option>
              <option value="wechatbot">企业微信群机器人 Webhook</option>
              <option value="bark">Bark（iOS 推送）</option>
            </select>
            {push.channel === "serverchan" && (
              <input type="password" className="w-full rounded bg-slate-800 px-3 py-2 text-sm"
                value={push.serverchanSctKey ?? ""} placeholder="SCT..."
                onChange={e => updPush({ serverchanSctKey: e.target.value })} />
            )}
            {push.channel === "wechatbot" && (
              <input type="password" className="w-full rounded bg-slate-800 px-3 py-2 text-sm"
                value={push.wechatbotKey ?? ""} placeholder="robot key（webhook 路径后段）"
                onChange={e => updPush({ wechatbotKey: e.target.value })} />
            )}
            {push.channel === "bark" && (
              <input type="password" className="w-full rounded bg-slate-800 px-3 py-2 text-sm"
                value={push.barkKey ?? ""} placeholder="Bark 设备 key"
                onChange={e => updPush({ barkKey: e.target.value })} />
            )}
            <label className="text-xs text-slate-400">最低推送等级
              <select className="ml-2 rounded bg-slate-800 px-2 py-1 text-xs"
                value={push.minSeverity}
                onChange={e => updPush({ minSeverity: e.target.value as "info" | "warning" | "critical" })}>
                <option value="info">info（含普通）</option>
                <option value="warning">warning（含警告）</option>
                <option value="critical">critical（仅严重）</option>
              </select>
            </label>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button onClick={async () => {
              setPushTesting(true); setPushTestRes(null);
              savePushSettings(push);
              const ok = await pushMessage({ title: "stock-monitor 测试推送", body: `已配置通道：${push.channel ?? "无"}`, severity: "critical" });
              setPushTestRes({ ok, msg: ok ? "✅ 已推送，请检查手机" : "❌ 未收到，请检查 server 是否运行 + key 是否有效 + 通道选择" });
              setPushTesting(false);
            }} disabled={pushTesting || !push.enabled || !push.channel} className="rounded bg-sky-600 px-3 py-2 text-sm hover:bg-sky-500 disabled:opacity-50">
              {pushTesting ? "测试中…" : "测试推送"}
            </button>
            <button onClick={() => { savePushSettings(push); setPushTestRes({ ok: true, msg: "✅ 已保存" }); }} className="rounded bg-emerald-600 px-3 py-2 text-sm hover:bg-emerald-500">保存</button>
            {pushTestRes && <span className={`text-xs ${pushTestRes.ok ? "text-emerald-400" : "text-rose-400"}`}>{pushTestRes.msg}</span>}
          </div>
          <p className="mt-2 text-[10px] text-slate-500">说明：key 仅存 localStorage（不进 git），不会上传 GitHub Pages 线上版。</p>
        </div>
      </div>
    </div>
  );
}
