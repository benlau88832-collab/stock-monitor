import { useState, useEffect, useMemo } from "react";
import { fmtMoney } from "../lib/format";
import { stockRealUrl } from "../lib/realLinks";
import {
  buildThemeLadder,
  detectBrokenBoards,
  type ZTPoolItem,
  type ThemeGroup,
  type BrokenBoardItem,
} from "../lib/themeLadder";
import { saveZTSnapshot, loadPrevZTSnapshot } from "../lib/ztSnapshot";
import { tradeDateStr } from "../lib/api";

// ============== 高度渐变色 ==============
function heightBadge(h: number): { bg: string; text: string } {
  if (h >= 5) return { bg: "bg-gradient-to-r from-amber-400 to-rose-500", text: "text-white" };
  if (h >= 4) return { bg: "bg-gradient-to-r from-amber-400 to-amber-600", text: "text-white" };
  if (h >= 3) return { bg: "bg-gradient-to-r from-amber-300 to-amber-500", text: "text-white" };
  if (h >= 2) return { bg: "bg-rose-500/20", text: "text-rose-300" };
  return { bg: "bg-slate-500/20", text: "text-slate-300" };
}

// ============== 先锋是否早盘（10:00 前封板） ==============
function isEarlyBird(fbtStr: string): boolean {
  // fbtStr 格式 "HH:MM:SS"
  const hh = parseInt(fbtStr.slice(0, 2), 10);
  const mm = parseInt(fbtStr.slice(3, 5), 10);
  return hh < 10 || (hh === 10 && mm === 0);
}

// ============== Props ==============
interface ThemeLadderProps {
  /** 从 App 传入的涨停池原始数据（复用 fetchLimitPoolSummary 已拉取的） */
  rawZTPool: any[] | null;
}

export default function ThemeLadder({ rawZTPool }: ThemeLadderProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [brokenBoards, setBrokenBoards] = useState<BrokenBoardItem[]>([]);
  const [hasYesterdaySnapshot, setHasYesterdaySnapshot] = useState(true);

  // 类型断言：rawZTPool 来自 fetchLimitPoolSummary 返回的 any[]
  const pool: ZTPoolItem[] = useMemo(() => {
    if (!rawZTPool || rawZTPool.length === 0) return [];
    return rawZTPool as ZTPoolItem[];
  }, [rawZTPool]);

  // 使用纯函数构建题材梯队
  const groups = useMemo(() => buildThemeLadder(pool), [pool]);

  // 快照存储 + 断板检测
  useEffect(() => {
    if (pool.length === 0) return;

    // 存今日快照（ThemeLadder 打开时也写一次，与 App 主管道双保险）
    const today = tradeDateStr();
    saveZTSnapshot(today, pool);

    // 加载昨日快照做断板检测（用"找最近历史快照"，天然兼容法定节假日）
    const yesterdayPool = loadPrevZTSnapshot(today);
    if (yesterdayPool && yesterdayPool.length > 0) {
      const broken = detectBrokenBoards(yesterdayPool, pool);
      setBrokenBoards(broken);
      setHasYesterdaySnapshot(true);
    } else {
      setBrokenBoards([]);
      setHasYesterdaySnapshot(false);
    }
  }, [pool]);

  const toggleExpand = (theme: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(theme)) next.delete(theme);
      else next.add(theme);
      return next;
    });
  };

  // 无数据
  if (!rawZTPool || rawZTPool.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-slate-500">
        涨停池数据尚未加载，题材梯队暂不可用。
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-amber-200">
          🏔️ 题材梯队
          <span className="ml-2 text-[11px] text-slate-500 font-normal">
            按行业(hybk)分组 · 高度=最高连板 · 先锋=最早封板 · 中军=最大成交额
          </span>
        </div>
        <span className="text-[11px] text-slate-500">{groups.length}个题材 · {pool.length}只涨停</span>
      </div>

      {/* 断板预警 */}
      {brokenBoards.length > 0 && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2">
          <span className="text-xs font-bold text-rose-400">⚠️ 断板预警：</span>
          {brokenBoards.map((b) => (
            <span key={b.code} className="text-xs text-rose-300 ml-2">
              昨日{b.yesterdayLbc}板
              <a href={stockRealUrl(b.code)} target="_blank" rel="noopener noreferrer"
                className="text-rose-200 font-bold hover:underline ml-0.5">
                {b.name}
              </a>
              今日断板
            </span>
          ))}
          <span className="text-[11px] text-rose-400/70 ml-2">，警惕中位股风险</span>
        </div>
      )}
      {!hasYesterdaySnapshot && brokenBoards.length === 0 && (
        <div className="rounded-lg border border-slate-500/30 bg-slate-500/10 px-3 py-1.5">
          <span className="text-[11px] text-slate-400">💡 首日运行，昨日快照不可用，断板预警将从明日起生效</span>
        </div>
      )}

      {/* 题材列表 */}
      <div className="space-y-0.5">
        {groups.map((g) => (
          <ThemeRow
            key={g.theme}
            group={g}
            isExpanded={expanded.has(g.theme)}
            onToggle={() => toggleExpand(g.theme)}
          />
        ))}
      </div>
    </div>
  );
}

