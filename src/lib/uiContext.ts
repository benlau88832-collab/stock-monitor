// ============================================================
// v9.92.0（AI 贯穿全局·上下文感知）：全局 UI 上下文 store
// 全站任何模块"正在看什么"（当前 Tab / 当前个股）→ 统一登记在此，
// AIConsole / AskAI 注入 siteContext 时自动感知 —— AI 不再"不知道你在看哪只股"。
// 轻量模块级 store（无 React 依赖，组件用 useSyncExternalStore 订阅）
// ============================================================

export interface UiContext {
  /** 当前激活 Tab（dashboard/fundline/radar/dragon/news） */
  activeTab: string;
  /** 当前查看个股（自选页选中 / 主线龙头点击 / 龙虎榜行点击） */
  currentStock: { code: string; name: string } | null;
}

let ctx: UiContext = { activeTab: "dashboard", currentStock: null };
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function setActiveTab(tab: string): void {
  if (ctx.activeTab === tab) return;
  ctx = { ...ctx, activeTab: tab };
  emit();
}

export function setCurrentStock(code: string | null, name = ""): void {
  const next = code ? { code, name: name || code } : null;
  if (ctx.currentStock?.code === next?.code) return;
  ctx = { ...ctx, currentStock: next };
  emit();
}

export function getUiContext(): UiContext {
  return ctx;
}

/** 组件订阅（useSyncExternalStore 兼容：subscribe 返回取消函数） */
export function subscribeUiContext(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
