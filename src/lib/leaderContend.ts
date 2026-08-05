// ============================================================
// 龙头卡位战监控（v9.32.1 · 缺口4）
// 游资价值：同梯队 2-3 只竞争龙一（卡位战）是每日最关键博弈 ——
//   封单接近时卡位未定，追龙一有被反超风险；明确龙一才敢上。
// 纯函数，不碰 DOM/localStorage/网络
// ============================================================

export interface ContendLeader {
  code: string;
  name: string;
  height: number;      // 连板数
  sealFund: number;    // 封单资金（元）
  firstBoardTime: string;
  boardType?: string;
}

export interface ContendInput {
  mainline: string;
  leaders: ContendLeader[];
}

export interface ContendResult {
  status: "明确龙一" | "卡位胶着" | "梯队分散";
  /** 明确龙一时的龙一名称 */
  leader?: string;
  /** 卡位胶着时的竞争者 */
  contenders: string[];
  reason: string;
}

export function detectLeaderContend(input: ContendInput): ContendResult {
  if (input.leaders.length === 0) {
    return { status: "梯队分散", contenders: [], reason: "无龙头数据" };
  }
  const top = input.leaders[0];
  // 同高度竞争者（含龙一自己）
  const sameHeight = input.leaders.filter(l => l.height === top.height);
  if (sameHeight.length <= 1) {
    return { status: "明确龙一", leader: top.name, contenders: [], reason: `${top.height}板唯一，龙一地位明确` };
  }
  if (sameHeight.length <= 3) {
    // 封单差距 <20% → 胶着（卡位未定）
    const funds = sameHeight.map(l => l.sealFund ?? 0).sort((a, b) => b - a);
    const gap = funds[0] - (funds[1] ?? 0);
    const ratio = funds[0] > 0 ? gap / funds[0] : 1;
    if (ratio < 0.2) {
      return {
        status: "卡位胶着",
        contenders: sameHeight.map(l => l.name),
        reason: `同${top.height}板${sameHeight.length}只封单接近（差${(ratio * 100).toFixed(0)}%），龙一未定`,
      };
    }
    return {
      status: "明确龙一",
      leader: top.name,
      contenders: [],
      reason: `同${top.height}板${sameHeight.length}只但封单领先${(ratio * 100).toFixed(0)}%，龙一稳固`,
    };
  }
  return { status: "梯队分散", contenders: [], reason: `同高度${sameHeight.length}只过多，梯队混乱` };
}

/** 板型徽标（组件复用） */
export const BOARD_TYPE_META: Record<string, { label: string; cls: string; hint: string }> = {
  一字板: { label: "一字", cls: "bg-slate-500/20 text-slate-400", hint: "开盘即封无换手，难上车" },
  缩量板: { label: "缩量", cls: "bg-amber-500/20 text-amber-300", hint: "换手不足，谨慎接力" },
  换手板: { label: "换手", cls: "bg-emerald-500/20 text-emerald-300", hint: "充分换手，可上车" },
};
