# 会话交接文档 — A股实时交易辅助终端

> 生成时间：2026-07-31 21:30 (SGT)
> 当前版本：v9.6 · build 07-31 21:00
> HEAD：`5ec53bc`
> 分支：`arena/019fa6b7-stock-monitor`（已同步推 main，GitHub Pages 已部署）
> 线上地址：https://benlau88832-collab.github.io/stock-monitor/

---

## 一、全局规则（每次改动必须遵守）

1. **NEVER modify**: `vite.config.ts`, `package.json` build config, `vite-plugin-singlefile` 设置, `base` 路径 — 除非用户明确允许
2. 所有显示数据 **MUST** 来自真实接口；**NO** 假数据、`Math.random`、mock
3. 不加重依赖；保持暗色主题；中文代码注释解释"为什么"
4. AI（Agnes）风格：游资与机构双视角实战复盘分析师。Prompt 只输出结论+数字。**NO** 免责声明 "仅供参考/不构成投资建议"。**NO** 模糊措辞

### 每次改动的收尾流程（必须执行）

```bash
# a. 类型检查（修改的文件必须通过，历史错误记录即可）
npx tsc --noEmit

# b. 更新 App.tsx 底部 footer 的 build stamp
#    格式：vX.Y · build MM-DD HH:mm

# c. 更新 CHANGELOG.md 顶部，写版本号+日期+变更摘要

# d. 构建（输出到 docs/）
npm run build

# e. 提交推送
git add -A
git commit -m "..."
git push origin arena/019fa6b7-stock-monitor
git push --force origin arena/019fa6b7-stock-monitor:main

# f. 等 3 分钟后 fetch_page 验证 GitHub Pages
```

---

## 二、架构概览

### 技术栈
- **Build**: Vite 7.3.2 + `vite-plugin-singlefile`（产物为单个 `docs/index.html` ~941KB）
- **Base path**: `base: "/stock-monitor/"` in `vite.config.ts`
- **Framework**: React + TypeScript + Tailwind CSS
- **Data**: JSONP via `src/lib/jsonpQueue.ts`（并发≤2，重试退避）
- **AI**: `src/lib/ai.ts` 统一中枢 → `src/lib/aiSettings.ts`（多模型，Agnes .cn 主 / .com 备 + 6 其他厂商）

### 核心文件清单