// ============== 单行题材 ==============
function ThemeRow({
  group,
  isExpanded,
  onToggle,
}: {
  group: ThemeGroup;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const hb = heightBadge(group.height);
  const earlyBird = group.pioneer && isEarlyBird(group.pioneer.firstBoardTime);

  return (
    <div className={group.height >= 3 ? "border-l-2 border-amber-400" : ""}>
      {/* 主行 */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition text-left"
      >
        {/* 展开箭头 */}
        <span className="text-[11px] text-slate-500 w-4 shrink-0">
          {isExpanded ? "▼" : "▶"}
        </span>

        {/* 题材名 */}
        <span className="text-xs font-bold text-slate-200 w-20 shrink-0 truncate">
          {group.theme}
        </span>

        {/* 高度 badge */}
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-black shrink-0 ${hb.bg} ${hb.text}`}>
          {group.height}板高度
        </span>

        {/* 梯队 X/Y/Z */}
        <span className="flex gap-1 shrink-0">
          <TierBadge label="首板" count={group.tiers.first} isGap={group.height >= 2 && group.gapTiers.includes(1)} />
          <TierBadge label="二板" count={group.tiers.second} isGap={group.height >= 3 && group.gapTiers.includes(2)} />
          <TierBadge label="≥3板" count={group.tiers.thirdPlus} isGap={false} />
        </span>

        {/* 先锋 */}
        {group.pioneer && (
          <span className="text-[11px] text-slate-400 shrink-0">
            先锋:
            <span className="text-slate-200 font-bold ml-0.5">{group.pioneer.name}</span>
            <span className="text-slate-500 ml-0.5">{group.pioneer.firstBoardTime.slice(0, 5)}</span>
            {earlyBird && (
              <span className="ml-1 rounded px-1 py-0.5 text-[9px] font-bold bg-amber-500/20 text-amber-300">
                早盘先锋
              </span>
            )}
          </span>
        )}

        {/* 中军 */}
        {group.bellwether && (
          <span className="text-[11px] text-slate-400 shrink-0 ml-auto">
            中军:
            <span className="text-slate-200 font-bold ml-0.5">{group.bellwether.name}</span>
            <span className="text-slate-500 ml-0.5">{fmtMoney(group.bellwether.amount)}</span>
          </span>
        )}

        {/* 涨停总数 */}
        <span className="text-[11px] text-slate-500 shrink-0 ml-2">
          {group.count}只
        </span>
      </button>

      {/* 展开：组内明细 */}
      {isExpanded && (
        <div className="ml-6 mr-2 mb-2">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 text-slate-400">
                  <th className="px-2 py-1 text-left">代码</th>
                  <th className="px-2 py-1 text-left">名称</th>
                  <th className="px-2 py-1 text-center">连板</th>
                  <th className="px-2 py-1 text-right">封板资金</th>
                  <th className="px-2 py-1 text-right">换手率</th>
                  <th className="px-2 py-1 text-right">成交额</th>
                  <th className="px-2 py-1 text-right">首封时间</th>
                  <th className="px-2 py-1 text-center">炸板</th>
                </tr>
              </thead>
              <tbody>
                {group.stocks.map((s) => {
                  const bColor =
                    s.boardCount >= 4
                      ? "text-amber-300 font-black"
                      : s.boardCount >= 3
                      ? "text-amber-400 font-bold"
                      : s.boardCount >= 2
                      ? "text-rose-400 font-bold"
                      : "text-slate-300";
                  return (
                    <tr key={s.code} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-2 py-1 text-slate-400">{s.code}</td>
                      <td className="px-2 py-1">
                        <a
                          href={stockRealUrl(s.code)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-200 hover:text-amber-300"
                        >
                          {s.name}
                        </a>
                      </td>
                      <td className={`px-2 py-1 text-center ${bColor}`}>{s.boardCount}</td>
                      <td className="px-2 py-1 text-right text-rose-400">{fmtMoney(s.sealFund)}</td>
                      <td className="px-2 py-1 text-right text-slate-300">{s.turnoverRate.toFixed(1)}%</td>
                      <td className="px-2 py-1 text-right text-slate-300">{fmtMoney(s.amount)}</td>
                      <td className="px-2 py-1 text-right text-slate-300">{s.firstBoardTime}</td>
                      <td className="px-2 py-1 text-center">
                        {s.blastCount > 0 ? (
                          <span className="text-amber-400">{s.blastCount}次</span>
                        ) : (
                          <span className="text-slate-600">0</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ============== 梯队小标签 ==============
function TierBadge({
  label,
  count,
  isGap,
}: {
  label: string;
  count: number;
  isGap: boolean;
}) {
  // 断档 → 灰显"断档"
  if (isGap && count === 0) {
    return (
      <span className="rounded px-1 py-0.5 text-[10px] bg-slate-700/50 text-slate-500 line-through">
        {label}断档
      </span>
    );
  }
  // 有数量
  if (count > 0) {
    return (
      <span className="rounded px-1 py-0.5 text-[10px] bg-slate-500/20 text-slate-300">
        {label}:{count}
      </span>
    );
  }
  // 无需显示（高度不够的层级不需要标断档）
  return (
    <span className="rounded px-1 py-0.5 text-[10px] bg-slate-700/30 text-slate-600">
      {label}:0
    </span>
  );
}
