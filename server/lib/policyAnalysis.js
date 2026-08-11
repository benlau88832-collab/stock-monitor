// ============================================================
// server/lib/policyAnalysis.js —— 政策引擎（T-E2/E3/E5，v9.105.0）
// T-E2 首写概念识别（规则层）：新政策文档 vs 历史语料 → 词频 diff 检出"语料库零出现"新词
//   （搜索实证：十五五首写 低空经济/具身智能/人工智能+；规则层输出候选 → LLM 裁决 policyFirstWrite）
// T-E3 政策关键词 → 概念白名单 504 → 受益板块/龙头（stock_concepts 表）
// T-E5 政策日历联动统计：政策日后 3/5 日涨停家数变化（zt_snapshot）
// 纯函数为主（LLM 裁决在调用方），无副作用
// ============================================================

// 停用词（2 字高频虚词/套话动词，避免误报首写）
// v9.105.0 修正：只停"动词/虚词"——"安全/经济/市场/产业"等名词是概念组成部分
//   （"低空经济/国家安全"），停用会漏掉首写概念（十四五行文验证：经济/安全被滤导致词频全空）
const STOP_WORDS = new Set([
  "我们", "一个", "全面", "推进", "加快", "建设", "发展", "实施", "坚持", "深化", "推动", "完善", "健全",
  "加强", "提升", "强化", "优化", "统筹", "建立", "形成", "实现", "促进", "支持", "引导", "鼓励", "发挥",
  "作用", "水平", "机制", "能力", "领域", "重点", "方面", "工作", "任务", "目标", "要求", "原则",
  "按照", "根据", "围绕", "立足", "着眼", "不断", "持续", "积极", "稳妥", "有序", "协同", "联动", "融合",
  "创新", "改革", "开放", "合作", "国际", "国内",
]);

/**
 * 词频统计（2-4 字滑窗，去停用词）
 * 4 字窗：首写概念主体（低空经济/具身智能/人工智能+ 均 3-4 字），
 *   噪声由 minFreq 门槛 + LLM 裁决过滤
 * @param text 文档全文
 * @returns Map<词, 频次>
 */
// ============ 政策术语模式提取（v9.105.0 重构：替代滑窗词频） ============
// 滑窗词频在 2 万字长文中产生 2 万+ 跨界碎片（"家安全能"等），频次排序把低频实证概念
// （低空经济 1 次/具身智能 1 次）挤出候选。改为"前缀 + 政策后缀词"模式：
//   "低空经济" = 前缀"低空" + 后缀"经济"；"具身智能" = "具身" + "智能"
//   碎片（安全能力/家安全能）天然不构成"前缀+后缀"模式 → 大幅降噪
const POLICY_SUFFIX = [
  "经济", "产业", "体系", "能力", "建设", "工程", "行动", "战略", "平台", "集群", "生态", "场景",
  "制造", "装备", "能源", "材料", "数据", "要素", "智能", "安全", "治理", "服务", "创新", "科技",
  "金融", "消费", "投资", "贸易", "市场", "标准", "制度", "文化", "教育", "医疗", "养老", "基础设施",
  "生产力", "网络", "芯片", "机器人", "低空", "算力", "量子",
];

/** 政策术语提取（前缀2-3字 + 后缀词），返回 Map<术语, 频次> */
function extractPolicyTerms(text) {
  const sentences = String(text || "").split(/[，。、；：\n\r]/);
  const terms = new Map();
  for (const s of sentences) {
    for (const suf of POLICY_SUFFIX) {
      let idx = s.indexOf(suf);
      while (idx > 0) {
        // v9.105.0：前缀只取 2 字（首写概念形态=2字前缀+后缀：低空+经济/具身+智能/数据+要素；
        //   3 字前缀会带入前导字产生跨界组合如"展量子科技"）
        const prefix2 = s.slice(Math.max(0, idx - 2), idx);
        if (/^[\u4e00-\u9fa5]{2}$/.test(prefix2) && !STOP_WORDS.has(prefix2)) {
          const term = prefix2 + suf;
          if (term.length >= 3 && term.length <= 5) terms.set(term, (terms.get(term) ?? 0) + 1);
        }
        idx = s.indexOf(suf, idx + 1);
      }
    }
  }
  return terms;
}