```
src/
├── App.tsx                        # 主应用 (~987行, tabs/数据拉取/情绪/作战/告警)
├── main.tsx                       # React 入口
├── index.css                      # 全局样式
│
├── lib/
│   ├── ai.ts                      # AI 统一调用中枢 (407行)
│   │                               缓存/限速/单飞/降级/thinking回退链路
│   │                               关键: fetchWithTimeout 解析 content || reasoning_content
│   │                               关键: executeAI 循环 thinking=true→false→下一端点
│   │                               超时: 30s
│   ├── aiPrompts.ts               # 9个任务模板 (195行)
│   │                               任务: preopenPlan/closeReview/annRank/ladderScan/
│   │                                     newsDigest/weeklyCoach/stockJudge/policyDiff/supervisor
│   │                               supervisor: system/user 透传，不用 SYSTEM_PREFIX
│   ├── aiSettings.ts              # 多模型设置 (56行) 7厂商预置
│   ├── alertBus.ts                # 提醒中枢 (175行) emit冷却15min去重
│   ├── api.ts                     # 东财接口封装 (1082行) JSONP/trackedJsonp
│   ├── apiHealth.ts               # 接口健康遥测
│   ├── boardMap.ts                # 板块映射 (67行) ensureBoardMap/forceRebuildBoardMap
│   ├── boardTaxonomy.ts           # 板块分类 (82行) industry/theme/style/region
│   ├── commodities.ts             # 期货品种配置
│   ├── dataStore.ts               # 存储抽象层 (150行) getAllOnDate/getAllSince/upsert
│   ├── etfScore.ts                # ETF评分
│   ├── format.ts                  # fmtMoney/fmtPct/pctColor
│   ├── intelStats.ts              # 代码计数器 (145行) computeStats/formatStatsForPrompt
│   ├── jsonpQueue.ts              # JSONP 全局调度器
│   ├── llmNewsIntelligence.ts     # 情报引擎 (224行) generateDailyIntelligence
│   ├── llmSignals.ts              # LLM消息维度
│   ├── newsMemoStore.ts           # 情报记忆库 (145行) 分段存储/30天滚动
│   ├── recTracker.ts              # 推荐归因
│   ├── regimeGate.ts              # 市场闸门
│   ├── seatLedger.ts              # 席位台账
│   ├── seatProfiles.ts            # 席位档案
│   ├── sentimentStore.ts          # 情绪分存储
│   ├── signalLedger.ts            # 信号账本
│   ├── stockScore.ts              # 个股评分
│   ├── themeLadder.ts             # 题材梯队 (305行)
│   ├── themeScore.ts              # 板块评分
│   ├── tradingSession.ts          # 交易时段状态机 (67行) pre/auction/trading/lunch/post
│   └── ztSnapshot.ts              # 涨停池快照
│
├── components/
│   ├── Dashboard.tsx              # 驾驶舱 (305行) 时段驱动 pre/trading/post 布局
│   ├── IntelligenceDashboard.tsx  # 情报分析台 (386行) 分段触发+指定日期+智能窗口
│   ├── IntelligenceDrawer.tsx     # AI督导抽屉 (320行) supervisor任务+parseQueryDate
│   ├── SettingsModal.tsx          # 设置面板 (91行) 7厂商+重建板块表按钮
│   ├── TopNav.tsx                 # 导航 (161行)
│   ├── NewsPanel.tsx              # 消息面 (341行)
│   ├── StockWatchlist.tsx         # 个股雷达 (559行)
│   ├── DragonTiger.tsx            # 龙虎榜 (406行)
│   ├── BattlePlan.tsx             # 作战卡 (259行)
│   ├── Playbook.tsx               # 盘前剧本 (411行)
│   └── ... (其余组件)
│
├── vite.config.ts                 # ⛔ DO NOT MODIFY
├── docs/                          # 构建产物（GitHub Pages 源）
└── CHANGELOG.md                   # 版本历史
```

---

## 三、本次会话完成的所有改动（v9.4 → v9.6）

### v9.4 — 板块表修复 + 情报台指定日期 + 督导日期识别
- `boardMap.ts`: `ensureBoardMap()` 加 console.log 日志 + `forceRebuildBoardMap()` 导出
- `SettingsModal.tsx`: 加 🔄 重建板块表 按钮
- `App.tsx`: `ensureBoardMap().catch(...)` 打日志

### v9.4.1 — 情报台"分析该日"重构
- `dataStore.ts`: 新增 `getAllOnDate(dateStr)` 精确取某日全部素材
- `IntelligenceDashboard.tsx`: UI 分两行，第二行 date input + 📅 分析该日(紫色按钮)
- `runIntelligence` 用 `getAllOnDate` 替代 `getAllSince`+filter

### v9.4.2 — 督导室日期识别重构
- `IntelligenceDrawer.tsx`: `parseQueryDate(q)` → `{ymd, dash}` 支持 7.30/昨天/前天/M月D日/YYYYMMDD
- 板块统计用 `getAllOnDate`；自选股用 `if(!qd)` 包裹

### v9.4.3 — callAI 兼容思考模型
- `ai.ts` `fetchWithTimeout`: `content` 空时 fallback 读 `reasoning_content` + console.warn

### v9.4.4 — stockJudge maxTokens 8000
- `aiPrompts.ts`: `stockJudge.maxTokens` 3000→8000

### v9.5 — 修复思考模式回退链路（核心 bug）
- **根因**: `thinking=true` 返回空时直接 `return degradeResult`，不给 `thinking=false` 回退机会
- `ai.ts` `executeAI`: 循环重构，thinking=true 空→continue→thinking=false；超时 20s→30s；lastError 贯穿

### v9.5.1 — 盘中驾驶舱补回组件
- `Dashboard.tsx`: trading 布局左侧补回 `MarketOverview` + `PopularityRadar`

