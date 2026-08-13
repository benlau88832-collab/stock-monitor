// ============================================================
// v9.137.0（审查 P2-06 修复）：🧠 我的画像卡 —— 让"AI 认识你"可见
// 原状：cron 周六生成 user_style:日期（风格/偏差/禁忌题材），画像注入 AI prompt
//   （DecisionVerdictCard/aiAgent），但全站无展示 UI → 用户看不到 AI 学到了什么、
//   也无法纠正错误画像，"记忆修正"闭环是黑盒。
// 本组件：展示本地画像（拍板统计/风格/T+5 盈亏/连亏/否决反馈/低胜率题材）+
//   服务端 user_style（周度 LLM 风格推断，有则展示）。
// ============================================================
import { useState, useEffect } from "react";
import { loadUserProfile, profileToPrompt } from "../lib/userProfile";
import { localDateStr } from "../lib/format";
import { isLocalServer } from "../lib/cloudStore";

interface ServerStyle {
  style?: string;
  biases?: string[];
  avoidThemes?: string[];
  suggestion?: string;
  date?: string;
}

export default function UserProfileCard() {
  const [serverStyle, setServerStyle] = useState<ServerStyle | null>(null);
  const [profileVersion, setProfileVersion] = useState(0); // 拍板后刷新

  useEffect(() => {
    let alive = true;
    if (!isLocalServer()) return;
    (async () => {
      try {
        const r = await fetch(`/api/db/kv?key=${encodeURIComponent(`user_style:${localDateStr()}`)}`, { signal: AbortSignal.timeout(5000) });
        if (r.ok) {
          const j = await r.json();
          const v = j?.value;
          const obj = v && typeof v === "object" && "__raw" in v ? JSON.parse(v.__raw) : v;
          if (obj && typeof obj === "object" && (obj.style || obj.biases)) {
            if (alive) setServerStyle(obj);
          }
        }
      } catch { /* 服务端画像未生成（周六 cron 前）→ 静默 */ }
    })();
    return () => { alive = false; };
  }, [profileVersion]);

  // 本地画像（拍板后 savePost→updateUserProfile 自动刷新；组件挂载时读一次）
  const local = loadUserProfile();
  const hasLocal = local != null && local.totalPosts > 0;

  // 无任何数据 → 不占版面
  if (!hasLocal && !serverStyle) return null;

  return (
    <div className="rounded-xl border border-sky-500/20 bg-sky-950/10 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-sky-300">🧠 我的画像（AI 决策参考 · 每周自动更新）</span>
        <button
          onClick={() => setProfileVersion(v => v + 1)}
          className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/10"
        >刷新</button>
      </div>
      {hasLocal && (
        <div className="mt-1.5 text-[11px] leading-relaxed text-slate-300">
          👤 {profileToPrompt(local)}
        </div>
      )}
      {serverStyle && (
        <div className="mt-1.5 space-y-1 text-[11px] text-slate-300">
          <div>🤖 周度风格推断（{serverStyle.date ?? "—"}）：<b className="text-sky-300">{serverStyle.style ?? "未知"}</b>
            {Array.isArray(serverStyle.biases) && serverStyle.biases.length > 0 && (
              <span className="ml-1 text-amber-300/90">偏差：{serverStyle.biases.join("、")}</span>
            )}
          </div>
          {Array.isArray(serverStyle.avoidThemes) && serverStyle.avoidThemes.length > 0 && (
            <div className="text-rose-300/80">应回避题材：{serverStyle.avoidThemes.join("、")}</div>
          )}
          {serverStyle.suggestion && <div className="text-slate-400">建议：{serverStyle.suggestion}</div>}
        </div>
      )}
      <div className="mt-1.5 text-[10px] text-slate-500">
        画像随拍板/成交自动更新并注入 AI 裁决参考；否决时的快速反馈也会计入（见"用户反馈"）。AI 结论仅供参考。
      </div>
    </div>
  );
}