// 规划文件套话黑名单（子串命中即剔除——高频套话，非首写概念）
const JARGON = [
  "现代化", "中国式", "十五", "十四五", "推进", "提质", "全面", "深化", "高质量",
  "加强", "健全", "机制", "体系",
];

/**
 * T-E2 规则层：首写候选 —— 新文档中"历史语料零出现"的政策术语
 * 门槛：术语频次 ≥1 即报（实证低空经济/具身智能在规划建议中仅 1-2 次，过严会漏——LLM 裁决兜底）
 * @param historyTexts 历史语料全文数组
 * @param newText 新政策全文
 * @returns [{ term, freq }] 按频次降序
 */
function findFirstWriteTerms(historyTexts, newText) {
  const hist = new Set();
  for (const h of historyTexts) for (const t of extractPolicyTerms(h).keys()) hist.add(t);
  const newTerms = extractPolicyTerms(newText);
  const out = [];
  for (const [t, n] of newTerms) {
    if (hist.has(t)) continue;                        // 历史已有
    if (JARGON.some(j => t.includes(j) || j.includes(t))) continue; // 套话
    // freq=1 的术语只保留 ≤4 字（低空经济/具身智能/数据要素——典型 2 字前缀+2 字后缀首写概念；
    //   5 字+ freq=1 多为跨界组合如"家安全能力/和公共服务"，丢弃）
    if (n === 1 && t.length > 4) continue;
    out.push({ term: t, freq: n });
  }
  // 排序：2 字前缀 freq=1 的高置信首写置顶（低空经济/具身智能/数据要素——实证首写概念，
  //   在规划建议中仅 1 次，若按频次排序会被高频既有组合挤出）；freq≥2 排后
  const low = out.filter(x => x.freq === 1).sort((a, b) => b.term.length - a.term.length);
  const high = out.filter(x => x.freq >= 2).sort((a, b) => b.freq - a.freq);
  return [...low, ...high].slice(0, 40);
}

/**
 * T-E3：政策关键词 → 概念白名单命中板块（CONCEPT_GROUPS roots 子串匹配）
 * @param kw 政策关键词（如 "具身智能"）
 * @param conceptGroups [{group, roots}] 概念白名单
 * @returns 命中板块名数组
 */
function matchPolicyToBoards(kw, conceptGroups) {
  if (!kw) return [];
  const out = [];
  for (const g of conceptGroups) {
    if (g.roots.some(r => String(kw).includes(String(r)) || String(r).includes(String(kw)))) out.push(g.group);
  }
  return [...new Set(out)];
}

/** T-E5：政策日历静态表（五年规划周期/两会/中央经济工作会议） */
const POLICY_CALENDAR = [
  { date: "2025-10-23", title: "十五五规划建议发布", category: "五年规划", note: "首写：低空经济/具身智能/人工智能+" },
  { date: "2020-11-03", title: "十四五规划建议发布", category: "五年规划", note: "首写：量子信息/脑机接口/类脑智能" },
  { date: "2026-03-05", title: "2026 全国两会（政府工作报告）", category: "两会", note: "每年 3 月初" },
  { date: "2025-12-10", title: "中央经济工作会议", category: "中央经济工作会议", note: "每年 12 月中上旬" },
];

/**
 * T-E5：政策日后 N 日涨停家数变化（zt_snapshot 聚合）
 * @param ztRows [{date, pool_count}] 按日期升序的涨停家数序列
 * @param policyDate 政策日期 YYYY-MM-DD
 * @returns { day3Delta, day5Delta } | null（数据不足）
 */
function policyImpactStats(ztRows, policyDate) {
  const byDate = new Map(ztRows.map(r => [String(r.date).slice(0, 10), Number(r.pool_count ?? 0)]));
  const dates = [...byDate.keys()].sort();
  const idx = dates.indexOf(String(policyDate).slice(0, 10));
  if (idx < 0) return null;
  const at = byDate.get(dates[idx]) ?? 0;
  const d3 = dates[idx + 3] != null ? (byDate.get(dates[idx + 3]) ?? 0) - at : null;
  const d5 = dates[idx + 5] != null ? (byDate.get(dates[idx + 5]) ?? 0) - at : null;
  return { day3Delta: d3, day5Delta: d5 };
}

module.exports = { extractPolicyTerms, findFirstWriteTerms, matchPolicyToBoards, POLICY_CALENDAR, policyImpactStats };
