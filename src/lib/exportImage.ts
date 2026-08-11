// ============================================================
// v9.99.1（批次 5-3）：报告导出通用化
// 情绪叙事报告 / 复盘报告共用 —— 动态 import html-to-image（不增首屏体积）
// v9.99.1 修复：原 html2canvas 1.4.1 不支持 oklab/oklch 颜色函数（Tailwind v4.1.17 色板），
//   复盘卡/情绪卡 getComputedStyle 返回 oklab → 解析即抛 "unsupported color function"。
//   改用 html-to-image（SVG foreignObject 浏览器原生绘制，无颜色解析器，天然支持现代 CSS）。
// ============================================================

/** 将指定 DOM 元素导出为 PNG 图片（本地下载） */
export async function exportElementAsPng(
  el: HTMLElement,
  filename: string,
  opts?: { background?: string; scale?: number }
): Promise<void> {
  const { toPng } = await import("html-to-image");
  const dataUrl = await toPng(el, {
    backgroundColor: opts?.background ?? "#0b1020",
    pixelRatio: opts?.scale ?? 2,
  });
  const a = document.createElement("a");
  a.download = filename;
  a.href = dataUrl;
  a.click();
}
