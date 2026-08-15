// ============================================================
// BackToTop.tsx —— 一键回到顶部（v9.149.1，用户需求）
// 页面滚动超过 400px 后右下角出现"↑"按钮，点击平滑回到顶部。
// 全局挂载（所有 Tab 生效），跟随 SpriteOverlay 位置避免遮挡。
// ============================================================
import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

export default function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;
  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="fixed bottom-24 right-4 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-sky-500/40 bg-sky-950/80 text-sky-300 shadow-lg backdrop-blur transition-colors hover:bg-sky-800/80"
      title="回到顶部"
      aria-label="回到顶部"
    >
      <ArrowUp size={18} />
    </button>
  );
}
