import { Component, type ReactNode } from "react";

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-200 p-6">
          <div className="max-w-md text-center space-y-3">
            <div className="text-4xl">⚠️</div>
            <h1 className="text-lg font-bold">页面模块异常</h1>
            <p className="text-sm text-slate-400">某个数据模块崩溃导致渲染中断。你的本地数据（自选股/情报库）已保留。</p>
            <pre className="text-[11px] text-rose-300 bg-black/40 rounded p-2 text-left overflow-auto max-h-32">
              {this.state.error?.message ?? "未知错误"}
            </pre>
            <button
              onClick={() => location.reload()}
              className="rounded bg-amber-500 px-4 py-2 text-sm font-bold text-slate-900"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