### v9.6 — 督导室 AI 回答质量修复（重大改动）
- **根因**: 督导室走 `stockJudge` 任务，system 是"复盘分析师+按小标题分段"，与督导室角色冲突；数据和指令全混在 user 里→AI 复述数据不回答问题
- **修复**:
  - `aiPrompts.ts`: 新增 `supervisor` 任务（system/user 透传，不用 SYSTEM_PREFIX）
    - `temperature: 0.4, maxTokens: 4000, thinking: false`
  - `IntelligenceDrawer.tsx`:
    - 新增 `SUPERVISOR_SYSTEM` 专用角色指令
    - `buildSupervisorPrompt` 返回 `{system, user}` 分离
    - `sendMessage` 改用 `callAI("supervisor", {system, user})`

---

## 四、已验证的 API 端点

| 端点 | 用途 | 状态 |
|------|------|------|
| push2.eastmoney.com | 实时行情/板块资金 | ✅ |
| push2delay.eastmoney.com | 延迟行情 | ✅ |
| push2ex.eastmoney.com | 涨停池/炸板池/跌停池 | ✅ |
| datacenter-web.eastmoney.com | 龙虎榜/解禁 | ✅ |
| push2his.eastmoney.com | K线历史 | ⚠️ 有时限速 |
| np-anotice-stock.eastmoney.com | 公告 | ✅ |
| np-weblist.eastmoney.com | 快讯 | ✅ |
| emappdata.eastmoney.com/stockrank | 人气榜 | ✅ |
| apihub.agnes-ai.cn | AI主端点 | ✅ |
| apihub.agnes-ai.com | AI备端点 | ✅ |

---

## 五、待解决/已知问题

### 待验证
1. **v9.6 督导室回答质量** — 代码已改但用户还未测试确认效果。可能还需要调 `SUPERVISOR_SYSTEM` 的措辞
2. **思考模式是否真正可用** — v9.5 修了回退链路，但 supervisor 任务设了 `thinking: false` 避开问题

### 已知接口限制（无法解决）
1. 两融余额全市场汇总 — datacenter reportName 探测失败
2. 股指期货基差 IF/IC/IM — push2 secid 探测失败
3. 富时A50期货 — secid 探测失败
4. 南向资金净买入 — NET_DEAL_AMT=null
5. 成交额历史 — push2his kline 间歇限速（已加 10min 缓存+重试+fallback）
6. 历史分位数(250日) — 需积累情绪分历史数据

### 潜在优化方向
1. 督导室多轮对话上下文（目前每次都是独立请求，不带历史消息）
2. 情报台板块统计依赖 `boardMap` 词表（首次加载失败→新闻打不上行业标签→统计只有"公告动态"）
3. `node_modules` 偶尔被清理导致 `npx tsc` 走错包——需要先 `npm install`

---

## 六、关键代码事实（容易踩坑）

- `f62 ≡ f66+f72`（主力净流入 = 超大单+大单）
- 明暗盘用四象限模型（2 独立维度）
- 涨停池快照: `ztpool:YYYYMMDD` in localStorage
- 情绪分 9 因子含 premiumAvg + promotionRate
- boardMap: `bm_industry_map`/`bm_vocab`/`bm_date` 每日重建
- 数据存储: `ds_news`/`ds_ann` 30天滚动 6000条 FIFO
- 情报记忆: `news_memo_YYYYMMDD`(终盘) + `intel_seg_YYYYMMDD_slot`(分段)
- alertBus: 冷却在 BEFORE feed 入口，同 id 15min 内彻底忽略
- 信号告警: `lastSignalActive` 边缘检测，只在 false→true 跃迁时触发
- AI 缓存 key: `ai:cache:task:YYYY-MM-DD:hash`
- AI 设置: `ai_settings_v1` in localStorage
- 自选股: `stock_watchlist` in localStorage

---

## 七、导航结构

```
驾驶舱(dashboard) → 资金主线(fundline) → 个股雷达(radar) → 龙虎榜复盘(dragon) → 消息面(news)
```

右上角：自动/手动刷新 | 声音/通知开关 | 铃铛(AI督导抽屉) | ⚙️(设置面板)

---

## 八、用户沟通特点

- 直接、技术导向、中文
- 期望具体证据和数据，对"返回内容为空"等模糊失败极不耐烦
- 会提供截图并要求深度排查根因，不接受表面修复
- 给指令时非常精确，包含具体文件/行号/代码片段，期望严格按指令执行
- 偶尔会给出 3 步骤的分步指令，期望按顺序逐步完成并验证
