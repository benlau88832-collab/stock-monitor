import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "A股实时监控终端",
  description: "A股实盘交易辅助监控终端 · 资金结构 > 涨跌幅 · 风险信号 > 机会信号",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-[#05070d] text-slate-100 antialiased">{children}</body>
    </html>
  );
}
