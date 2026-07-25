import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "A股实时监控面板 · 资金结构与风险雷达终端",
  description: "面向 A 股低披露、高博弈市场的实盘交易辅助监控终端：资金结构优先、风险信号优先、阶段判断优先。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-[#05070d] text-slate-100 antialiased">{children}</body>
    </html>
  );
}
