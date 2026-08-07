# Changelog

本文件记录 `stock-monitor` 项目各版本的提交哈希和内容摘要，方便追溯与回滚。

---

## v9.69 — GLM5.2 V10 全部落地：视觉层级重构 + AI 决策贯通体验（8/8 指令）(2026-08-07)

> 依据 `022_股票监控项目/GLM5.2建议-v10.txt`（319 行审查报告）逐条执行，8 条修改指令全部完成。
> 核心目标：把 AI 结论从"蚂蚁字堆里的一员"变成"整屏最大最亮的东西"——游资 3 秒看到"买什么、上多少仓"。

### 🔴 P0 视觉层级核心（V10-1/2/3）
- **V10-1 DecisionVerdictCard**：裁决 text-base(16px)→**text-4xl(36px) font-black**（✅可上车/⏸观望/🚫禁止）+ 置信 text-xl + AI 理由 text-base；规则投票保持折叠
- **V10-2 StockPickList 三级字号**：标题 text-base、标的名称 text-xl font-black、代码/板数 text-xs、**仓位独立色块**（text-lg font-black emerald）、止损 text-sm、AI 研判 text-sm violet、买入逻辑 text-sm、卡片间距 space-y-2
- **V10-3 Dashboard 重排**：StockPickList **紧贴 DecisionVerdictCard**（裁决→选股一气呵成），BattlePlan/LimitTempBar 移到下方

### 🟠 P1 AI 贯通体验（V10-4/5/6）
- **V10-4 BattlePlan 内嵌 AI 裁决**：每条主线标题旁显示"🤖 可上车 82%"徽章（agentResults 按主线名匹配）
- **V10-5 选股嵌入盯价**：每只标的名旁显示"📡 偏离 ±X%"徽章（30s 轮询 /api/watch/list，偏离>3% 红/≤3% 蓝）
- **V10-6 全局字号底线**：全仓 text-[9px] 93 处→text-xs、决策区 4 文件 text-[10px] 45 处→text-xs，**grep 验收 0 残留**

### 🟡 P2 增强（V10-7/8）
- **V10-7 妙想调研嵌入选股**：闭环打通 —— server +POST /api/research/report（落库，同日幂等）+GET /api/research/reports（批量查最新）；AIConsole 调研完成（Phase 4 有结论）自动落库；选股清单显示"🔬 深度调研：结论"
- **V10-8 FiveQBar 第一问放大**：主线名 text-xs→**text-xl font-black**（今天最强主线 = 第一优先级信息），卡片描边强调

### 遵循 CLAUDE.md
- 三重验证门：tsc 0 error / build 成功 / test 155 全绿
- 跨文件一致性：BattlePlan 加 prop → Dashboard 调用同步；StockPickList watchMap/researchMap → server 接口配套
- 落库冒烟：POST report → GET reports 查回 → 删除测试记录 ✅

---

## v9.68 — AI 一键加入个股雷达 + 开启盯价监控（调研→雷达→监控闭环）(2026-08-07)

> 用户需求：对任意未监控个股，让 AI 助手直接加入个股雷达并开启盯价监控。

### 改动
- **researchTools.ts** 新增工具 `addToRadar`：写 `localStorage: stock_watchlist`（自选股数组，上限 30，去重）+ `dispatchEvent("stock-watchlist-changed")` 通知已挂载的 StockWatchlist 刷新
- **StockWatchlist.tsx**：监听 `stock-watchlist-changed` 事件 → `setCodes(loadWatchlist())` 自动刷新（AI 加入后雷达立即显示）
- **RESEARCH_SYSTEM**：调研完成后引导"先 addToRadar 加入雷达，再 addPriceWatch 开启盯价监控，两步一次完成"

### 效果
AIConsole 对任意票（含未监控的）：
```
你：深度调研 600487 并帮我加入雷达盯价
AI：...（五段式调研）→ addToRadar(600487) 加入雷达 → addPriceWatch(买入区/止损) 开启监控
→ 个股雷达 Tab 立即出现该股卡片 + 盯价监控面板同步显示
```

### 验证
- 三重验证门：tsc 0 / build 成功 / test 155 全绿

---

## v9.67-fix — AIConsole 降级排查修复（PayloadTooLarge + 上游超时 + 降级文案 + ctx 名识别）(2026-08-07)

> 用户报：AIConsole 显示"⏸ 本次为规则结果（AI 配额受限）"但工具轨迹显示调了 6 个工具，文案与实际矛盾。

### 深度排查（PM2 日志）
1. **PayloadTooLargeError：request entity too large**（反复出现）—— v9.64 把 express.json limit 1mb 太狠，AI 长上下文+history+toolDefs+researchCtx 累积超 1mb
2. **AI 上游超时**：`[ai] call failed: upstream timeout | proxy: http://127.0.0.1:7897` —— 妙想 API 经用户代理调用 30s 超时
3. **降级文案撒谎**：assistantAgent.ts:161 固定"本次未能调用全站数据"，但工具实际调了
4. **ctx 残留旧标的**：用户问"亨通光电"（无 6 位代码）→ extractStockCode 返 null → ctx 不切换 → 助手靠工具查到 600487 但 ctx 仍指中天
5. **降级原因不分**：AIConsole 固定显示"AI 配额受限/失败"，实际可能是 timeout/network/model/429

### 修复
- **server/index.js**：`express.json` limit 1mb → **2mb**（PayloadTooLargeError 根治）
- **server/routes/ai.js**：调妙想 API 超时 30s → **20s** + 失败分类 `{reason: "timeout"|"network"|"model"}`
- **src/lib/ai.ts**：callAgentChat 透传 `reason`（502/500 也返回带 reason 的对象，不再静默 null）
- **src/lib/assistantAgent.ts**：智能降级文案（按 reason 分类 + 显示已调工具数）；累加 `lastReason`；超时/网络/模型各自明确提示
- **src/lib/stockNames.ts**（新）：常用股票名→代码映射（18 只：亨通光电→600487 等）
- **src/lib/researchTools.ts**：extractStockCode 双匹配（6 位代码 OR 中文名映射）→ "个股深度调研 亨通光电"也能识别并切 ctx
- **src/components/AIConsole.tsx**：降级标签"⏸ 本次降级回复（非 AI）"+ 工具轨迹标注"部分结果可用"

### 验证
- 三重验证门：tsc 0 / build 成功 / test **155 全绿**（新增中文名识别 3 用例）
- 单测覆盖：中文名→代码、reason 降级分支

---

## v9.67 — AIConsole 真·多轮上下文（结构化调研会话状态 researchCtx）(2026-08-07)

> 用户要求："修改成跟我们这样对话一样，拥有上下文理解能力" —— v9.66-fix 只传 8 条文本不够，
> 本版加入**结构化会话状态**：标的/进度/已收集数据持久化，每轮注入 LLM，刷新不丢。

### 核心：researchCtx（researchTools.ts）
- `ResearchCtx`：{ code, name, phase(0-4), collected[](≤20条), conclusion } —— "调研到哪了"的结构化快照
- `extractStockCode / isNewResearchRequest / isContinueResearch`：指令识别（新调研/继续/换标的）
- `researchCtxNote`：把会话状态注入 LLM 用户消息（"已推进到 Phase 2，已收集：A/B/C，继续 Phase 3"）
- `updateResearchCtxAfterReply`：回复后自动推进 Phase（含评级→Phase 4+结论）
- 持久化 `localStorage: ai_research_ctx`（刷新页面上下文不丢）

### AIConsole.tsx
- 新调研指令（含代码）→ 开新会话；"继续/深入"→ 沿用；新提不同代码 → 切换
- 对话历史也持久化（`ai_console_msgs`，刷新恢复）
- 调用时同时传 `history`（文本）+ `researchCtx`（结构化）—— 双保险

### assistantAgent.ts
- `opts.researchCtx` 注入 user 消息顶部（结构化上下文优先于纯文本历史）
- 深度调研轮数 5→12（v9.66-fix 保留）

### 效果
- "个股深度调研 600522" → "继续深入查询财务" → "继续 Phase 3+4"：LLM 每轮都知道标的/进度/已收集数据，不重头、不串场（中天调研不会再冒出亨通结论）
- 刷新页面后说"继续"仍接得上

### 验证
- 三重验证门：tsc 0 / build 成功 / test 154 全绿（新增 researchCtx 5 用例）
- 注意：researchTools 追加代码时 bash heredoc 会展开 `${}` 污染代码 → 已用 Write 全量重写修复

---

## v9.66-fix — AIConsole 深度调研多轮上下文修复（"继续/深入查询"不再断片）(2026-08-07)

> 用户反馈：AIConsole 调研"深入查询/继续 Phase3"后回答串场（中天调研冒出亨通结论）、每轮从 Phase 0 重头来。
> 根因：整个链路单轮无记忆 —— server 只发 system+user；AIConsole 不传对话历史；ReAct 5 轮上限跑不完五段式。

### 修复
- **server/routes/ai.js**：`/api/ai/call` 支持 `history` 数组（最近 8 条，角色清洗后插到 system 与 user 之间）
- **src/lib/ai.ts**：`callAgentChat` 新增 `opts.history` 透传
- **src/lib/assistantAgent.ts**：`runAssistantAgent` 新增 `opts.history`；检测"深度调研/深度分析/深入查询/继续"→ ReAct 轮数 5→**12**（跑得完五段式）；system 新增"多轮衔接"规则（读历史确认标的与进度，从上次停止处继续，不重复 Phase 0，标的切换才开新调研）
- **src/components/AIConsole.tsx**：传最近 8 条对话历史（清洗掉工具轨迹/系统标记）

### 验证
- 三重验证门：tsc 0 / build 成功 / test 149 全绿
- server ai.js 语法校验通过

---

## v9.66 — 三 Skill 嵌入 + 个股盯价监控（全站 AI 调研 · PG 存储 · ±5% 强提示）(2026-08-07)

> 依据 `022_股票监控项目/方案_调研嵌入与盯价监控.md` 执行。零硬编码：所有标的由用户经 AI 对话录入（price_watch 表），系统只做通用流程。

### server 层
- **db.js** +3 表：`research_reports`（调研报告+核心数据，同日幂等覆盖）/ `price_watch`（监控清单）/ `price_watch_log`（价格走势快照）/ `price_watch_events`（触发事件）
- **routes/research.js**（新）：妙想 API 中转 3 接口（quote/data/search）—— child_process 调本机 mx-data/mx-search Python 脚本，`MX_APIKEY` 环境变量读取（Key 只存服务端，符合红线）
- **routes/watch.js**（新）：监控清单 CRUD + 走势查询 + 触发事件（未读轮询/已读标记）+ `runWatchCheck` 盯价核心（批量拉现价→偏离度→写 log→触发）
- **cron.js**：盘中每 5 分钟盯价（交易日 9-15 点，active 清单）+ 15:40 收盘盯价快照

### 前端层
- **researchTools.ts**（新）：AIConsole 新增 6 个工具 —— researchQuote/researchData/researchSearch（妙想调研）+ addPriceWatch/listWatches/updatePriceWatch（盯价监控）+ 五段式调研流程 system 注入（stock-deep-research-v2 流程引导）
- **PriceWatchPanel.tsx**（新）：监控清单（现价/买入区/偏离度/状态）+ 偏离度进度条（中间绿色带=±5%触发区）+ SVG 走势图（买入区上下沿虚线+触发红点）+ 30s 轮询触发事件 → alertBus 强提示（声音+系统通知+标题闪烁）
- **App.tsx**：PriceWatchPanel 挂"个股雷达"Tab（lazy）

### 使用方式（全站 AI 助手）
1. AIConsole 问「深度调研 600XXX」→ AI 按五段式（速览→财务→消息→行业→评级）自动调研，产出三档估值/目标价/支撑压力/胜率赔率
2. AI 询问是否录入盯价监控 → 确认后 addPriceWatch 写入买入区/止损
3. 个股雷达 Tab 实时显示偏离度；跌入买入区 ±5% → 强提示

### 遵循 CLAUDE.md
- 三重验证门：tsc 0 error / build 成功 / test 149 全绿
- MX_APIKEY 只存 server/.env（红线 #8）；提示措辞用"进入关注区间"（合规）；零硬编码标的
- server 冒烟测试通过（茅台 1309.22 偏离 +0.7% 触发链路验证，测试数据已清理）

---

## v9.65 — V1/V2 待办收尾（S1/S7/M2 + V2-P2 可观测化）(2026-08-07)

> 承接 v9.64 的剩余待办，一次做掉四项，遵循 CLAUDE.md 自验证协议。

### V1-S1 consecutiveDays 估算标注
- BoardRankPanel 连续天数显示改"约 N 天流入/流出*"，title 注明"基于 5日/10日资金累比的估算值（非逐日真实落库）"——不再误导为真实连续天数

### V1-S7 alertBus 冷却持久化
- cooldownMap 持久化 localStorage（`alert_cooldown_map`，只载入未过期项）——原模块内存态刷新即清空，同一警报刷新后 15 分钟内重复报警

### V1-M2 judgeFlowType 统一
- App.tsx 删内联 judgeFlowType，统一 import `lib/stockScore`（文案升级为"共振流入（看多）"等含括号注释版），防三处口径 drift

### V2-P2 可观测化
- **OpsPanel**：新增运维面板（Dashboard 底部常驻）——数据源成功率/失败接口/慢接口 + AI 今日调用/失败/平均延迟 + JSONP 并发/排队 + 因子失效/缺失/样本
- **dataSource.ts 双源熔断**：`fetchWithFallback` 工具层（主源→备源回退 + 连续失败 3 次熔断 10 分钟，内存+localStorage 双态，5 个单测）
- **Dockerfile + docker-compose.yml**：PG16 + 服务端一键部署（server/ 目录 `docker compose up -d`，.dockerignore 已加）

### 遵循 CLAUDE.md
- 三重验证门：tsc 0 error / build 成功 / test 149 全绿（新增 dataSource 5 用例）
- 跨文件一致性：judgeFlowType 两处引用点已确认统一；OpsPanel 数据源字段（ApiRecord.recentCalls/avgMs）已对齐
- 单测 149 全绿

---

## v9.64 — V1/V2 全栈审查整改（止血 P0 + 贯通 P1，遵循 CLAUDE.md 红线）(2026-08-07)

> 依据 `022_股票监控项目/审查报告-V1.txt`（546 行）+ `审查报告-V2.txt`（286 行）+ 项目级 CLAUDE.md 执行。

### P0 数据正确性
- **核按钮 f2→f3**：核查已解决（prevZtStats 用 brief.pct 涨跌幅 ✓，V9 已清死代码）
- **北交所聚合**：fetchMarketMainFund secids 补 `0.899050`（此前缺北交 → 小盘资金失真）
- **时区统一**：核查已解决（V9-D3 已把 getDay() 全部替换为 getBJDate；残留 11 处仅为注释）
- **auction 强制 proxy**：核查已解决（fetchQtBatch 已走 /api/proxy，GBK 正确解码）

### P0 Agent 假数据地基（V2-P0-3）
- agentTools `computePositionAdvice` / `computePortfolioRisk` 的 `totalCapital: 1e6` → `loadDisciplineState()` 真实总资金/持仓市值（假数据算真仓位=地基沙子）

### P0 后端安全与去重（V2-P0-5 + V1 安全段）
- cron `contentKey` 去内存 seq：改 sha256 确定性哈希（原 fallbackSeq 重启后重复入库）
- `express.json 10mb → 1mb` + `kv/bulk 数组 ≤100`（防一次 10MB 打满 PG）
- LOCAL_TOKEN 可选鉴权核查已实现 ✓

### P1 AI 贯通与限流
- **P1-1 搜索工具化**：assistantAgent 新增 `searchNewsFull`（新闻全文搜索，问政策/事件先调它）
- **P1-4 限流**：StockPickList AI 研判限并发 2 + 批间隔 1.2s（防 10 只全并发打爆 30/min 配额桶降级成规则版）
- **V1-S4 止损方向**：stageStopLoss 高潮期 8%→5%（收紧保护浮盈），启动期 5%→7%（放宽给波动空间）—— 原"高潮>启动"为反向设计

### 遵循 CLAUDE.md
- 三重验证门：tsc 0 error / build 成功 / test 144 全绿
- 跨文件一致性：secids/contentKey/stageStopLoss 等改动均 grep 关联调用方确认同步
- 单测 144 全绿

---

## v9.63 — GLM5.2-V9 全部落地（数据可靠性四件套 · 全栈工程卫生清扫）(2026-08-06)

> V9 报告 12 条修改指令 100% 执行（v9.60→v9.63 四里程碑），单测 122→144 全绿，tsc 0 错误。

### v9.60：数据可靠性三件套（V9-D1/D2/D3）
- **D1 关键字段缺失检测**：`api.ts` 抽 `hasMissingKeyFields` 纯函数，`fetchMarketMainFund`/`fetchBoardFundFlow` 缺失检测从"仅 f62"扩展为全部资金/涨跌幅字段；`fetchBoardConstituents`/`fetchStockOne` 补上缺失标注；`foldBoardFunds` 折叠聚合透传 `dataMissing`（任一成员缺失不掩盖）；`MainlineGroup.dataMissing` 四条资金匹配路径透传；BattlePlan/MainlineRanking/StockWatchlist/DarkPool UI 显示"⚠数据缺失"（琥珀色）而非误导 0
- **D2 Math.max 防空**：抽 `safeMax` 纯函数（空数组返回 0 而非 -Infinity），stockToMainline 5 处统一防空（红线 #6）
- **D3 时区统一**：`format.ts` 新增 `getBJDate/getBJWeekday/getBJDateStr`；16 处 `getDay()` 判周末/回看日期统一按北京时间（LadderPulse/LimitBoard/Playbook/WeeklyCoach/api/factorHistory/fundStreak/themeCalendar/tradeCalendar/decisionAttribution/sentimentStore）
- **D3+ 修复 v9.55 引入的时段 bug**：原 `getBJTime` 公式 `getTime()+getTimezoneOffset()*60000+8h` 在 CST 机器上 `bjMs==getTime()`，v9.55 改读 `getUTCHours()` 后返回 UTC 字段（北京 22 点判成 14 点"盘中"）→ 改用 `getBJDate`；`tradeCalendar.bjDateStr` 同样修复（北京凌晨跨天取错日期）

### v9.61：死代码 + 仓库卫生（V9-S1/S2/S3/S4）
- **S1 死代码**：删除 mainline.ts 的 `buildMainlineCandidates`/`determineLeaders`/`computeMainlineScore`（实际走 stockToMainline + themeLadder）；删除 extremeBoard.ts 整文件（零引用含测试）
- **S2 仓库瘦身**：022_ 子目录 13 个杂项文件（GLM 报告/方案 md/图片）`git rm --cached` + .gitignore 规则（磁盘保留，交接文档/CLAUDE.md/代码双轨不动）
- **S3 debug 收敛**：cloudStore/dataStore/boardMap 6 处非 debug console.log 收敛到 `?debug=1` 开关
- **S4 已排空**：`https-proxy-agent@^9.1.0` 已在 server/package.json（V9 报告漏看）

### v9.62：阈值集中 + 指标统一（V9-L1/L2）
- **L1 thresholds.ts**：新建 `src/lib/thresholds.ts` 集中 32 个跨模块概念阈值（炸板率/情绪/涨停/跌停/换手/异动/大盘/强度分档），接入 sysRiskGuard/marketStateMachine/factorLib/mainline/sentimentStore/signalBacktest/anomalyTier/App.tsx 共 8 文件——同一概念统一口径（如"炸板率高"统一 35%、"情绪极值"统一 70/30）
- **L2 指标统一**：核查结论——核心指标已是"App.tsx 算一次、下游只消费"（overview.limitPool/overview.sentiment 单点来源），v9.55 后无重复计算；LimitBoard 是独立数据源（复盘页自拉涨停池）非重复

### v9.63：排版收尾（V9-P1/P2/D4/S3再扫）
- **P1 指标去重**：核查结论——v9.48 已做一轮去重（EmotionCycleCard 移除），Dashboard 内"见顶部状态栏"标注，无同屏重复
- **P2 AIConsole 响应式**：面板加 `max-w-[calc(100vw-2rem)]`（手机不占满屏）
- **D4 TODO 标注**：FundStructure 两融"TODO 待接入"→ 显式"该指标开发中"；MarketOverview 已有"暂不可用"标注
- **S3 再扫**：全部 console.log 已在 debug 保护内

---

## v9.59-fix — V8 深度复盘补做（对照验收标准，补齐 7 处"做了但没做透"）(2026-08-06)

> 上轮 V8 全部落地后，逐条对照验收标准复查数据流，发现并补齐以下遗漏（单测 121→122 全绿）：

| 复盘发现 | 严重度 | 补做 |
|---|---|---|
| **V8-1 server 端仍用情绪代理标签**：`server/lib/factorIc.js` 的 win 判定还是 `次日情绪≥今日` —— 前端改了对、cron 落库的 factor_ic 快照没改，面板快照模式仍显示旧标签 IC | 🔴 严重 | server 同步"次日涨停维持 ≥80%"判据 |
| **V8-2 seal_decay 数据源缺失被误判"失效"**：computeFactorIC 把 extract 全 null 当样本<5 → 永远 decayed（假惩罚 + 假"失效"） | 🔴 严重 | 新增 `missing` 标记：数据缺失 ≠ 失效；前端面板灰点"数据缺失"、不拉低健康分；server 端同步 |
| **V8-3 factorStats 没传 samples**：Dashboard/aiAgent/DecisionVerdictCard 三处的 factorStats 类型与组装都缺 samples → decisionBus"样本<30 不扣置信"从未触发 | 🟠 | 三处补 samples（交易日数/滚动窗口） |
| **V8-6 只修了 LLM 路径**：stockToMainline 另一条概念聚类路径（381 行）仍无 hybk 兜底 + fundMissing | 🟠 | 同构补上 |
| **V8-6 MainlineRanking 也显示假 0**：资金主线页的资金列无 fundMissing 处理 | 🟠 | "⚠未匹配"（灰）替代假 0 |
| **V8-7 验收样例不成立**：AI应用 词根表缺"计算机/软件/互联网" → LLM 主线"AI应用"匹配不到"计算机"行业资金 | 🟠 | 词根补充 + 测试锁定 |
| **V8-9 pruneStockAI 未接入**：结论 store 无过期清理 | 🟡 | decideForStock 写入前 prune（24h） |

---

## v9.59 — GLM5.2-V8 全部落地（因子真数据 · 个股AI变强 · 作战卡资金不骗人 · AI贯通全站）(2026-08-06)

> V8 报告 10 条超详细指令 100% 执行（v9.56→v9.59 四里程碑一次完成），单测 117→121 全绿。

### v9.56：作战卡资金真实化（V8-6/2）
- **V8-6** 资金匹配链：折叠/LLM/模糊失败后 → **hybk 兜底**（组内涨停股行业聚合资金）；仍失败 → `fundMissing` 标记；BattlePlan 显示"资金 ⚠数据未匹配"（灰）而非假 0
- **V8-2** market_daily 补字段：`premiumAvg`（昨日涨停股今日平均涨幅）+ `promotionRate`（昨日首板今日晋级率）由 server 收盘落库；`sealDecayCount` 改真实（无 seal 预警源 → null，不再用炸板冒充）；`fundInflowStreak` 存**连续流入天数**（读 fund_streak 历史）

### v9.57：因子可信 + 个股 AI 变强（V8-1/3/4）
- **V8-1** IC 标签弃情绪代理 → **"次日涨停维持 ≥80%"** 判主线延续（markNextWin + loadFactorRows 读次日 market_daily + nextZtCount/nextHeight）
- **V8-3** 因子样本 <30 天 → FactorHealthPanel 顶部红字降级 + decisionBus **penalty 归零**（不因不靠谱 IC 扣置信）
- **V8-4** decideForStock 升**精简 ReAct**（≤3 轮自主调工具）：新增个股工具集 getStockFund（真实资金面）/detectStockTrap（诱多）/checkStockExitSignal（离场），个股 AI 与主线 AI 同深度

### v9.58：AI 贯通全站（V8-8/9/10）
- **V8-8 全局 AI 助手**：`AIConsole.tsx` 右下角悬浮对话窗（所有 Tab 可见）+ `runAssistantAgent` 全站 ReAct（getAgentTools 全套 + getStockFundDetail），问"主线能不能上车/买谁/资金多少"→ 自动调工具 + 带数字连贯答复 + 工具轨迹
- **V8-9** `aiConclusionStore`：decideForStock 结论写入全局 store → 个股雷达旁标"AI:可买/谨慎/回避"（一处结论处处可见）
- **V8-10** 降级显式标注：AIConsole/裁决卡/标的清单统一"⏸ 本次为规则结果（AI 配额受限）"

### v9.59：收尾（V8-5/7）
- **V8-5** 主线 AI 裁决 reason 硬约束"引用 ≥2 个具体数字，禁止'资金较强'空话"
- **V8-7** `mainlineToBoardNames` 反向映射 + stockToMainline 折叠 key 归一化匹配（LLM 名"人工智能"→折叠"AI应用"→命中板块资金）

### 部署说明：server/cron.js 已更新（market_daily 补字段），pm2 重启后 15:40 起新字段落库

---

## v9.55-fix — V7 复盘补做（详细复盘验收标准，补齐 6 处未做透项）(2026-08-06)

> 上轮按指令做了 21 条，本轮逐条对照**验收标准**复盘，发现并补齐 6 处"做了但没做透"：

| 复盘发现 | 严重度 | 补做 |
|---|---|---|
| **V7-2 AI 研判传参全 0**：`decideForStock` 收到 pct/sealFund/amount/blastCount 全是 0 —— AI 看不到封单/成交/炸板，研判形同虚设 | 🔴 严重 | StockPickList 从 rawPool 取真实原始字段（zdp/fund/amount/zbc）喂给 AI |
| **V7-15 节假日仍空刷**：App 自动刷新 `s.refreshIntervalMs \|\| 60000` 把休市 0 退化成 60s —— 节假日照刷 | 🔴 严重 | 改为 0=停刷（nextAt 置 0，timer 跳过）；TopNav 显示休市 label（已有） |
| **V7-19 Dashboard.loadFactorRows** 仍用本机 getDay() | 🟠 | 改北京时间交易日历（isTradingDay + bjDateStr） |
| **V7-1 候选主线涨停池匹配漏**：主线名是概念大类（AI应用）而 hybk 是细分行业名，子串匹配不上 → 清单不显示 | 🟠 | 匹配加 conceptGroupOf(hybk) 折叠大类 |
| **V7-17 剩余 3 文件空 catch**（alertBus/signalLedger/IntelligenceDrawer） | 🟡 | 补 console.warn；全仓 catch{} 清零 |
| **V7-18 Playbook 公告 items 无数组保护**（存储损坏会 .filter 崩） | 🟡 | Array.isArray 兜底 + try/catch |

**已达标复核**：V7-8 市场级"数据缺失"标注已接（FundStructure 顶部）；V7-9 单位注释已有；V7-14 采用报告选项①"显式标注示意曲线"；V7-6 歧义检测接口已提供（P2 可选，未来按需接 LLM）。
单测 116/116 全绿；TSC clean。

---

## v9.55 — GLM5.2-V7 全部落地（AI 逐标的研判 + 资金可信 + 数据诚实 + 工程健壮性）(2026-08-06)

> V7 报告 21 条修改指令至此全部完成（v9.52 已做标的引擎+清单；本版收口 v9.53-55）。

### v9.53：AI 研判下探个股 + 资金可信（V7-2/8/9/10/11）
- **V7-2/10** `decideForStock`：AI 对首选/接力标的逐只研判（可买/谨慎/回避 + 一句话 + 关键观察点 + 风险点）；StockPickList 每只显示 🤖 AI 研判
- **V7-8** 资金字段缺失标注：fetchMarketMainFund/fetchBoardFundFlow 加 `dataMissing`（东财改字段不再静默 0）；FundStructure 顶部显式"⚠ 部分资金字段缺失"
- **V7-9** 单位口径注释统一（f62 元 / f60 万元）
- **V7-11** AI 配额受限 → 标的清单顶部"⏸ 本次为规则研判（非 AI 主导）"

### v9.54：数据诚实 + 节假日 + 响应式（V7-6/12/14/15/16）
- **V7-14** 资金主图显式标注"⚠ 示意曲线（非真实分时）"（push2his 持续 ban，避免单点插值误导）
- **V7-15** 新建 `tradeCalendar.ts`（2026 法定休市日历）→ tradingSession 节假日判"休市"停刷 + server cron 非交易日跳过抓取
- **V7-16** IndustryFundFlowChart 已 viewBox+100%（响应式 ✓）
- **V7-12** 主线聚类已接 conceptGroups foldConcepts（✓ 核查确认）
- **V7-6** 轻量歧义检测 `ambiguousConcepts`（命中 2+ 大类返回候选，LLM 兜底预留）

### v9.55：工程健壮性（V7-17~21）
- **V7-17** 报告点名文件（aiSettings/newsMemoStore/recTracker/api.ts）空 catch{} → console.warn
- **V7-18** Dashboard rawZTPool null 保护（外部已加）✓
- **V7-19** signalBacktest 改用北京时间交易日历（getDay 本地时区偏移修复）
- **V7-20** 新建 `storageQuota.ts`：全局用量巡检（启动+每小时，超 4.5MB 自动淘汰 AI 缓存/旧快照，不再静默丢数据）
- **V7-21** 人气榜 CORS —— 核查确认已解决（v9.31 CORS 直连实测可用，proxy 反被 TLS ban，不改）

### 单测 108 → 116 全绿（交易日历 5 + 歧义检测 3）；TSC clean

---

## v9.52 — GLM5.2-V7 第一步：概念归类达标确认 + 标的筛选引擎（"可上车"→"买这只"）(2026-08-06)

### v9.51 确认（V7-4/5/7 已达标，报告与磁盘不同步）
- 核查发现 conceptGroups.ts（V7-4 去单字词根/去重叠/教育独立）与 mainline.ts 资金聚合（V7-7 精确名+白名单）**已是报告目标态**
- 补验收测试锁定：有机硅→化工 / 铜箔→元器件 / 毫米波雷达→智能驾驶（最长词根） / 在线教育→教育 / 多晶硅→新能源 / 卫星通信→通信（新增 10 例）

### v9.52 标的筛选引擎（V7-1/3/13，产品级缺口补上）
- **V7-1 `stockPicker.ts`**：把"主线可上车"翻译成"买这只"
  - 涨停池轻量五维评分（封单30/连板25/换手20/炸板-15/首板-10）
  - 角色分桶：首选=龙一（卡位确认+封单健康，打板策略）/ 接力=二/三板（换手承接）/ 低吸=首板（资金连续流入）
  - 仓位联动 positionSizing（闸门×强度，合计≤30%，保底 5% 参与仓）；止损 5/6/7%
  - trapDetector 排雷剔除 + leaderContend 卡位战提示
- **V7-3 `StockPickList.tsx`**：驾驶舱 BattlePlan 之后展示"今日上车标的清单"（角色徽章/评分/仓位/止损/买入逻辑/风险/已剔除）
- **V7-13 激活 `mainline.potential` 死池**：板块成分股资金增强（fundBoost）喂给引擎
- 补验收测试 4 例（首选输出/诱多剔除/空池/卡位）

### 单测 95 → 108 全绿；TSC clean

---

## v9.50 — GLM5.2-V6 全部落地（v9.48 驾驶舱重构 + v9.49 Tab 重排 + v9.50 工程收尾）(2026-08-06)

> 本轮一次性完成 V6 报告剩余 11 项（此前 v9.47 已做 P0 的 L1/L2/L6 + L3/L7）。**内容不改，纯排版 + 逻辑接线。**

### v9.48：驾驶舱重构（D5/D2/D3/D4/G1）
- **D5 收敛单一布局**：盘中/盘前/盘后三套布局 → 一个主区（左决策证据 / 右风控纪律，全阶段恒定）；相位只做强调点插值（盘前竞价台 / 盘后事件研判）；删除 isTrading/isPost 独立布局
- **D2 去重**：EmotionCycleCard 独立卡移除（情绪/涨停/炸板/溢价/晋级率已在温度条+总览+闸门多处展示）
- **D3 盘中减法**：nextScenarios(明日三剧本)/riskRadarText/ReviewPanel 从盘中右栏移入折叠区 → 新增「📋 盘后预演」按钮（盘中默认收起）
- **D4 核心指标提位**：LimitTempBar 提到决策区下方（主区左栏顶部）
- **G1 去冗余**：LimitTempBar 去掉涨停/跌停/炸板率（StatusBar 已常驻），改为进阶指标（晋级率/溢价/最高板/梯队），涨停数只作行尾小注

### v9.49：Tab 语义重排（R1/R2/N1/F1）
- **R1** 题材梯队 ThemeLadder 移入"资金主线"Tab（主线数据归主线）
- **R2** 涨停盘 LimitBoard 移入"资金主线"Tab 资金结构组
- **R3** "龙虎榜复盘"Tab 只留 DragonTiger（名副其实）
- **N1** 事件三级研判 EventClassifyPanel 从驾驶舱移到"消息面"Tab（消息研判归消息面）
- **F1** "资金主线"Tab 三段分组折叠：强度榜+梯队（首屏）→ 💧资金结构（行业流/明暗盘/涨停盘，默认展开）→ 🌐外围信号（全球/两融/产业链，默认折叠）

### v9.50：工程收尾（L4/L5/G2/G4）
- **L4** LimitBoard 复用 api.ts `fetchLimitPoolSummary`（api 补 rawDTPool；删除自有三套 fetch + ZT_UT + jsonp 重复实现）
- **L5** 人气榜 —— **核查结论：已解决**（v9.31 起 CORS 直连实测可用，proxy 反被 TLS 指纹 ban，报告依据旧版本，不改）
- **G2** StatusBar 并入 TopNav 顶部通栏（合成一个 sticky 头，不再独立占一层；App 删除独立 StatusBar）
- **G4** 复盘按钮配色统一：复盘紫(violet)×5（AI复盘/回测/因子健康/审计/盘后预演）+ 决策红(rose)净值 + 信息灰(slate)账本

### 单测 95/95 全绿；V6 报告 16 项至此全部完成（含 v9.47 的 5 项）

---

## v9.47 — GLM5.2-V6 P0：决策证据接回真实数据（修"规则裁决用残缺证据"的逻辑洞）(2026-08-06)

### V6-L1（严重）：decisionSources 去掉 6 处硬编码中性值
- **诱多 trapFlagged/trapRate**：从异动事件流筛（anomalyTier 已接入 detectTrap）→ 不再恒 false
- **龙虎榜加持 lhbBoost**：读 kv lhb:日期 × 今日涨停池交叉（与 LhbCrossPanel 同口径）
- **资金连续流入 fundStreakInflow**：buildFundStreaks → 主线行业匹配
- **组合风险 riskOverLimit/lossStreak/maxPct**：loadDisciplineState（纪律持仓）+ computePortfolioRisk（与 DisciplinePanel 同口径）→ 不再写死 false/0/70

### V6-L2：sysRisk 真实 hs300Pct
- overview.indices 找 code=000300 的 pct 传入 checkSysRisk → 沪深300≤-2% 系统性杀跌 red 信号恢复触发（此前恒 null 永不触发）

### V6-L6：异动/预警跨相位保留
- AlertFeed + LhbCrossPanel 从盘中右栏提取到"风险信号流"（共用决策区之后）→ 午休/盘后不再消失

### V6-L7：复盘按钮顺序与展开顺序对齐
- 按钮顺序 = AI复盘 → 信号回测 → 因子健康 → 决策审计 → 信号净值 → 信号账本（与渲染顺序一致）

### V6-L3：footer 版本号自动化
- 新建 src/lib/version.ts（APP_VERSION/BUILD_DATE）→ App.tsx footer 引用，去硬编码 v9.41

### 单测 95/95 全绿（无新增 —— 逻辑接线为主）

---

## v9.46 — 决策驱动排版重构（"今日作战卡"靠前 + 信号不埋没）(2026-08-06)

> **纯排版改动**：JSX 渲染顺序调整，不改任何组件内容与数据流

### 根因（用户截图复盘）
- **DecisionVerdictCard**（今日作战卡）只挂在"盘中布局"左栏第 2 位 → 盘后/午休布局**完全没有**裁决卡
- BattlePlan（作战计划）被 FiveQBar/裁决卡/重审/Top摘要压到左栏第 5 位 → "今日作战"不靠前
- 复盘工具（决策审计/净值/因子健康）夹在盘中/盘后布局之间 → 时间逻辑错位（"现在进行"和"复盘"混在一起）

### 新版渲染顺序（决策驱动原则：驾驶舱 → 裁决 → 风险/异动信号 → 数据详情 → 复盘工具）
1. **共用顶部决策区**（v9.46 新增，无条件渲染）── FiveQBar + DecisionVerdictCard + Agent 重审按钮 + Top-2/3 摘要
   - **任何阶段（盘前/盘中/盘后/午休/周末）都置顶可见** ── 解决"盘后看不到裁决卡"
2. 盘中布局左栏 ── 删掉已提取到顶部的 4 项，**BattlePlan 顶到第 1 位**（作战计划紧跟裁决卡）
3. 盘中布局右栏 ── 不变
4. 盘前/竞价布局 ── 不变
5. **盘后/午休布局**提前 ── 紧跟盘前/盘中布局（不再被复盘工具截断）
6. **复盘工具**移至全 Dashboard **末尾** ── "现在进行"在前，"复盘"在后；按钮区保留全天可见+持久化

### 单测 95/95 全绿（无新增测试 ── 纯排版）

---

## v9.45 — GLM5.2-V5：运维可靠性 + 可观测性 + 决策器命中率（"别掉链子"+"凭什么信它"）(2026-08-06)

### V5-1（P0）：AI 调用分级限速 + 降级显式化 —— AI 不再静默退回规则
- `server/routes/ai.js`：单一 60/min 桶 → **三桶分级**（Agent 决策 30/min 最高优先 / 分析类 20/min / 解释类 10/min，互不抢占）
  - Agent 桶不再被页面并发 10+ 任务打爆 → 高峰期"AI 主导"不名存实亡
  - 429 响应带 `rateLimited:true + bucket`（显式标识）
- `ai.ts callAgentChat`：429 时返回 `rateLimited` 标识（不再静默 null → 误判"服务端不可用"）
- `aiAgent.ts`：配额受限 → 显式 `rateLimited` 降级（reason="AI 配额受限，规则投票兜底"）
- `DecisionVerdictCard`：**配额受限横幅**"⏸ AI 配额受限，本次为规则兜底，非 AI 主导"+ 标题改"🧠 规则决策（AI 配额受限）"——用户一眼看出这次不是 AI
- `Dashboard`：自动触发只跑 **Top-1**（最强主线，单周期 ~18→~6 次调用）；手动按钮才覆盖 Top-3

### V5-2（P1）：Agent 路径埋点 —— 验证 flash 真在用原生 tool_calls
- `aiAgent.ts`：AgentVerdict 新增 `path(native_toolcall|manual_json|rule_fallback)/rounds/toolsCalled`（首个成功协议 + 轮数 + 去重工具清单）
- `DecisionVerdictCard`：AI 行加协议徽标（⚙ 原生 tool_calls / 🧩 JSON 协议）+ 轮数/工具数；落库 decision_log 带埋点
- `DecisionAuditPanel`：**Agent 路径占比条**（近 N 日 原生/JSON/规则 比例，原生 <50% 时警示"flash 可能需换调用约定"）

### V5-3（P1）：决策器命中率回测闭环 —— "凭什么信 AI"的终极证据
- 新建 `src/lib/decisionAttribution.ts`：读 decision_log（AI/规则"可上车"裁决）→ 与次日情绪延续对账（口径与 factorLib 一致）
  - `nextTradingDay`（跳周末）/ `loadDecisionLogs` / `computeDecisionHitrate`（AI vs 规则胜率）
- `DecisionAuditPanel`：**可上车命中率对比条**（近 30 日 AI X% vs 规则 Y%，AI 不优于规则时标"⚠ 建议人工复核"）
- 注：第一版用宏观情绪延续代理"主线涨跌"；主线级对账待 zt_snapshot 全量接口

### V5-4（P2）：https-proxy-agent 依赖 —— 核查确认已声明（^9.1.0，两处一致 + node_modules 已装），无需改动

### V5-5（P2）：022_ 旧版入仓 —— **有冲突不执行**（commit 866afe4 是用户明确要求的"补全历史欠账"，
非意外倒退；如需隔离到 archive 分支待用户确认）

### 单测 91 → 95 全绿（新增 4 例 decisionAttribution：交易日推算/非法日期/本地读取容错）

---

## v9.44 — 复盘三件套：决策审计时间线 + 信号净值曲线 + 因子自动处置 (2026-08-06)

### ② 决策过程审计面板（DecisionAuditPanel）
- 读 localStorage decision_log:日期（DecisionVerdictCard 每次裁决落库，cloudStore 5 分钟同步 PG）
- 时间线回放：时间/主线/动作/置信/来源（AI/规则）/门控降档/Critic/分歧，支持今日/近3天/近7天切换
- 顶部统计：决策总数、AI 主导数、禁止数、门控降档数 —— 复盘"AI 为什么这么判"可追责

### ④ 信号净值曲线（SignalEquityPanel）
- 读 signalLedger 已回填信号 → T+1/T+5 等权复利净值曲线（SVG 手绘，红涨绿跌）
- 统计：已回填笔数、胜率、累计收益、平均单笔、最大回撤；T1/T5 视图切换
- signalLedger 新增纯函数 buildEquitySeries/computeEquityStats（可单测）

### ③ 因子自动处置（方向反转自动反向 + 长期失效自动退役）
- factorLib 新增 resolveAutoStates：连续反转≥3日 → 自动反向（expectedDir 取反、IC 按新方向显示）；
  连续真失效≥5日（样本≥5 且 |IC|<0.05）→ 自动退役（不参与决策）；样本不足不累计（新因子积累期保护）
- FactorHealthPanel 五态徽标：退役(灰) > 已反向(青) > 失效(红) > 反转(琥珀) > 健康(绿)，汇总条显示自动处置计数
- agentTools.evaluateFactorHealth 输出 flippedFactors/retiredFactors → AI 调研摘要自动带"已自动反向/已退役"（v9.43 闭环延续）

### Dashboard
- 盘后按钮区新增「📜 决策审计」「💰 信号净值」（与信号回测/因子健康度并列）

### 单测 83 → 91 全绿（新增 8 例：自动处置 4 + 净值曲线 4）

---

## v9.43 — AI 闭环：因子健康度喂给 Agent（幻方"因子失效"成为 AI 决策依据）(2026-08-06)

### 三层闭环（AI 看得见 + 跑不掉门控）
- **① 预注入层**：runDecisionAgent 开头自动 evaluateFactorHealth → 把"x/y 因子失效、占比、置信扣分规则"注入第一轮 user 消息 → LLM 决策前必然看到（不依赖 LLM 自觉）
- **② 工具层**：agentTools 新增 `factorHealth`（data 类）—— LLM 可主动深查全部因子近10日滚动 IC 明细（失效/反转清单）
- **③ 强制门控层**：finalize 统一出口按 decisionBus 同规则强制扣置信（失效占比≥50%→-15、≥30%→-8；"可上车"置信不超 60），并写入 evidence"🧪 因子健康度门控：…" → AI 无论说什么，失效因子都会拉低置信
- **降级路径**：规则兜底 runConsensus 补传 factorStats（此前缺失，现在降级也扣分）

### 展示
- DecisionVerdictCard：AI 理由自动带"（因子健康度 x/y 失效，置信-x）"+ 新增"🧪 因子门控已计入"徽标（检测到 reason 含因子健康度时显示）

### 基础设施
- agentTools 新增 `evaluateFactorHealth()`：优先读 PG 快照 factor_ic:日期（server cron 落库），无快照降级前端现算（market_daily+sentiment）
- factorHistory IcHistoryPoint 补 reversed 字段
- system 提示词规则 1 修正：detectTrap（不存在的工具）→ factorHealth

### 单测 83/83 全绿（新增 2 例：factorHealth 工具注册 + evaluateFactorHealth 结构/penalty 规则）

---

## v9.42 — 因子 IC/健康度可视化：幻方"哪些因子在失效"曲线闭环 (2026-08-06)

### 数据权威化：server cron 自动落库 factor_ic（不再依赖开页面）
- 新增 `server/lib/factorIc.js`：因子评估服务端版（与 factorLib.ts 同构，11 因子）
  - 读最近 30 交易日 kv（market_daily + sentiment）→ 组装日行 → 次日延续标签
  - 每因子取最近 10 个有效样本交易日算滚动窗口 IC（Spearman，按期望方向对齐）
- cron 15:40 收盘落库 + 启动即补 → `kv_store:factor_ic:YYYY-MM-DD`（PG 权威，永不缺数据）

### 因子失效曲线（FactorHealthPanel）
- 新增 `src/components/FactorHealthPanel.tsx`：SVG 手绘滚动 IC 曲线（无图表库）
  - 每因子一行：名称 + 三态徽标（健康 emerald / ⚠失效 rose / ↻反转 amber）+ 样本数 + 曲线
  - 曲线叠加 ±0.05 失效阈值带（灰带）+ 0 线 + 失效/反转点高亮 + 当前点大圆 + 当前 IC 标签
  - 汇总条：失效因子数/总数、方向反转数、平均 |IC|、健康分、门控影响提示（≥50%→-15% / ≥30%→-8%）
- 降级逻辑：历史快照 <2 天时用 market_daily+sentiment 前端实时计算，cron 落库后自动切换
- Dashboard 盘后布局新增「📉 因子健康度」按钮（与信号回测并列）

### 引擎增强
- factorLib 新增 `computeFactorIcSeries` / `evaluateFactorIcSeries`：滚动窗口 IC 序列（此前 ic20d 为单批近似）
- **三态判定（业务盲区修复）**：持续负 IC 不再是"失效"而是"方向反转"（reversed）——
  有预测力但方向反了，需人工复核/反向使用，暂不自动改向；前端/服务端逻辑同构
- factorHistory.ts：数据加载层（loadFactorRows / loadFactorIcHistory，兼容新旧快照格式）

### 单测 81/81 全绿（新增 4 例滚动 IC 序列：正相关/负相关反转/样本不足/全因子覆盖）

---

## v9.41 — V4 里程碑：真·tool_calls Agent + 高置信自洽 + Top-3 主线覆盖 (2026-08-06)

### V4-A：真·ReAct 多轮循环（AI 从"复读机"变"真智能体"）
- server ai.js /api/ai/call 支持 tools/tool_choice 透传（OpenAI 兼容 {type:function,function:{...}} 包装层）
- 实测：Agnes 原生接受 tools，且**自主返回 `{"calls":[{"tool":"checkSysRisk"},{"tool":"getAdmissionVerdict"}]}`** —— LLM 自己决定先查系统性风险再查准入
- aiAgent runDecisionAgent 重写为 ≤5 轮 ReAct 循环：
  - 第 1 轮 LLM 自主选 1-3 个关键工具 → 执行 → 结果回灌 → 观察后再选 → 循环
  - 任一强否决工具（checkSysRisk/detectTrap/detectSealDecay/computePortfolioRisk 出禁止）→ 早停直接"禁止"
  - 轮次耗尽/LLM 不可用 → 回退 v9.40 全跑工具 + 规则投票兜底
- 兼容双协议：原生 toolCalls（Agnes 支持时）+ JSON calls/final（手动格式）

### V4-D：Critic + 自洽投票
- finalize 统一出口：final 后 自洽投票（可选，换温度 0.4/0.7 复核取多数）→ Critic 挑刺（默认开）

### V4-E：Top-3 主线覆盖
- Dashboard runAgent 循环 candidates.slice(0,3) 各出裁决（共享 5 分钟节流）
- 裁决卡展示 Top1 完整 + Top-2/3 一行摘要（行动/置信/理由）

### 单测 77 例全绿（ReAct 降级路径已被现有测试覆盖）

---

## v9.40 — GLM5.2-V4 落地：AI 真独立推理 + 门控约束最终结论 + 分歧不静默 (2026-08-06)

### 审核 GLM5.2建议-v4.txt（基于 v9.39 实证核查）
- 核心发现：AI 是"规则打包器+LLM摘要器"（喂规则结论非原始盘面）→ 只能复述规则；
  幻方门控只作用于规则投票路，被 AI 覆盖绕过 → "越用越准"闭环没到出结论的路上
- V4-H 验证为误报（https-proxy-agent@^9.1.0 已在 server/package.json，V1 已修）

### V4-A：AI 真独立推理（喂原始盘面，可推翻规则）
- aiAgent 工具分两类：vote（8 个决策工具归一为证据投票）/ data（4 个数据工具：backtestSignal/getFundStreak/getThemeCalendar/getNewsDeep 原始结果）
- adjudicateOnce 喂"规则投票 + 原始盘面数据"两段，prompt 明确"可据此推翻规则结论"——AI 有独立信息源

### V4-B：幻方门控真正约束最终结论（修"绕过"）
- DecisionVerdictCard 融合裁决：因子失效占比≥50% 时 AI 说"可上车"强制降"观望"+标注"🧪因子失效门控降档"；
  规则硬否决（禁止）优先于 AI 乐观可上车；置信随门控下调

### V4-C：AI-规则分歧显式告警（不静默覆盖）
- aiRuleDivergent 检测 → 顶部红横幅"⚠ AI 与规则多源分歧：AI=X/规则=Y，建议人工复核"

### V4-D：默认开 Critic
- Dashboard runAgent 传 { useCritic: true, selfConsistency: false }——AI 结论必经挑刺

### V4-F：工具统一 schema
- AgentTool 加 kind(vote/data) + normalize(raw→{verdict,confidence,reason})，9 工具各自归一（level:red→禁止 等）
- 消除 collectToolEvidence 的 ?? 链 + 乘 100 脆弱映射

### V4-G：补齐 4 个因子输入字段
- cron fetchMarketDaily 补 sealDecayCount(炸板数代理)/lhbBoostCount(龙虎榜净买数)/fundInflowStreak/fetchNuclearCount(昨≥2板今跌≤-9%)
- 前端 loadFactorRows 一并读取 → factorLib 4 因子不再恒 decayed

### V4-I：样本不足显式提示
- factorStats.total<3 或门控命中时标"⚠ 历史样本不足，AI 结论仅参考"

### 单测 77 例全绿（+5：统一schema 3 + 融合裁决 2）

---

## v9.39 — AI 自动主导 + 幻方闭环接通（深度复盘后的 3 项改造） (2026-08-06)

### 背景
用户深度复盘指出：GLM5.2-V3 的 17 项功能代码全部落地，但"AI 主导 + 幻方方法"效果只有约 20%：
- 断层1：AI 是手动按钮（不点不跑），终裁决卡 0 行 AI 代码（纯规则投票）
- 断层2：幻方闭环断开——factorLib IC 算了没接入决策；V3-5 回测门控空转（collectEvidence 没传 signalGates）
- 断层3：样本量 9 天撑不起"越用越准"

### 改造1：AI 自动主导
- Dashboard: battlePlan 更新后自动触发 decideForMainline（1.5s 延迟等证据就绪 + 5 分钟节流省配额）
- DecisionVerdictCard 反转：Agent 裁决（LLM 工具调研）置顶大号为主结论（琥珀色高亮"AI 决策（自动主导）"），
  规则投票折叠为"📊 规则多源投票（点击展开）"佐证区——不再是并列卡片
- 旧 Agent 结果小框删除；按钮改"⚡ 立即重审"（手动即时刷新）
- 决策日志升级：记录来源（AI-Agent/规则投票）+ Agent 理由 + Critic 意见

### 改造2：幻方闭环接通
- decisionBus.runConsensus 新增 factorStats 支持：因子失效占比≥50% 置信-15 / ≥30% 置信-8（幻方"因子过期自动降权"真正影响决策）
- Dashboard 异步加载：① backtestSignals(14) → signalGates → 激活 V3-5 回测门控（此前空转！）
  ② factorLib evaluateAllFactors → factorStats → 决策降权 + 落库 factor_ic:日期（改造3）
- 终裁决卡显示"🧪 N/M 因子失效"红标（悬停解释）

### 改造3：数据积累加速
- factor_ic:日期 前端算完落库（跨会话可读）
- market_intraday 盘中快照已存在（v9.38 V3-11，每20分钟）——样本从每日1条→每日多条

### 单测 72 例全绿（+3：因子健康度降置信/不降/门控激活）

---

## v9.38.2 — 修复 EventClassifyPanel 挂错位置 (2026-08-06)

### 用户反馈
"v9.38.1 的事件三级研判卡看不到"——Dashboard 截图是盘后布局，但组件挂在了**盘中布局分支**（`isTrading`），所以盘后模式下整块不渲染。

### 修复
- Dashboard.tsx 移除盘中分支的挂载
- 移到盘后布局 grid 之后（独立全宽行，3 列分栏不被 1fr/340 列挤压）
- 数据由 cron 15:40 落库 `event_classify:日期`，盘后/午休布局可见

---

## v9.38.1 — GLM5.2-V3 补全：事件分级闭环 + getNewsDeep + httpProxy 重构 (2026-08-06)

### 背景
用户确认后补全 V3 报告真实遗漏 2 项 + 部分完成 1 项（V3-P0 重构部分）。

### V3-12 事件三级分类闭环（此前只有 task 定义，无 cron 落库）
- cron.js 新增 `runEventClassify({pool})`：读当日快讯（stars 优先）→ 前缀去重 → LLM 三级分级
  （政策/行业/事件 + beneficiaries + catalystScore + timeSensitivity）→ 落库 `kv event_classify:日期`
- 容错：LLM JSON 常被 max_tokens 截断 → `parseLoose` 截到最后一个完整对象补 `]`；LLM 失败走规则版关键词分级
- 批量 15 事件（30 会超 token）；maxTokens 1500 → 3000
- 15:40 盘后任务接入 + 导出
- 前端：`EventClassifyPanel.tsx` 三级分栏（政策/行业/事件 × 催化分徽章 × 受益板块），挂 Dashboard 盘后区
- 接入决策总线：`decisionCollector` 新增"消息对账"证据源——`newsReconcile` 兑现=可上车 / 背离=禁止（V3-13 咬合）/
  policyEventCount≥2 = 可上车；Dashboard 异步读政策级事件数注入

### V3-14 getNewsDeep（此前完全缺失）
- `agentTools` 注册 `getNewsDeep` 工具：catalystScore<60 直接返回"成本控制不深挖"（不调 LLM）；
  高分/政策级事件 → `callAI("eventDeepDive")` 推演影响传导链/受益标的/风险/验证信号
- 新增 `eventDeepDive` task（aiPrompts 5 处 + server 白名单），LLM 不可用走规则版浅挖

### V3-P0 httpProxy 重构（此前只有依赖、未消重）
- 新建 `server/lib/httpProxy.js`：https-proxy-agent **惰性 require + 容错**（未装降级直连，
  不再顶层 require 导致干净部署启动即崩）+ 单例代理 + 直连→代理重试 + 非 2xx 不重试
- `ai.js`/`cron.js` 删除各自重复的 postJSON/callLLM，改调公共 `postJSON` / `callModelText`
- 单测 69 例全绿（+4：getNewsDeep 低分不深挖/高分深挖、消息对账背离→禁止、政策事件→可上车）

---

## v9.38 — V3 剩余项补全：Agent 深审 + 因子IC + 资金对账 + 事件分级（2026-08-06）

按 V3 修改指令表补全上一轮未做项：

### V3-8/9：因子注册表 + IC 评估 + 衰减监测
- 新建 `factorLib.ts`：注册 11 个标准因子（炸板率高/低/涨停数/高度/溢价/晋级率/情绪极值/封单衰减/席位加持/资金连续性/核按钮）
- 每因子对"次日主线延续"计算 Spearman 秩相关 IC；滚动样本 |IC|<0.05 或样本<5 → 标"⚠ 疑似失效"并自动降权 0.3（幻方"因子会过期"核心）

### V3-13：资金-消息对账引擎
- 新建 `fundNewsReconcile.ts`：消息利好(score≥60) × 资金流对账
  - 利好+连续流入 → "兑现"可上车；利好+流出 → "资金背离"观望/禁止（政策未兑现/诱多）；中性+流入 → 待观察

### V3-1/2/3/6：Agent 工具注册表 + 主循环 + Critic
- 新建 `agentTools.ts`：12 个工具包装现有纯函数（准入闸/市场状态/仓位/离场/组合风险/系统风险/回测/资金对账/资金连续性/题材日历/封单/决策证据），execute 均不触发额外 LLM
- 新建 `aiAgent.ts`：轻量 ReAct——① 规则工具收集证据（0 次 LLM）→ ② Agnes 读证据裁决 → ③ Critic 挑刺（有效反对则降置信/改判）→ ④ 自洽投票开关（temperature 0.1/0.4/0.7 三票多数，默认关省配额）；LLM 不可用降级 rule decisionBus
- Dashboard：终裁决卡下新增"🤖 Agent 深审"按钮（手动触发，显示 action/置信/理由/Critic意见/证据链）

### V3-12/14：事件三级分类
- aiPrompts 新增 task `eventClassify`（政策/行业/事件三级 + beneficiaries + catalystScore + timeSensitivity）+ FALLBACKS 规则版 + ai.js 白名单

### V3-11：加速回测样本积累
- cron 新增 `fetchMarketIntraday`：20min 任务内每小时落 `market_intraday:日期`（盘中快照）

### 单测：65 例全绿（+12：factorLib 5 + fundNewsReconcile 5 + agentTools 3 - 修正 1）
- V3-8 IC 计算 / V3-13 对账五场景 / V3-1 工具注册表 12+ 唯一性

### 教训
- agentTools 泛型 execute 参数类型需宽松（any）避免 unknown 不兼容
- factorLib 测试 rows 需补全所有因子输入字段（缺失→extract null→样本0）

---

## v9.37 — GLM5.2-V3 审查落地：决策总线 + 终裁决卡 + 死代码消除（2026-08-06）

审核 GLM5.2建议-v3.txt（基于 dddc288 全栈审查）：
- **P0-A（https-proxy-agent 幽灵依赖）验证为误报**——依赖已在 server/package.json（V1 已修），无需处理
- **P1-B（classifyStage 死代码）确认属实**——已接线（见下）
- **P1-C（缺统一决策总线）确认属实**——本版核心（见下）

### V3-P1：classifyStage 死代码消除
- classifyStage（市场级阶段：涨停环比/炸板/晋级率/高度/资金综合判定）原只定义未调用
- 接入 FiveQBar：市场阶段徽标改用 classifyStage 计算（marketStageLabel），取代 marketStyle.label 展示

### V3-4/5/7：统一决策总线 + 回测门控 + AI 终裁决卡（替代决策核心）
- 新建 `decisionBus.ts`：多源共识层
  - ① 硬否决：系统性风险/诱多引擎/组合风险 任一"禁止"→ 直接禁止（一票否决）
  - ② 回测门控 gateWeight：信号样本<6 或胜率<45% → 降权 0.3（只信历史有效因子）
  - ③ 加权投票：置信度×权重求和定结论；④ 分歧告警：各源分裂且置信<60% → 观望+反对意见
- 新建 `decisionCollector.ts`：各引擎输出（准入闸/系统风险/组合风险/市场状态/诱多/封单/龙虎榜/资金连续性）→ 统一 EvidenceSource
- 新建 `DecisionVerdictCard.tsx`：驾驶舱五问条下方"🧠 AI 终裁决"卡
  - 一屏看清：结论（参考关注/观望/禁止）+ 置信度 + 各源投票明细 + 反对意见 + 回测门控提示 + 证据链（可展开）
  - V3-P2 决策日志：每次裁决落 localStorage `decision_log:日期`（可审计/可复盘）
- Dashboard 接入：sealAlerts 从 App 传入 → 汇聚 6 源 → 终裁决卡

### V3-10：组合相关性风险（portfolioRisk 扩展）
- concentrationPct（同主线持仓占比）：>60% → 折扣 0.8；>80% → 折扣 0.6
- 解决游资"看起来 5 只票其实全押同一主线"的死法

### 单测：53 例全绿（+11：decisionBus 8 + portfolioRisk 集中度 2 + 修正 1）
- decisionBus：硬否决/多源一致/分歧标观望/多数票压制/回测门控/门控接入

### 未做（V3-1/2/3 Agent、V3-6 自洽投票、V3-8/9 因子IC、V3-11~14 新闻三级/资金对账）
- 本轮聚焦"替代决策骨架"（总线+门控+终裁决卡）；Agent 化/因子IC/新闻对账建议下一轮

---

## v9.36 — A 级优化 ×3 + B 级工程质量 ×2（2026-08-06）

### A1：组合风险预算（幻方"风险预算层"落地）
- 新建 `portfolioRisk.ts`：总仓位上限 = 基础预算(70%) × 市场状态系数 × 连亏熔断系数
- 连亏3天熔断降0.4、2天降0.75；市场状态系数与 marketStateMachine 对齐（0.2~1.0）
- `DisciplinePanel` 顶部新增"💰组合风险预算"条：当前仓位/预算上限/市场状态/熔断状态/操作建议

### A2：竞价强度榜
- 新建 `AuctionStrengthPanel.tsx`：复用 auction.ts fetchAuctionBoard，展示昨日涨停池竞价涨幅 top12
- 竞价即涨停红框高亮"🔒竞价封板"、低开绿标、连板数徽标、竞价金额
- 挂载竞价布局 AuctionBoard 旁（60s 刷新）

### A3：龙虎榜×涨停池交叉（席位加持）
- cron 新增 `fetchLhbDaily`：东财 `RPT_DAILYBILLBOARD_DETAILSNEW`（实测300只，东山精密净买15.87亿）→ 落 `kv_store:lhb:日期`
- 新建 `LhbCrossPanel.tsx`：今日涨停×龙虎榜交叉（净买额+上榜原因），席位加持=次日溢价增强信号
- 挂载盘后区 LadderMini 旁

### B1：vitest 单测（42 个用例全绿）
- 新增 `npm test`（vitest run）；`src/lib/__tests__/` 下 5 个测试文件
- stageModel 6 用例 / trapDetector 8 / positionSizing 8 / stockExit 5 / 新增引擎（市场状态机+组合风险预算+封单衰减）15
- 教训：3 个用例首跑失败均为"测试断言与实现不一致"（非实现 bug），修正断言后全绿

### B2：App.tsx 拆分（减负）
- 将"昨日溢价/核按钮/晋级率"~60 行从 refreshAll 抽取为纯函数 `lib/prevZtStats.ts`（computePrevZtStats）
- App.tsx 改为一行调用，逻辑零变化；后续可继续按此模式拆分

---

## v9.35 — S3 信号历史回测引擎（幻方"因子验证"落地）（2026-08-06）

承接复盘 S3 计划：解决"30 个信号不知道信哪个"的终极痛点。

### 数据层
- cron 新增 `fetchMarketDaily`：15:40 拉涨停/炸板/跌停三池 → 落 `kv_store:market_daily:日期`（ztCount/zbCount/dtCount/blastedRate/maxBoardHeight）
- 情绪分沿用前端 cloudStore 已同步的 `sentiment:日期`（实测已积累 9 天：73/0/99/96/96/49/97/89/89）

### 回测引擎
- 新建 `signalBacktest.ts`：读近 14 交易日 sentiment + market_daily → 对 7 个核心信号统计
  - 情绪高位≥70 / 情绪冰点≤30 / 情绪连续2日下跌 / 炸板率≥35% / 涨停≥50 / 涨停≤15 / 最高板≥6
  - 每信号输出：触发次数 / 次日正面率 / 次日情绪均变 / 结论（有效≥60% / 存疑45-60% / 样本不足<6）
  - 样本每日自动 +1，≥6 后自动出结论

### 前端展示
- 新建 `SignalEffectivenessPanel.tsx`：信号有效性表格（样本数/正面率/情绪均变/结论徽标）+ 当前可信信号摘要
- Dashboard 盘后区新增"🧪 信号有效性回测"按钮 → 面板

---

## v9.34 — 全面复盘落地 + 幻方方法论 S1/S2（2026-08-06）

基于全面复盘（《游资决策大脑-全面复盘与幻方方法论落地.md》），从游资 ★★★★★ 痛点 + 幻方量化方法论中落地两个高价值模块：

### S1：封单衰减实时监控（游资打板最大雷区）
- 新建 `sealMonitor.ts`：18s 高频通道（v9.29 refreshFast）每轮记录封单快照，与上轮对比变化率
- 封单环比 ≤-50% → 黄色预警（开板前兆）；≤-80% 且 <500万 → 红色"💥 封单崩落"
- 过期快照 120s 窗口防误报；`__resetSealMonitor` 供单测
- App.tsx refreshFast 接入 → alerts 顶栏（red=critical/yellow=warning）
- 解决："龙一开板前 3 秒封单 8 亿掉到 5000 万" 来不及跑的最大痛点

### S2：市场状态机（幻方"状态自适应"思想落地）
- 新建 `marketStateMachine.ts`：情绪/涨停/跌停/炸板/溢价/高度 → 5 态（亢奋普涨/局部主线/分歧震荡/亏钱效应/冰点恐慌）
- 每态输出：置信度 + 证据链 + **仓位系数（0.2~1.0）** + 打法建议
- 幻方中层"策略工厂按市场状态动态调整参数"的游资版翻译：先判"今天是什么市"，再决定仓位与打法
- FiveQBar 新增"🏛️ 市场状态"卡（状态 + 仓位系数 + 打法提示）

### 复盘文档
- 《游资决策大脑-全面复盘与幻方方法论落地.md》：任务目标 vs 成果 / 关键问题战役 / 架构评估 / 经验教训 / 游资痛点清单（15项）/ 幻方三层策略金字塔解密 / S1-S3 行动计划

---

## v9.33 — 剩余8缺口全部闭环（2/3/5/6/8）（2026-08-06）

承接《游资决策大脑-剩余8缺口修改指令.md》，完成最后 5 个缺口。至此 8 缺口全部落地（1/4/7 已在 v9.32.1 完成）。

### 缺口2：盘后自动复盘 + 历史主线回放
- `server/cron.js` 新增 `generateDailyReview`：15:40 后读 zt_snapshot + 强催化公告 + 黑天鹅 → LLM（dailyReviewAuto 专用 system）生成【今日主线回顾/错过与教训/明日关注清单/风险提示】→ 落 `kv_store:review:日期`
- `aiPrompts.ts` 新增 task `dailyReviewAuto`（+ TASK_CONFIG/payload/B构建器/FALLBACKS），`ai.js` TASK_ALLOW 同步
- `ReviewPanel`：自动复盘展示（回退近3日）+ 日期选择器 + "🕘回放当日涨停池"按钮（读 zt_snapshot 重建主线摘要）

### 缺口3：LLM 次日三剧本 + 龙头预判 + 风险雷达
- `aiPrompts.ts` 新增 task `nextDayScenarios` / `leaderPredict` / `riskRadar`（均 thinking=false）
- `App.tsx`：盘后自动调 nextDayScenarios + riskRadar（护栏只触发一次）；竞价段自动调 leaderPredict
- `Dashboard`：盘后区显示三剧本卡 + 风险雷达条（高中低三色）；竞价区显示"🤖 AI 预判龙一"卡

### 缺口5：题材生命周期日历
- 新建 `themeCalendar.ts`：读 7 日 zt_snapshot → 每题材首现日/运行天数/连续天数/最高高度/阶段判定
- `ThemeLadder` 每题材行加"第N天·阶段"徽标 + 运行≥4天加"⚠接近分歧"提示

### 缺口6：资金连续性 + 切换信号
- 新建 `fundStreak.ts`：读 7 日 `kv_store:fund_streak` → 连续流入/流出天数 + 昨日流入今日流出切换标记
- `cron.js` `fetchBoardFundServer`：push2delay 双请求（po=1+po=0 串行）→ 15:40/启动落 `kv_store:fund_streak:日期`（实测 200 行业 100流入/100流出）
- `IndustryFundFlowChart` 行业行加 "🔥N日连续流入" / "⚠切换信号" / "↗进场" 徽标

### 缺口8：大宗交易折价异动
- `cron.js` `fetchBlockTrades`：东财 datacenter `RPT_DATA_BLOCKTRADE`（实测 200 笔，折价>8% 有 124 笔；PREMIUM_RATIO 为小数需×100）→ 落 `kv_store:block_trade:日期`
- `DarkPool` 新增"💼大宗交易折价异动"子卡：折价>8% 红色预警条 + 折价榜 top20（折溢率/成交额/买方营业部）

### 关键工程发现
- push2.eastmoney.com 对 nodejs 直连 TLS ban（socket hang up）；**push2delay.eastmoney.com（延迟15分钟行情）node 直连可用** → cron 落库统一走 push2delay
- 资金流双请求必须串行（并发触发限流）

---

## v9.32.1 — 接手 8 缺口之 3 个：溢价分布/公告聚类/龙头卡位战 (2026-08-06)

> 按《游资决策大脑-剩余8缺口修改指令.md》附录 A 推荐顺序实施。

### 【缺口1】溢价分布 + 核按钮/地天板（价值最高）
- 新建 `src/lib/extremeBoard.ts`：核按钮（昨≥2板今跌≤-9%秒跌停）/ 地天板（触跌停拉涨停）/ 天地板（触涨停跌停）
- `OverviewData` 加 `premiumDist` 4 档分布（<-5% / -5~0 / 0~3 / >3%），App.tsx 在昨日涨停溢价计算处同步统计
- `EmotionCycleCard` 加溢价分布 4 档柱图 + 赚钱/亏钱效应定性（焖面占比≥30% → "⚠ 亏钱效应强"；高溢价≥30% → "🔥 赚钱效应强"）
- `App.tsx` 核按钮检测：昨≥2板今跌≤-9% → setNuclearAlerts → alerts 接入（≥2只 critical 顶栏）

### 【缺口7】公告类型聚类 + 密度预警
- 新建 `src/lib/annCluster.ts`：5 类聚类（业绩/重组/增减持/融资/诉讼监管）+ ANN_CATEGORY_META 配色 + detectAnnDensity
- `AnnouncementPanel` 每条公告加聚类标签（AnnRow 标题旁）

### 【缺口4】龙头卡位战 + 板型
- `stockToMainline.ts` MainlineLeader 加 `boardType`（hs 换手率：<1 一字板 / 1-5 缩量板 / ≥5 换手板），龙一龙二龙三填充
- 新建 `src/lib/leaderContend.ts`：同高度≥2只封单差距<20% → 卡位胶着；BOARD_TYPE_META 板型徽标配色
- `BattlePlan` MainlineBlock：龙名旁板型徽标（一字=难上车/换手=可上车）+ 顶部"⚔️ 卡位战"警告条

---

## v9.32 — 游资视角全栈审查后补 3 项实战缺口 (2026-08-06)

> 基于 10 年+ 游资视角的全栈代码审查，从 11 个缺口中选 3 个最有价值的落地。

### 【5】快速下单直通券商（S 级，秒级执行闭环）
- 痛点：游资"看到信号到下单<10秒"，当前只有看行情链接，点完还要手动切券商输代码
- 修复：
  - `realLinks.ts` 新增 `orderUrl(code, broker)` —— 同花顺 `ths://`、通达信 `tdx://`、东财 `dfcf://` URL Scheme
  - `realLinks.ts` 新增 `exportWatchlist(codes)` —— 自选股一键导出逗号串（可粘贴券商批量下单）
  - `StockDecisionCard.tsx` 新增"快速下单"行：同花顺/通达信/东财三按钮直通

### 【3】系统性风险预警 + 黑天鹅公告（S 级，"先活下来"底线）
- 痛点：系统性杀跌时所有主线分析失效；盘前立案/退市公告会让持仓秒跌停
- 修复：
  - 新建 `src/lib/sysRiskGuard.ts`：沪深300跌幅≤-2% / 跌停≥50 / 炸板率≥50 / 情绪≤15 → red；≤-1% / ≥20 / ≥35 / ≥85 → yellow
  - `App.tsx` alerts 接入：sysRisk red → critical 顶栏，yellow → warning
  - `cron.js` 新增 `BLACK_ANN_RE`（立案/退市/商誉减值/被问询/警示函/行政处罚/预亏/业绩预减/减持/质押/违约/停牌核查/风险提示/司法冻结）→ 20min 任务过滤黑天鹅公告落库 `kv_store:black_swan:YYYY-MM-DD`

### 【8】席位协同检测（S 级，游资多席位联动）
- 痛点：章盟主/赵老哥常多席位协同买入，"同一游资多席位同日同向"比单席位信号强数倍
- 修复：`seatBehavior.ts` analyzeSeatsGroup 新增协同信号：用 `matchSeatTag` 按 label 聚合 buyers，同 label ≥2 个不同席位 → "🔗 游资多席位协同"信号徽标

---

## v9.31 — 人气榜回归真实数据：东财 + 同花顺双榜交叉比对 (2026-08-06)

### 用户反馈
人气榜不能用涨停榜糊弄，必须与东方财富人气榜一致；并新增同花顺人气榜做交叉比对（双榜共振提醒）。

### 关键实测发现（推翻 v9.27 的错误假设）
- **emappdata.eastmoney.com 完全支持 CORS**：OPTIONS 预检 200 + `Access-Control-Allow-Origin` 回显任意 Origin + `Allow-Methods: POST`，且不校验 Referer/Origin → **浏览器直连即可，线上线下均可用**
- v9.27 加 proxy 中转是**错误方向**：emappdata 对 proxy 的 nodejs https.request 做 TLS 指纹层 ban（12s socket hang up），浏览器直连反而畅通
- **dq.10jqka.com.cn（同花顺热度接口）同样支持 CORS**：OPTIONS 204 + `Allow-Methods:*` + Origin 回显，不校验 Referer → 浏览器直连可用

### 修复
- `fetchPopularityRank`（东财）：**去掉 proxy 中转**，改浏览器直连 fetch → 真实东财人气榜（SZ002428 云南锗业等）
- 新增 `fetchTHSPopularityRank`（同花顺）：浏览器直连 dq.10jqka.com.cn 热度接口 → 云南锗业/风华高科等真实数据（含概念标签/人气标签/排名变化）
- **PopularityRadar 双榜交叉比对**：
  - 双数据源并行拉取（一个失败不影响另一个，标题显示 东财✓/✗ · 同花顺✓/✗）
  - **双榜共振**：同一只股票两边都上榜 → 顶部紫色醒目提醒条 + 行高亮 + "⚡共振"徽章 + 显示双平台排名
  - 单榜个股正常展示（东财榜/同花顺榜排名分列）
  - 拥挤度预警、新入榜检测、概念标签展示保留
- proxy.js：forward 改 options 对象（hostname/path/servername）补 UA/Referer（防御性；同花顺白名单已加 dq.10jqka.com.cn）

---

## v9.30.3 — 人气榜拥挤度改用涨停池（emappdata 对 nodejs TLS 指纹 ban） (2026-08-06)

### 用户反馈
PopularityRadar 持续显示"待接入"，v9.30.2 部署未解决。

### 根因（实测定位）
- 实测 curl 直连 emappdata.eastmoney.com/stockrank/getAllCurrentList（POST 带 JSON body）**返回 200 + 真实数据**
- 实测 nodejs 原生 https.request（带 Mozilla UA + Referer）**同样返回 200 + 真实数据**
- 但 proxy.js 转发时**总是 12s 超时**（HTTP 000）—— 实测定位：emappdata 服务端对某些客户端实现层的 TLS 指纹 RST（不是 UA 问题，UA 修复无效）
- 之前 v9.27 加 proxy 绕 CORS 的设计假设（node 默认被 ban → 加 UA 即可）**不成立**：emappdata 是更深层的协议层 ban

### 修复
- PopularityRadar 改造数据源：**改用涨停池**作为"人气榜拥挤度"代理（涨停板本身就是市场关注度最高的股票集合，更贴近游资实战语义）
- 删除"待接入"误导文案，改为"暂不可用 / 今日暂无涨停数据"
- proxy.js 同时补全 User-Agent + Referer（防御性，其他 push2 接口也受益）
- 保留昨日快照机制（涨停池作为数据源一样工作）

---

## v9.30.2 — 流出行业获取改双请求（实测定位东财 pz 上限） (2026-08-06)

### 实测发现
- 东财 `fs=m:90+t:2` 行业细分**远超 100 个**，接口对 pz 有上限（约 100 条/页）
- `fid=f62&po=1`（降序）pz=500 → 只返回 f62 最大的 100 个，**全是正数**（流出行业被挤出）
- `fid=f62&po=0`（升序）pz=100 → 全是负数（通信网络设备 -28.48亿 / 传媒 -20.68亿 / 食品饮料 -16.36亿）

### 修复
- `fetchBoardFundFlow` 的 `all` 模式改为**双请求**：`po=1` 拉流入 top300 + `po=0` 拉流出 top300
- 合并去重后本地按 mainNet 降序 → 资金走势图红绿双榜都有真实数据
- 沿用项目已有 `fetchBoardRankTopBottom` 的成熟模式

### v9.30.1 说明
- 初版方案"pz=500 拉全量"实测无效（东财 pz 截断），被本版双请求取代

---

## v9.30 — 行业资金流向走势图重写（摆脱被 ban 的 push2his）(2026-08-05)

### 用户反馈
截图显示 IndustryFundFlowChart 折线图区域全空（仅显示 ±1亿/0亿 刻度），底部"主力净流出（0 行业）"——数据管道异常导致没有有效曲线。

### 根因
- v9.27 起依赖 `fetchBoardFundCurves`（push2his stock/kline/get 分钟 K 线，f60=主力净额）—— 东财 push2his 持续对机房 IP 限流/ban（v9.26.21 修复后仍断流），5/批+重试也只能拿到稀疏数据
- 稀疏数据导致 SVG 里 y 值几乎全为 0 → 曲线挤在 0 附近 → 视觉上"空"
- mainNet 默认 0 → 全部被划入"流入" → 流出行业数为 0

### 修复
- 重写 IndustryFundFlowChart.tsx：**不再依赖 push2his 分钟 K 线**，直接消费 App.tsx 传入的 `industryBoards`（kind="industry"，30 个申万行业）
- 每条行业折线：(09:30, 0) → (asOfMinutes, mainNet/1e8 亿)，三次贝塞尔曲线（模拟"累积过程"形态）
- y 轴：所有行业中 |mainNet| 最大的 ±15% 区间（红涨绿跌对称）
- 流入行业红色系梯度（12 色），流出行业绿色系梯度（12 色），自动循环
- 末端标签：智能防重叠（按 y 排序错位 + clamp 到绘图区）
- 底部双榜：流入榜（红）/ 流出榜（绿），按 mainNet 排序，全量展示
- asOfMinutes 参数：默认 270（=15:00），盘中可传当前时点让折线画到当前位置

---

## v9.29 — GLM5.2 剩余项全部落地：P1-5/8/9/10 + P2 (2026-08-05)

### P1-5 最终准入闸 admissionGate.ts
- 新建：五重准入（强度≥60 + 阶段∈启动/发酵 + 闸门非empty + 无诱多 + 梯队无致命断档）
- 输出三态（可上车/观望/禁止）+ 置信度 + 证据链/阻止原因
- FiveQBar 第4问"能不能上车"改用准入闸（此前仅看强度分）

### P1-8 盘中高频通道
- App.tsx 新增 refreshFast：盘中/竞价每 18s 独立刷新涨停池（轻量，不碰重接口）
- 竞价段同样高频刷池 → "竞价即封板"早期信号更早出现
- jsonpQueue 并发 2→3（本地大多走 proxy 不受限）

### P1-9 LLM task 解耦
- aiPrompts.ts 新增独立 task：themeNewsScore/stockNewsScore/dailyIntel（各自温度/maxTokens，均 thinking=false）
- llmSignals scoreThemeNews/scoreStockNews 原复用 mainlineRank → 改独立 task
- llmNewsIntelligence generateDailyIntelligence 原复用 stockJudge(thinking=true 高延迟) → 改 dailyIntel
- server/routes/ai.js TASK_ALLOW 同步加白名单；cacheKey 按 task 天然隔离

### P1-10 主线精排瘦身
- mainlineLLM prompt 改为"两阶段推理"（先判脉冲再排序）+ schema 精简（去 caution 必填，leaders 只给龙一）
- caution 缺失时按置信度规则推导（<60 → "强度偏弱，注意风险"）

### P2 政策面/鉴权/合规
- P2-1 政策面主动采集：cron.js 新增 fetchPolicyNews（东财快讯按政策关键词过滤）→ 落库 kv_store:policy:YYYY-MM-DD（20min 任务 + 启动抓取）
- P2-3 可选鉴权：server/.env 配 LOCAL_TOKEN 后，/api/proxy 与 /api/ai/call 须带 x-local-token（防局域网/公网白嫖）；默认不配置=放行
- P2-4 合规话术：SYSTEM_PREFIX 改中性强度词；anomalyTier 强指令文案 → "高关注档/中关注档/高风险·暂不建议（参考）"
- P2-5 强催化公告：analyzeDaily 由正则粗筛 → rankStrongAnnouncements（配 key 时 LLM 一次评分 top40，score≥4 进强催化；扩展正则兜底覆盖"净利润同比+200%"类）

---

## v9.28 — GLM5.2 建议落地 P1-6 仓位定量化 + P1-7 个股离场 (2026-08-05)

### P1-6 仓位定量化引擎 positionSizing.ts（决策大脑闭环第一步）
- 新建 src/lib/positionSizing.ts：闸门×强度×单票上限 → 具体建议仓位 %
  - 公式：base(maxSinglePct) × gateFactor × strengthDiscount(≥80→1/≥60→0.6/其他0.3)
  - 联动截断：闸门 positionLimit / 单票上限 / 总仓位剩余容量 / 今日开仓上限
  - 硬禁止：主线诱多 / 退潮期 / 闸门数据不足 / 开仓次数超限 / 未配置资金
  - 阶段准入：仅"启动期/发酵期"可上车，其余观望
  - 分批方案：首仓50% → 确认加仓30% → 冲高减仓20%；止损按阶段档位(启动5%/发酵7%/高潮8%/分歧5%/退潮4%)
- BattlePlan.tsx MainlineBlock 显示仓位徽章："🚀 仓位X% · 首仓Y% · 止损Z%"（绿=可上车/黄=观望/红=禁止）

### P1-7 个股级离场引擎 stockExit.ts（"我手里这只票什么时候跑"）
- 新建 src/lib/stockExit.ts：7 条离场规则（从重到轻）
  - red：诱多出货(涨≥7%主力流出散户接) / 龙头熄火(跟风票) / 封单消失(<2%成交额) / 跌破成本-3%
  - yellow：逼近止损线(-1.5%) / 资金持续流出(今5日10日全负) / 主力净占比转弱 / 高位放量背离
  - 输出：level + reasons + 建议减仓比例
- StockWatchlist 自选股行加离场角标（红! / 黄⚠，tooltip 显示原因）；持仓股自动启用成本止损（读 discipline.positions）
- StockDecisionCard 新增"离场信号"置顶行（红/黄徽章 + 触发原因）

---

## v9.27 — GLM5.2 审查建议落地：P0-2/3/4 + 卫生6 (2026-08-05)

> 审核并落地 `GLM5.2建议.txt`（基于 HEAD e497f47 的全量审查报告）中的重要项。
> 审核结论：报告质量高，P0-1（https-proxy-agent 依赖）已闭环（此前已加），其余声明全部验证为真。

### P0-2 安全：移除硬编码数据库密码（已确认泄露到公开 GitHub）
- server/db.js 移除 `StockMonitor2026` 明文 fallback → 未配置 DATABASE_URL 直接报错退出
- backup.bat 不再写死密码 → 委托新增 server/scripts/backup.js（读 server/.env 解析密码，不落盘）
- 新增 server/.env.example 模板；grep 验证 root 与子目录均无明文密码
- 首次成功执行备份：stock-monitor/backups/stock_monitor_20260805.dump (1MB)

### P0-3 决策大脑：单一权威阶段模型 stageModel.ts
- 此前 6 套互不一致的阶段词表（App/MainlineRanking/mainline/themeScore/emotionCycle/LLM）→ 收敛为唯一词表"启动期/发酵期/高潮期/分歧期/退潮期/观察中"
- 新建 src/lib/stageModel.ts：stageOfFunds（板块资金级）/ stageOfStrength（强度级）/ classifyStage（市场级完整版）/ emotionToStage（情绪对齐）
- App.tsx judgeMainlineStage → stageOfFunds（含新增"分歧期"：高位放量主力不跟=量价背离）
- MainlineRanking inferStage → stageOfStrength（加速→高潮期、主升→发酵期）
- themeScore 权重/分数映射收敛到 stageModel 共享常量；EmotionCycleCard 显示词表对齐

### P0-4 诱多探测引擎 trapDetector.ts（用户核心诉求"识别诱多"）
- 新建 src/lib/trapDetector.ts：假封板（封单<5%成交额+炸板≥2）、诱多拉升（涨≥7%主力流出散户接盘）、量价背离、尾盘抢筹出货（预留）、封单衰减（预留）
- detectMainlineTrap：主线内诱多个股占比≥40% → 主线整体出货预警
- anomalyTier.ts S 级接入 detectTrap：命中 → action 强制"禁止追高·疑似诱多" + ⚠ 标注

### 卫生6：人气榜 CORS 失效
- server/routes/proxy.js 新增 POST 转发支持（emappdata 已在白名单）
- api.ts fetchPopularityRank 本地部署走 /api/proxy POST 绕行 CORS；线上保持降级

---

## v9.26.21 — 资金流向图 K 线拉取限流修复 (2026-08-05)

### 用户反馈
"并没有展示 深度复盘 一并排除是否还有其他问题" — 截图里"今日行业资金流入走势"只显示 2-3 条线，远少于预期的 20+ 条

### 深度复盘根因
1. **接口被 ban**：东财 push2his 对非浏览器 IP 持续 `socket hang up`（机房 IP 屏蔽）
2. **并发过大**：`Promise.all(40 板块)` 触发东财限流 99% 失败，只有 2-3 个能拿到
3. **secid 缺市场前缀**：`industryBoards` 返回的 code 是 `BK1201` 不带 `90.`，K 线接口要 `90.BK1201`

### 修复
- `boardFundFlow.ts` `fetchBoardKlineFlow`：secid 加 90. 前缀（行业板块 code 自动转换）
- `boardFundFlow.ts` `fetchBoardFundCurves`：5/批分批串行 + 失败重试 1 次 + Promise.allSettled 单条失败不阻塞其他
- 批间 100ms 延迟降低被 ban 风险
- export 修复（之前函数没 export 导致 tsc 警告）

---

## v9.26.20 — 资金流向图去硬编码（按实际数据为准） (2026-08-05)

### 用户反馈
"并非十六个行业叠加，你不可以做硬编码，要以实际数据为准"

### 修复
- `App.tsx`：去掉 `slice(0, 8)` × 2 硬编码 → 全部有 mainNet 数据的行业板块传入
- `IndustryFundFlowChart.tsx`：去掉 `splitCount` prop 与 slice → 全部曲线绘制
- 标签智能防重叠：按末端 y 排序，间距 < 16px 自动错位 + clamp 到绘图区
- 下方双榜改"主力净流入（N 行业）/主力净流出（N 行业）"，N 来自实际数据
- 颜色数组扩到 12 色自动循环（行业数不固定）

---

## v9.26.19 — 资金主线页加"行业资金流向走势图"（用户验收修正） (2026-08-05)

### 用户反馈
v9.26.17 实现的"资金走势图"用户未看到 → 排查发现：
- 我把组件挂在 Dashboard 顶部，但 App.tsx **没有 import 也没有传 prop** 给 Dashboard
- 即使传了，选的也是 `|mainNet|` 前 8 概念板块（数据源不对），不是用户期望的"行业资金流"
- 用户实际期望：在 **fundline（资金主线）tab 顶部**展示**行业板块**的资金流入/流出走势图（开盘啦风格：电子/半导体/工业金属/通信等 16 行业叠加折线）

### 修复
- 新建 `IndustryFundFlowChart.tsx`：16 行业叠加（8 流入 + 8 流出），按"流入红/流出绿"配色，红涨绿跌
- 数据源用 `industryBoards`（kind="industry"）按 mainNet 降序取前 8 流入 + 前 8 流出 = 16 个
- 挂到 `fundline` tab：**MainlineRanking 之后**最显眼位置
- 标签自动在曲线右端，水平 1 字行；下方有"主力净流入 TOP8"和"净流出 TOP8"双榜
- 删旧 `BoardFundFlowChart.tsx`（数据源错 + 位置错）
- Dashboard 移除相关 prop + import
- App.tsx `topIndustryFund` state 存 16 个行业数据

---

## v9.26.18 — 炸板数/炸板率接入真实数据 (2026-08-05)

### 用户反馈
炸板数 = 0 / 炸板率 = 0.0% — 实际今日有 42 只炸板

### 根因
东财 `getTopicZBPool` / `getTopicDTPool` 接口的 `sort=fund:asc`（`fund:desc`/`lbc:desc`）均返回**空数组**，只有 `sort=fbt:asc` 返回真实数据。
但代码中 ZBPool/DT 池一直用 `sort=fund:asc` → 算出 blastedCount=0 → 炸板率永远 0。

### 修复
- `api.ts` `fetchZTPoolForDate`：ZB/DT 改 `sort=fbt:asc`
- `LimitBoard.tsx` `fetchZBPool` / `fetchDTPool`：同样改 `sort=fbt:asc`
- `LimitBoard.tsx` ZBStock 类型补 `blastPct/prevBoards`（用 ZBPool 真实字段 `zf`/`zttj.ct`）；`sealFund/lastBoardTime` 兼容字段（ZBPool 无 fund/lbt）
- `api.ts` `LimitPoolSummary` 加 `rawZBPool` 字段（炸板池原始数据，供后续 UI 使用）

---

## v9.26.17 — 资金走势图 + 8 处同类截断修复 (2026-08-05)

### 1. 资金走势图（核心需求）
- 新建 `boardFundFlow.ts`：拉取东财 `push2his stock/kline/get` 板块分钟 K 线，提取 f60=主力净额（万）
- 新建 `BoardFundFlowChart.tsx`：SVG 多板块折线图（x=时间 09:30-15:00，y=累计主力净额亿；红涨绿跌；最多 8 板块叠加）
- 挂到 Dashboard 顶部（IndexStrip 后最显眼位置）
- App 选 |mainNet| 最大的 8 个板块，传入 Dashboard
- proxy ALLOWED_HOSTS 加 `push2his.eastmoney.com`

### 2. 8 处同类截断/不完整修复
- **stockToMainline.ts:533**：fallback 概念聚合 B 路径还残留 `slice(0,50)` → 全量（漏 70 只涨停）
- **stockToMainline.ts:613**：legacyFallbackByHybk `slice(0,50)` → 全量
- **stockBoards.ts:53**：datacenter pageSize 500 → 5000（30 只/批 × 多概念可能超 500）
- **api.ts fetchStockBriefBatch**：单次 100 只 secids 无分批 → 加分批支持 > 100 只自选
- **App.tsx:267**：昨日涨停溢价 `slice(0,100)` → 全量
- **App.tsx:888**：自选股 `slice(0,30)` → 全量（fetchStockBriefBatch 已加分批）

---

## v9.26.16 — 资金为 0 + 化工过宽 修复 (2026-08-05)

### 用户反馈
1. 部分主线资金仍为 0（如 AI应用/化工）
2. 化工 28 只涨停太多（塑料/玻璃/新材料也被算入）

### 根因
- **资金 0**：boards（资金板块）原始名是细分概念（"人工智能"/"基础化工"/"化学制品"/"氟化工"），主线用用户大类名（"AI应用"/"化工"），模糊匹配对不上
- **化工 28 只**：化工词根过宽（"化学原料"/"塑料"/"玻璃"/"新材料"被纳入化工）

### 修复
- `conceptGroups.ts`：
  - 新增 `foldBoardFunds()`：boards 按用户大类折叠聚合资金（"人工智能"→"AI应用"累加资金）
  - 新增"材料"大类：收纳塑料/玻璃/化学原料/金属新材料/新材料
  - 化工词根收紧：剔除塑料/玻璃/化学原料/新材料
  - 通信组加"物联网"词根
- `stockToMainline.ts`：所有资金匹配分支（LLM/fallback 概念聚合/merge/legacy）改为"折叠 boards 优先 + 模糊兜底"

### 验证（折叠后资金）
- 芯片 534 亿 / 通信 372 亿 / 有色 152 亿 / AI应用 146 亿 / 机器人 126 亿 / 元器件 36 亿 / 化工 20 亿

---

## v9.26.15 — 主线作战卡概念级聚类（方案A落地，修复与开盘啦口径不一致） (2026-08-05)

### 复盘结论（用户反馈：今天涨停潮 通信25/芯片24/有色11/算力10/AI应用8/元器件7/智能驾驶6，我列出的主线全对不上）
根因 4 条：
1. **LLM 归类只处理前 30 只涨停**（slice(0,30)）→ 120 只涨停后 90 只全丢 = "通信/算力主线消失"的元凶
2. **fallback 概念聚合只处理前 50 只**（slice(0,50)）→ 同样丢
3. **每只股"择优取1"概念**（无一对多展开）→ 通信/芯片/算力概念被拆散
4. **无词根折叠** → "光模块/CPO/华为"不并入"通信"

### 修复（方案A：纯概念级聚类）
- 新建 `conceptGroups.ts`：20 个用户视角大类词根表（通信/芯片/AI应用/算力/智能驾驶/有色金属/元器件/消费电子/军工/新能源车/机器人/化工/医药/金融等），`foldConcepts()` 折叠
- `themeLadder.ts`：新增 `buildThemeLadderByConcept`（一对多展开聚类），hybk 作 fallback；抽出公共 `buildGroupsFromMap`
- `mainline.ts`：`buildMainlineCandidates` 支持可选 conceptOf（概念聚类优先）
- `stockToMainline.ts`（**真正的主线引擎**）：
  - **LLM prompt 带概念归属提示**（datacenter 折叠后）→ 归类更准
  - **mergeWithConceptFallback**：LLM 归类（前30只）+ 概念聚合补全（其余涨停）→ 防漏主线
  - **fallbackByHybk 升级**：全量涨停（不再截断）+ 词根折叠 + 一对多展开 + 资金匹配

---

## v9.26.14 — 竞价台补"实时涨幅/现价"列 (2026-08-05)

- 用户反馈：竞价台只有"竞价涨幅"（开盘 vs 昨收），缺"实时涨幅"（当前 vs 昨收）
- 修复：AuctionItem 新增 currentPrice / changePct / changeAmount（腾讯 field 3/31/32）
- UI 新增"实时涨幅"和"现价"两列（红涨绿跌），鼠标悬停显示涨跌额

---

## v9.26.13 — 竞价真实数据 + 闸门反向机会 + 主线资金 + ETF/候选点击 (2026-08-05)

### 1. 竞价台：真实数据替代虚假字段
- 根因：东财 ulist 的 f46(今开)/f60(昨收) 已重映射为市值/成交额，原实现算 -100%
- 改造：改用腾讯 qt.gtimg.cn（雪球格式 GBK）—— 单 URL 批量 50 只，含真实今开/昨收/成交量/成交额/换手/振幅
- 服务端代理 ALLOWED_HOSTS 加 qt.gtimg.cn（绕过 CORS + 解决 GBK 编码）
- UI 加列：竞价额（亿）、换手率

### 2. 情绪闸门：不再"永远禁新开仓/空仓"
- 根因：旧映射 s≥80 → factor 0.3 + "极度贪婪·禁新开仓"；s<25 → 0.2 + "极度恐慌·仅ETF"
- 重设计：
  - 极度恐慌 0.2→0.5，label "极度恐慌·超跌机会"
  - 极度贪婪 0.3→0.5，label "极度贪婪·控仓兑现"
- suggestPosition 升级：恐慌+升温 → "反向试探/反向机会"（巴菲特"别人恐惧我贪婪"）；贪婪 → "控仓兑现"
- GateGauge UI 加"反向信号"卡片：贪婪时给兑现路径，恐慌时给超跌路径

### 3. 主线资金为 0 修复
- 根因：mainline.ts 用 hybk 行业名与资金流接口的"概念板块名"维度不匹配（"机器人"行业 vs "机器人概念"概念）
- 改造：三级匹配（精确 → 包含 → 2字 token 模糊）+ 多板块聚合（取 mainNet 绝对值最大的作为代表，5d/10d 累加）

### 4. ETF/候选观察池点击跳转
- realLinks.ts 新增 etfRealUrl(code) → 东财基金详情页；boardNameRealUrl(name) → 同花顺板块页
- BattlePlan ETFBlock 整行可点击跳 ETF 详情；CandidatePool 板块标签可点击跳板块详情

---

## v9.26.11 — 仓位建议体系升级（新增"重仓/轻仓参与"档位） (2026-08-04)

- 背景：用户反馈异动/研判只有"观察、禁止追高"，缺"轻仓/重仓参与"建议
- anomalyTier（异动分级）action 升级为五档：
  - S级+主线+封板 → **重仓参与（主线核心）**
  - S级+主线 / S级放量 / A级+主线 → **轻仓参与（跟主线/观察承接）**
  - S级非主线 → **禁止追高**；A级非主线 → **观察·暂不参与**；B级 → 无需操作
- StockDecisionCard（个股决策卡）新增**重仓参与**档：
  - 强势上行+大资金进场+命中主线 → 重仓参与（主线核心）
  - 强势+大资金 或 主线内走强 → 轻仓参与
  - 高位放量 → 谨慎参与；其余观望；否决 → 不建议参与
- Dashboard 建议动作按语义着色（重仓=红粗、轻仓=琥珀、观察=蓝、禁止/无需=灰）

---

## v9.26.10 — 全栈逐文件审查修复（4 代理审查 + 20+ 项修复） (2026-08-04)

### 服务端
- proxy.js：502/504 双重发送修复（sent 标志）；缓存 key 剔除 req_trace 动态参数（缓存原本永不命中）
- cron.js：内容哈希确定性主键（防重复入库）；fallbackSeq 提到模块顶（消 TDZ）；busy 互斥锁防重叠；20min 调度修正
- ai.js：HttpsProxyAgent 单例（防 socket 泄漏）；超时按 0.4/0.6 比例分配；statusCode 非 2xx 不走代理重试（防重复计费）；takeToken 移到 Key 校验后
- db.js：limit 下界校验（防 LIMIT -1 语法错误）

### 前端核心
- ai.ts：releaseSlot token 模型（并发精确释放）；executeAI 加 catch（防 slot 泄漏）
- themeScore：先锋加分恒真修复（parseInt 改字符串比较）
- llmSignals：0 分被 || 吞修复；JSON 任务改 mainlineRank 槽（thinking:false）
- tradingSession：getUTC* 修复双重时区
- regimeGate：情绪边界错位一档修复 + s≥101 兜底
- seatProfiles：游资识别 token 级模糊匹配（"股份有限公司"插入词问题）
- signalLedger：日期按 +08:00 解析（凌晨时区错位）
- recTracker：>50 只时截断不再误标完成
- seatLedger：停牌股 priceT1 null 不再标回填完成
- boardMap：内存缓存 + in-flight 锁（重复 parse 500 项优化）
- api：节假日涨停池空自动回退最近交易日；anomalyTier 按 10/20cm 区分近涨停

### 组件
- App：countdown 每秒 setState 改 nextRefreshAt 时间戳（消除全树每秒重渲染）；yesterdayZt useMemo（盘前每秒请求修复）；竞态护栏
- TopNav：本地每秒计算倒计时
- NewsPanel：mainlines 闭包旧值修复（"命中主线"标签）
- MarginPanel：融资上涨红涨绿跌修复（原颠倒）
- DarkPool：marketFlowType 匹配对齐实际文案（原死分支恒灰）
- BattlePlan：collapsed 随强度分同步
- StockWatchlist：loadInfo 竞态护栏
- AnnouncementPanel：items ref 镜像（闭包旧值）

### 确认无问题
SQL 全参数化；SSRF allowlist 安全；前后端任务白名单一致

---

## v9.26.9 — 全面审查修复（AI 可用性误判 x3 + 限速双计数 + 缓存漏写 + 竞态护栏） (2026-08-04)

### 全面排查结论：同类 bug 修复
1. **AI 可用性误判（getApiKey 只查浏览器 Key，服务端中转被误拦）** —— 共修复 3 处同 v9.26.7 的 bug：
   - IntelligenceDrawer（督导输入框被禁用、提示"请配置Key"）
   - StockWatchlist（个股 AI 研判/追问/批量扫描按钮被禁用）
   - llmNewsIntelligence（**全栈情报分析核心引擎**直接 return null → "分析中…"卡住）
   - 统一改用 hasAvailableAI()/hasAIOptimistic()

2. **服务端中转成功分支漏写缓存+统计**（ai.ts）：latencyMs 错误、缓存永不写入、今日调用数恒 0 → 补 recordCall/recordSuccess/setCache

3. **限速双计数 + 释放错位**（ai.ts）：reserveSlot 占位 + recordCall 重复 push = 双计数；pop 释放他人槽位；4xx 不释放 → 统一为按时间戳精确释放

4. **cron 覆盖 AI 星级**：ON CONFLICT 不再覆盖 sentiment/stars（保留前端 AI 分析值）

5. **竞态护栏**：LLM 主线精排（llmRankSeq）、自选股异动带（cancelled）防慢响应覆盖新结果

6. **杂项**：429 文案动态显示限速值；快讯 time 缺失用北京时间兜底；cron 主键兜底去 Math.random 改时间戳+序号；文案纠正（"请配置Key"→准确原因）

### 审查确认无问题
- 前后端 13 个任务白名单完全一致；SQL 全参数化无注入；恐慌阈值三处一致（25）

---

## v9.26.8 — 全栈情报分析直读 PostgreSQL（突破 localStorage 5MB）+ 存储文案纠正 (2026-08-04)

- 背景：数据已存 PG，但分析仍走 localStorage（5MB 上限），且文案还提示"请接入 PostgreSQL"
- 修复：
  - dataStore.ts 新增 `fetchAnalysisDataFromCloud()`：本地部署直接从 PG 拉近 30 天全量 news/ann（绕过 localStorage）
  - IntelligenceDashboard 分析取数统一入口 `getAnalysisData()`：本地优先 PG 全量（含指定日期/近N天/自动窗口过滤），线上回退 localStorage
  - 产业链追溯（板块链）本地部署同样用 PG 数据
  - 状态条本地显示「📀 数据已存本地 PostgreSQL · 可回溯至 X」；"网页存储容量有限"提示仅线上显示
- 验证：tsc 通过

---

## v9.26.7 — 修复"已配 Key 但全栈情报分析/每日复盘提示不可用" (2026-08-04)

- 根因：DailySummary 和 IntelligenceDashboard 组件用 `getApiKey()` 仅检查**浏览器 Key**。
  本地部署模式下浏览器 Key 故意留空（v9.26.3 F-03 设计：Key 只存服务端 .env），
  但这两个组件**没考虑服务端中转可用** → 误判"未配置 Key" → 禁用按钮、显示警告。
  而 AI 督导（IntelligenceDrawer）走的是标准 `callAI("supervisor")` → 自动走服务端中转 → 正常工作。

- 修复：
  - ai.ts 新增 `hasAvailableAI()` 异步检测：浏览器有 Key ✓ 或 服务端 /api/ai/config enabled=true ✓ 任一可用
  - `hasAIOptimistic()` 同步乐观判断（初始渲染 + 本地部署默认 true）
  - DailySummary / IntelligenceDashboard 改用 `noAI = !hasAvailableAI()` 替代 `noKey = !getApiKey()`
  - 警告文案改准确："浏览器未填 Key 且服务端未启用 → 检查 ① 设置 ② server/.env"

- 验证：tsc 通过，AI 督导 + 全栈情报分析 + 每日复盘 都走服务端中转

---

## v9.26.6 — 席位画像历史拉回 + 全局字号放大 (2026-08-04)

### 席位画像历史数据恢复
- 背景：历史 seats/playbook/rec_tracker 等 410 个 key 已导入 PG，但 syncLocalWithCloud 只拉回 4 个固定 key，
  本地页面 localStorage 空 → 席位画像(读 localStorage seats:*) 看不到历史
- 修复：
  - server/routes/db.js 新增 GET /api/db/kv/keys（列出全部 key）+ GET /api/db/kv/bulk（批量拉取）
  - cloudStore.syncLocalWithCloud 全量拉回 PG 缺失 key（只填本机缺失，不覆盖本地新数据，分批 50/key）
- 验证：seats:07-28~08-03 共 5 天 2134 条席位记录、playbook:07-28~08-04 全部在 PG

### 全局字号放大（阅读舒适度）
- html font-size 16→17px（基准微放大）
- 覆盖超小字号类：text-[9px]→11px、text-[10px]→12px、text-[11px]→13px、text-xs→14px、text-sm→15px
- 驾驶舱等 600+ 处小字同步提升，大数字(text-2xl/3xl)保持醒目
- 方案：CSS 高优先级规则覆盖，无需逐组件改动

---

## v9.26.5 — 修复"降级模式（LLM失败）" + 自动 LLM 分析接通 (2026-08-04)

### 根因：页面每次刷新触发 10+ AI 任务并发 → 服务端令牌桶仅 10 次/分钟 → 秒级 429 → 前端误降级

### 修复
1. 服务端令牌桶 10 → 60 次/分钟（个人本地部署足够，不再误伤）
2. 前端 callAIviaServer 加 35s 超时 + 429/403 错误透传（不再静默回退本地误报"未配置Key"）
3. 降级文案如实展示原因（服务端限速/超时 vs 未配置Key）
4. **服务端 AI 调用改"直连优先、失败走代理"**：实测 .cn 端点直连 6.7s 稳定，而 Clash 代理会把 .cn 域名绕国外节点导致频繁超时
5. cron 自动 LLM 分析接通：analyzeDaily 配了 .env Key 即真实调用 LLM 生成当日市场速览（7s 直连成功）
6. index.js/cron.js 显式加载 dotenv（保证任意启动方式读到配置）

### 实测
- 5 次调用 4 次成功（6.5~36s），成功率 80%（升级前 100% 超时）
- cron 自动分析生成真实文本（"今日市场缺乏明确主线…"）

---

## v9.26.4 — 历史数据恢复（Chrome localStorage → PostgreSQL 全量迁移） (2026-08-04)

- 背景：本地部署前历史数据只存在线上 github.io 域名的浏览器 localStorage（按域名隔离），本地 PG 看不到
- 恢复：从 Chrome leveldb 导出 github.io 域名 localStorage（399 key / 140 万字符）→ 导入 PG
  - `ds_news` 1082 条快讯 → news 表（历史 7/30~8/4）
  - `ds_ann` 1776 条公告 → announcements 表（历史 7/29~8/4）
  - 龙虎榜台账 seats:07-28~08-03、复盘 playbook:07-28~08-04、rec_tracker 200 条、
    情绪 sentiment、快照 ann/ztpool/popularity 等 397 key → kv_store
- 启动拉取窗口 3→10 天（main.tsx syncNewsFromCloud(10)），覆盖全部历史
- 数据源：Chrome `AppData/Local/Google/Chrome/User Data/Default/Local Storage/leveldb`

---

## v9.26.3 — AI 设置面板服务端中转模式 UI（方案A） (2026-08-04)

- 设置面板自动检测本地服务端 `/api/ai/config`：
  - 服务端已启用 → 顶部绿色横幅「✅ 服务端AI中转已启用·Key在server/.env」
  - Key/BaseURL/模型/厂商/思考模式 全部禁用（🔒），浏览器不再持有 Key（F-03 安全要求）
  - 「测试连接」按钮改为「测试服务端」（走 /api/ai/call 真实调用）
- 线上 GitHub Pages / 服务端未配 Key → 保持原有浏览器直连模式 + 黄/琥珀色提示
- 涉及：src/components/SettingsModal.tsx、src/lib/aiSettings.ts（新增 fetchServerAIConfig/testServerAI）

---

## v9.26.2 — Agnes 按官方公告改回 .cn 端点 + flash 模型 (2026-08-04)

- 官方公告：国际站用户改 Endpoint 为 `https://apihub.agnes-ai.cn/v1` 即可继续用原 API Key
- Endpoint：`.com` → `apihub.agnes-ai.cn`（国际站镜像端点，实测 flash 模型可用）
- 模型：`agnes-2.5-pro`（需付费）→ `agnes-2.5-flash`（免费）
- 实测验证：`.cn + agnes-2.5-flash` 真实调用正常返回分析（S级异动解释成功）
- 涉及：server/.env、server/routes/ai.js、src/lib/ai.ts、src/lib/aiSettings.ts

---

## v9.26 — 审查报告 V2 三波落地（刷新修复 + AI 安全 + 决策三态 + 事件驱动） (2026-08-04)

### 依据
Arena agent 对 v9.25 的全面审查《方案优化V2.txt》，按用户确认的三波清单执行。

### 第一波：P0 修复（5 项）
- **F-01+F-02**：App.tsx 刷新 orchestrator 重写
  - 定时刷新改为单一 interval + ref 计数（不再依赖 countdown state 重建 interval，刷新真正会触发）
  - refreshAll 空依赖闭包修复：overview/darkPool 改 ref 镜像，失败保留旧值真正生效
- **F-08**：allScoringBoards 补回 mainNet/mainNet5d（去掉 as unknown as 强断言，资金不再显示 undefined/NaN）
- **F-09**：runSignalBackfill 改为 await 成功后才 markBackfilledToday（失败 30 分钟重试生效）
- **F-10**：vite ^7.3.6 + esbuild ^0.28.1，npm audit 0 漏洞
- **F-06**：ai.ts 不再把 reasoning_content（思维链）当 content；content 为空=协议错误，上层重试 thinking=false

### 第二波：AI 安全与透明化（4 项）
- **F-05**：新增 mainlineRank 专用任务（thinking=false, temp 0.1, 1500 tokens），主线精排不再复用 stockJudge(thinking=true)
- **F-03**：服务端 AI 中转 server/routes/ai.js（/api/ai/call + /api/ai/config）
  - 模型 Key 只存服务端 .env（AI_API_KEY），浏览器不再持有；前端 isLocalServer 时优先走中转
  - 任务白名单 + 10次/分钟令牌桶；线上 GitHub Pages 自动回退本地 Key
- **F-07**：mainlineLLM 候选白名单校验——board 必须来自输入候选、code 必须属于该候选龙头池、rank 唯一；幻觉板块/股票 100% 拦截
- **F-12**：主线强度分加 dataCompleteness/missingFields（晋级率/10日资金/换手/催化 任一缺失即下调置信度）
  - MainlineRanking 表格新增"完整度"列 + 公式版本说明；五问条显示缺失字段

### 第三波：产品方向（4 项）
- **A.3**：五问条三态输出——唯一可交易主线（Top1≥60 且分差≥10）/ 多主线轮动（分差<10 禁止强行选唯一）/ 无可交易（强度或完整度不足）
- **A.4 简化**：MainlineGroup 加 observedAt 快照时间（可回放审计）
- **A.6 简化**：AnomalyTier S/A 级事件驱动 LLM 解释——新增 eventExplain 任务（thinking=false, 300 tokens），异步补一句归因+建议（每 eventId 一次，降级标 aiLLMDegraded）
- **F-04**：前端限速改"预留-释放"模型（reserveSlot/releaseSlot），失败不占配额

### 其他
- `index.html` title v9.25 → v9.26
- `App.tsx` footer v9.26 · build 08-04 13:00
- 本地部署：server/routes/ai.js 新增；.env 增加 AI_API_KEY 配置（留空=回退本地 Key）


---

## v9.25 — 主线深度催化注入 LLM（业绩/收入指引识别） (2026-08-04)

### 问题
- 用户反馈："医药生物是有时间催化——药明康德业绩和利润大增+收入指引提高，如何让LLM精准识别到呢"
- 当前 LLM 主线精排只看了"涨停梯队 + 简单新闻标题"，没把业绩/收入指引等深度催化纳入，医药生物被排到第三（53分），实际应该是最强主线候选

### 根因
- `lib/mainlineLLM.ts` 的 payload 只有 `news: c.newsTitles.slice(0, 3)` —— 这些是 stockToMainline 匹配到的简单快讯标题
- 缺：dataStore 中**公告淘金**里的业绩/收入指引/中标等深度催化信息（这是"业绩大增"这种强催化的来源）

### 修复
- 新增 `lib/mainlineCatalyst.ts`：buildMainlineCatalysts(mainlines, news, anns)
  - 子词匹配主线名（与 NewsPanel 一致）
  - 提取强催化关键词（业绩大增/收入指引上调/中标/政策利好/重大利好等）
  - 同时识别负向催化（减持/暴雷/亏损/立案等 → 标注【风险·xx】）
  - 输出 Map<主线名, 催化摘要字符串[]>
- `lib/mainlineLLM.ts`：
  - 签名加 catalysts 参数
  - payload 加 `catalyst: catalysts?.get(c.mainline) ?? []` 字段
  - prompt 顶部增加【重要·近期深度催化】区块
  - 判断规则明确：强业绩催化 → rank 显著优先、confidence ≥80；强负向催化 → rank 显著降低
- `App.tsx`：在 rankMainlinesWithLLM 调用前从 getAllSince(3天) 拉取 news+ann，构建 catalystsMap 传入

### 预期效果
- "医药生物 + 药明康德业绩大增 + 收入指引上调"会作为强催化注入 LLM → LLM 倾向于把医药生物排到 rank 1、confidence 80+
- 同时如有"减持/暴雷"类公告，rank 自动降低并打【风险】标签

### 其他
- `index.html` title v9.24.2 → v9.25
- `App.tsx` footer v9.25 · build 08-04 11:10

---

## v9.24.2 — 两融图表重构（双折线对比）+ 清理失效 AI 端点 (2026-08-03)

### 用户反馈
1. 两融余额图表"被修坏了"——柱状图只显示最近 5 天（07-27~07-31），融券余量柱状太小看不见
2. 所有 AI 输出走"LLM 失败·规则版"——降级模式全开

### 修复 1：MarginPanel 图表重构（用户期望同花顺风格）
- 主图：两融余额走势 = 融资余额折线（左轴·橙色面积） + 融券余额折线（右轴·蓝色虚线，自动独立 scale）
- 副图：融资资金流 = 融资买入额浅粉柱 + 融资净买入红涨/绿跌柱（recharts Cell 条件染色）
- 移除原"融券余量 Bar"（与融资余额量级悬殊，柱状图上不可见）
- 新增数据时效说明（东财 T+1 披露 + 滞后提示）

### 修复 2：AI 端点清理
- 实测 apihub.agnes-ai.com 已挂（curl exit 23），从 AGNES_ENDPOINTS 移除
- 端点列表构建逻辑改为遍历式（更健壮）
- AGNES_ENDPOINTS 改为只保留 .cn 一个端点

### 已知遗留
- Agnes 默认免费 Key 路径可能仍不可用——若用户未配置自有 Key 或 Key 失效，所有 AI 仍走规则版
- 建议：用户在设置面板中配置自有 API Key（已支持 7 厂商：Agnes / DeepSeek / 智谱 / Moonshot / 通义千问 / OpenAI / 自定义）

### 其他
- `index.html` title v9.24.1 → v9.24.2
- `App.tsx` footer v9.24.2 · build 08-03 19:30

---

## v9.24.1 — 修复 React #310（hooks 顺序违规导致整页崩溃） (2026-08-03)

### Bug
- 用户报告：点击任意 Tab 后驾驶舱页崩，显示 ErrorBoundary "页面模块异常 + Minified React error #310"
- 表现：今日作战卡（BattlePlan）模块消失（实际是 Dashboard 整个崩了，连带 BattlePlan 不显示）

### 根因
- `components/Dashboard.tsx` 的 AnomalyStrip（v9.24-P1-4 新增）
- 函数体内 hooks 顺序：`useState` → `useRef` → `useEffect`(订阅) → `useEffect`(定时) → **if(stocks.length === 0) return null** → `const verdicts` → `useEffect`(emit)
- 当自选股数量从 0 变 N（或反向）时，渲染期间 hooks 调用次数从 4 变 5
- 违反 React Rules of Hooks → React 抛错 #310 → ErrorBoundary 接住 → 整页显示错误页

### 修复
- 把 `if (stocks.length === 0) return null` 移到所有 hooks 之后
- `verdicts` 用三元判断 `stocks.length === 0 ? [] : ...` 兜底（确保 useEffect(emit) 回调执行时安全）

### 其他
- `index.html` title v9.24 → v9.24.1
- `App.tsx` footer v9.24.1 · build 08-03 19:10

---

## v9.24 — 游资决策大脑 P1（主线强度排行榜 + 个股决策卡 + 消息主线联动 + 异动SAB分级） (2026-08-03)

### PRD《游资决策大脑升级方案》P1 落地（4 项全做）

### 1. 主线强度排行榜（PRD B1）
- `components/MainlineRanking.tsx`（新）：资金主线页首屏表格
  - 排名/主线/强度分/阶段/涨停/连板高度/晋级率(因子得分)/换手(因子得分)/资金净流入(今/5日)/龙头/AI诊断/操作参考
  - 默认按强度分降序；≥80 整行红底 + 红色大字号；阶段徽章（启动/加速/主升/分歧/退潮）
  - 操作参考四色徽章与五问条同口径；复用 calcMainlineScore 注入的 strengthScore
- App.tsx：fundline 区块首屏接入（资金结构详情之前）

### 2. 个股决策卡（PRD C1）
- `components/StockDecisionCard.tsx`（新）：个股雷达页选中股首屏（融资融券之上）
  - 字段：一句话结论(四色徽章)/主线归属/技术位置/资金性质/风险点(≤2)/止损止盈参考/置信度
  - 纯规则引擎基于实时数据（零额外请求）；资金口径附"无法识别拆单"局限说明
- StockWatchlist 导出 WatchStock/VetoItem 类型 + 接收 mainlines prop
- App.tsx 传入今日主线名

### 3. 消息主线联动（PRD E1）
- NewsPanel：每条快讯新增"⚡命中主线：XX"高亮标签 + "定价：已部分反应/已充分反应/尚未反应"
  - 匹配算法：主线名拆子词（"机器人/减速器"→"机器人"），子词≥2 字防误命中
  - 定价状态按命中主线涨停家数近似（≥10 充分/≥5 部分/≥1 反应中/0 尚未）
- App.tsx 传入 battlePlan 主线名+涨停数

### 4. 异动捕捉引擎 S/A/B 分级（PRD 5.6/A5）
- `lib/anomalyTier.ts`（新）：classifyAnomaly 分级 + 事件流（emit/get/subscribe，同 code+level 15min 冷却）
  - S级：≥9.5% 近涨停 / ≥7%+量比≥3 快速拉升
  - A级：量比≥5 / 换手≥15% / 涨幅≥7%
  - B级：涨幅≥3% / 量比≥1.5 / 换手≥8%
  - 每级输出：触发原因 + 呼应主线 + AI一句话研判 + 建议动作
- Dashboard 自选异动带升级为 AnomalyStrip：S红闪/A高亮/B灰 + 色条 + 事件流摘要
- api.ts fetchStockBriefBatch 加 f10 量比字段

### 其他
- `index.html` title v9.23.1 → v9.24
- `App.tsx` footer v9.24 · build 08-03 16:00

---

## v9.23.1 — 工作区完善项补提交 + tsc 清零 (2026-08-03)

### 背景
v9.23 提交后工作区遗留 21 文件未提交改动（v9.23 开发过程中的完善项），本次一并收尾提交部署。

### 1. v9.23.1-fix：主线卡折叠（PRD A2）
- BattlePlan：主线强度分 <60 的卡片默认折叠为一行摘要，点击展开（v9.23.1-fix）

### 2. 其他 v9.23 配套完善（工作区遗留）
- App.tsx：昨日涨停池按主线分组接入离场信号环比（v9.23.1-fix）
- DragonTiger / MarginPanel / StockWatchlist / seatLedger / seatProfiles / sentimentStore / signalLedger / regimeGate / recTracker / etfScore 等配套改动

### 3. tsc 类型错误清零（6 个）
- App.tsx(1071)：`sentiment: number|null` → `?? 0`（MarketSnapshotForNews 要求 number）
- MarketOverview.tsx(254)：SentimentGauge `value={sentiment ?? 0}`
- Playbook.tsx(115/153)：payload `sentiment ?? 0`
- api.ts(1070)：`jsonp<any>` 修复 `data` 属性访问
- `npx tsc --noEmit` 全绿 ✅

### 其他
- `index.html` title v9.23 → v9.23.1
- `App.tsx` footer v9.23.1 · build 08-03 15:40

---

## v9.23 — 游资决策大脑 P0（强度分 + 离场信号 + 五问条 + AI结构化诊断） (2026-08-03)

### PRD《游资决策大脑升级方案》P0 落地（已确认 4 项全做）

### 1. 主线强度分（PRD 6.1）
- `lib/mainlineScore.ts`（新）：calcMainlineStrength() 六维加权公式
  - 涨停家数占比 25% + 连板高度 20% + 晋级率 15% + 资金连续性 20% + 换手 10% + 催化剂 10%
  - 输出 score/factors（证据链）/tier（gold≥80/silver 60-79/bronze<60）
- App.tsx 注入 candidates：strengthScore + strengthFactors，并按强度分重新排序
- BattlePlan 主线卡加强度分大字号徽章（红≥80/橙60-79/灰<60，带公式 tooltip）

### 2. 主线级离场信号（PRD 6.4）
- `lib/exitSignal.ts`（新）：checkExitSignal() 四规则
  - 炸板率环比+15pp / 涨停家数环比-30% / 最高板下降 / 主力转流出
- App.tsx 注入 candidates：exitSignal + exitSignalText
- BattlePlan 主线卡显示"⚠ 退潮"红色徽标

### 3. 游资五问条（PRD 5.1-A1）
- `components/FiveQBar.tsx`（新）：驾驶舱顶部 5 卡片横排
  - 1️⃣主线是什么（强度分徽章）2️⃣处于什么阶段 3️⃣谁是龙头 4️⃣能不能上车（四色操作徽章）5️⃣什么时候跑（离场状态）
  - 60 秒自动刷新；操作徽章按强度分+离场信号动态算（可参与/谨慎参与/观望/应离场）
  - 含 DisclaimerTag 合规标注

### 4. AI 结构化主线诊断（PRD 7.2）
- `lib/aiPrompts.ts`：新增 mainlineDiagnosis 任务槽（thinking=false + maxTokens 1500 + temp 0.2）
- `components/MainlineDiagnosisCard.tsx`（新）：结构化 JSON 输出
  - 真实 LLM 优先（strength_score/stage/sustain_forecast/leader core-follower-hype/action/risk/exit/confidence）
  - 失败降级规则引擎（强度分+离场信号）
  - 卡片化渲染（阶段/操作/置信度/核心跟风蹭热点/风险/离场状态）
- BattlePlan 主线卡加"🎯 诊断"按钮，点击弹出诊断卡

### 其他
- `index.html` title v9.22 → v9.23
- `App.tsx` footer v9.23 · build 08-03 15:10

---

## v9.22 — ETF pctBoost + isThemeBoard 加强过滤 (2026-08-03)

### 用户反馈
- 第一主线"昨日高振幅"被错当主线（非题材，是涨跌状态类）
- "机构重仓"被错当主线（非题材，是资金特征类）
- ETF 排序首推"人工智能ETF 跌0.11%"——跌的 ETF 不该被推为主推

### 修复
- **isThemeBoard 加强过滤**：新增"涨跌幅/换手/成交额/资金特征/主力流向/封板状态/涨跌状态"等非题材词表
  - "昨日高振幅/昨日连板/最近多板/机构重仓/游资重仓/主力资金/超大单大单中单小单/封板炸板" 等全部过滤
- **ETF 评分新增 pctBoost 维度**（权重 20%）：ETF 自身今日涨跌幅
  - 涨 ≥1% → +30 分
  - 跌 0~-1% → -10~-30 分
  - 跌 ≥-1% → 强制降级为 C、total ≤ 55
  - 重新分配权重：fundTrend 30→20 / pctBoost 20（新增）/ boardLink 25→20 / styleFit 20→15 / mainline 15 / macro 10
- App.tsx：ETF 行情拉取新增 `f3` 字段（今日涨跌幅）

### 其他
- `index.html` title v9.21 → v9.22
- `App.tsx` footer v9.22 · build 08-03 12:45

---

## v9.21 — 概念主线精确归类（A 反查增强 + B 个股所属概念 + C 开盘啦式UI） (2026-08-03)

### 用户反馈（v9.20.1 仍错）
- 中大力德(机器人)归到"通用设备"；信测标准被错归"风电"；中国船舶错归"军工"
- 仍是申万行业名（"计算机设备""工业设备"）

### A：成分股反查增强（fallback 兜底层）
- `fetchBoardConstituents` 15→50 只（涨停股常在成分股 16-30 位，之前被漏）
- 过滤"新股/次新股/最近强势/活跃"等非题材板块分类
- 多概念归属时按"今日涨停数最多"择优（数据驱动，不按名字长度）

### B：个股所属概念（核心新增，同花顺式）
- 新接口 `RPT_F10_CORETHEME_BOARDTYPE`（datacenter）：每只股票直接返回所属全部板块
  - 中大力德 → 人形机器人/机器人执行器/减速器/机器人概念（不再是"通用设备"）
  - 支持 IN 批量查询（一次 30 只）
- `lib/stockBoards.ts`（新）：fetchStocksBoards() + isThemeBoard() 过滤非题材
- fallback 顺序：个股所属概念(datacenter) → 成分股反查(方案A) → hybk(最后防线)

### C：开盘啦式主线 UI
- 主线卡热度条：🔥涨停数 + 最高板 + 跟风数 + 资金净流入（带 tooltip 解释）

### 其他
- `index.html` title v9.20.1 → v9.21
- `App.tsx` footer v9.21 · build 08-03 11:30

---

## v9.20 — 概念板块主线归类（按概念而非行业） (2026-08-03)

### 用户反馈问题
- **问题 1**："降级模式（LLM失败）：按申万行业 hybk 分组"——为什么 LLM 失败？
- **问题 2**：中大力德是机器人概念，但归类到"通用设备"（申万二级行业）——抓取的是行业不是概念

### 修复
- **fallbackByHybk → fallbackByConcept**：v9.17 降级路径用申万行业分组（"通用设备""计算机设备"），v9.20 改为：
  1. 拉今日热门概念板块（涨幅+资金正向，前 60 个）
  2. 并行拉每个概念成分股（15 只/概念，8 并发避免限速）
  3. 反向索引 涨停股code → 概念名（多对一，选最短的）
  4. 按概念聚合涨停股；未匹配上 → hybk 兜底
- **加降级日志**：degraded/JSON 解析失败都 console.warn，便于排查（用户可在 ?debug=1 看到 console）
- **强化 LLM prompt**：明确"⚠️ 强制规则：mainline 必须是概念主线（机器人/AI应用/稀土 等），绝不能用申万行业名（通用设备/电气设备 等）"
- **终极兜底**：概念板块反查也失败 → 旧 hybk 分组（保留作为最后防线）

### 其他
- `index.html` title v9.19.1 → v9.20
- `App.tsx` footer v9.20 · build 08-03 10:45

---

## v9.19 — 仓位纪律 + 复盘日志 + 竞价台（审查报告第2层） (2026-08-02)

### F6-F8 仓位纪律面板
- `lib/discipline.ts`（新）：DisciplineState（总资金/持仓/单票上限/新开仓次数/连续亏损）
  - computeDisciplineViolations：单票超限/总仓位超限/新开仓超限/连续亏损冷静期
  - computeStopLoss：基于波动率的止损参考计算器（默认4%，ATR×1.2封顶10%）
  - recordTradeResult：记录盈亏 → 更新连续亏损计数
- `components/DisciplinePanel.tsx`（新）：持仓录入表单 + 违规提醒 + 止损参考 + 仓位百分比

### F9-F11 每日复盘日志
- `lib/dailyReview.ts`（新）：DailyReview（日期/主线/龙头/个股/盈亏/反思）
  - upsertReview / computeLossStreak / searchReviews / statByMainline（题材盈亏统计）
- `components/ReviewPanel.tsx`（新）：收盘后引导填写 + 题材盈亏徽标 + 按题材检索 + 连续亏损冷静期徽标

### F1-F3 竞价台
- 探测结论：东财无集合竞价量字段 → 采用"今开涨幅 + 首封时间"近似方案
- `lib/auction.ts`（新）：fetchAuctionBoard() 批量拉 f46今开/f60昨收 + 涨停池首封
  - 早盘强度分：竞价涨幅 + 首封时间加成 + 连板加成
  - 标记：竞价即涨停（≥9.8%）/ 大幅低开（<-3%）
- `components/AuctionBoard.tsx`（新）：竞价强度排行 + 高亮标记 + 30s 自动刷新
- Dashboard 接入：盘前/竞价布局展示（isPre 块），附时效标签

### 其他
- `index.html` title v9.18 → v9.19
- `App.tsx` footer v9.19 · build 08-02 20:25

---

## v9.18 — 合规收敛 + 数据时效标签 + 情绪周期雷达（审查报告第1层） (2026-08-02)

### T1-T4 合规话术收敛（弱化荐股指令）
- `components/DisclaimerTag.tsx`（新）：卡片级小字免责标注（"仅供参考，不构成投资建议"）
- DragonTiger：主导派与操作建议 → 主导派信号研判；一句话操作建议 → 信号解读
- seatBehavior：suggestion 文案中性化（"务必警惕"→"历史统计中回吐概率较高"；"可作中线跟踪"→"历史统计中组合走强概率较高"）
- BattlePlan：低闸门"不可重仓追高" → "历史统计中该环境下主线成功率偏低"
- Dashboard/App.tsx：逆风减仓/追高风险等强指令词 → "历史统计风险偏高"

### U1-U3 数据时效标签
- `components/FreshnessTag.tsx`（新）：实时/准实时/T+1 三态徽标（绿/琥珀/蓝）
- DragonTiger 顶部接入 T+1 标签（"数据于交易日收盘后 16:00 起陆续更新，仅用于复盘及次日参考"）

### F4-F5 情绪周期雷达（温度计 2.0）
- `lib/emotionCycle.ts`（新）：computeEmotionCycle() 五档周期判断（启动/主升/分歧/退潮/冰点）
  - 判定信号：炸板率趋势 + 涨停数环比 + 溢价转负 + 晋级率 + 高度变化
  - 退潮预警复合模型（游资最看重）：炸板率攀升/溢价转负/晋级率低 → ebbAlert
- `components/EmotionCycleCard.tsx`（新）：周期徽标 + 操作基调（中性表述）+ 证据链（避免黑箱）+ 退潮预警
- Dashboard 首屏接入（BattlePlan 下方）

### 其他
- `index.html` title v9.17.1 → v9.18
- `App.tsx` footer v9.18 · build 08-02 17:50

---

## v9.17.1 — LLM 归类修复 + 龙二龙三补齐 + 人气榜对照 (2026-08-02)

### Bug 修复：LLM 主线归类一直降级
- 根因：`classifyStocksToMainlines` 用 stockJudge 任务槽（thinking=true + maxTokens 8000），
  50 只涨停 payload + 长 prompt → 超时降级 → 一直"按申万行业 hybk 分组"
- 修复：
  - `aiPrompts.ts` 新增 `mainlineClassify` 任务槽：thinking=false + maxTokens 4000 + temperature 0.1
  - `stockToMainline.ts` 改用 mainlineClassify + payload 50→30 只
  - LLM 调用更快更稳，归类成功率大幅提升

### 龙二龙三补齐
- 根因：LLM 精排（rankMainlinesWithLLM）返回的 leaders 可能只有龙一 → 覆盖规则机的龙二龙三
- 修复：BattlePlan.tsx 合并逻辑——LLM leaders <3 时，用规则机 candidates.leaders 补齐，
  保证每个主线显示完整龙一龙二龙三

### 人气榜对照（用户要求）
- App.tsx：fetchPopularityRank(50) 拉人气榜，按 code 匹配注入各主线 leaders.popularRank
- BattlePlan.tsx：龙一龙二龙三旁边显示 "🔥人气#N" 徽标（Top3 红色高亮，其他琥珀）
- 人气榜不可用时静默降级（不影响主线展示）

### 其他
- `index.html` title v9.17 → v9.17.1
- `App.tsx` footer v9.17.1 · build 08-02 17:20

---

## v9.17 — LLM 涨停主线归类 + 主线阈值修复（核心改进） (2026-08-02)

### 问题反馈
- 单只孤峰（9板独苗）被排进第一主线（实际应为弱主线/孤峰）
- AI应用/云计算/线上消费 等"软语义"主线没被识别（hybk 申万行业硬分类的局限）
- ETF池缺 云计算/线上消费/创业板软件 等主线品种

### 核心新增：LLM 涨停主线归类
- `lib/stockToMainline.ts`（新）：
  - `classifyStocksToMainlines(rawPool, boards, news)`：一次 LLM 调用把涨停池按"软语义"归类
    到主线（如 "AI应用"/"云计算"/"机器人"/"信创"/"光通信CPO"/"稀土"等投资者口语化标签）
  - 同时让 LLM 评估"是否真主线"：涨停≥3只=真主线，1-2只=孤峰/弱主线
  - 一次调用输出：个股归类 + 主线聚合 + 整体市场逻辑
  - 失败降级：hybk 申万行业硬分类（依然可用）

### 主线阈值修复（v9.17）
- `lib/mainline.ts` 改：`g.count < 2 continue`（要求 ztCount ≥ 2 进主线）
- 即使 9板独苗，1只涨停也不算"板块效应"——这是用户核心反馈
- 单只孤峰现在会显示"💨 脉冲/孤峰"或"板块效应弱"角标

### ETF_POOL 扩充（v9.17）
- 云计算ETF、线上消费ETF、软件ETF(创业板)、互联网ETF、游戏ETF、家电ETF、化工ETF
- 医疗ETF、化工ETF(新材料) 等 5+ 个新品种

### UI 强化
- 顶部"🤖 LLM 归类总览"：XX只涨停 → YY条主线（ZZ条真主线）· 市场逻辑
- 主线卡：板块效应弱时显示"⚠ 板块效应弱"角标
- LLM 精排不变（继续异步补位）

### 改动文件
- 新增：lib/stockToMainline.ts（240+ 行）
- 改：lib/mainline.ts、lib/etfScore.ts、lib/mainlineLLM.ts、App.tsx、components/BattlePlan.tsx

### 其他
- `index.html` title v9.16 → v9.17
- `App.tsx` footer v9.17 · build 08-02 17:10

---

## v9.16 — 今日主线作战卡（打破重建：涨停潮→风格感知→主线排序→ETF直出） (2026-08-02)

### 打破重建背景
- 旧"今日推荐"三列结构（板块/个股/ETF）杂乱：个股用板块成分股而非涨停梯队、
  news 维度写死空数组、LLM 只做新闻打分、ETF 无风格感知（7-31 进攻 AI 却推红利）
- 用户要求：≥3 主线 + 多主线个股排序 + 多只 ETF 排序 + 随情绪/资金/大盘实时切换

### 新引擎（三层）
- **`lib/mainline.ts`（新）**：
  - `buildMainlineCandidates(rawPool, boards, news)`：涨停潮检测（涨停≥2/高度≥2）
    + 龙一龙二龙三判定（最高板+最早封板=龙一 / 次高板+封单=龙二 / 成交额大=龙三）
    + 主线强度分（资金35% + 涨停潮35% + 梯队20% + 涨幅10%）
  - `detectMarketStyle()`：进攻日/轮动日/防守日 + 风险偏好 0-100（情绪40%+涨停30%+涨家30%，
    炸板率/闸门惩罚）
- **`lib/mainlineLLM.ts`（新）**：`rankMainlinesWithLLM()` 精排主线（真主线vs脉冲 + rank + 龙头确认
  + 逻辑/风险），复用 callAI 中枢，失败降级回规则
- **`lib/etfScore.ts`（重构）**：五维权重 fundTrend30/boardLink25/styleFit20/mainlineLink15/macro10
  - ETF_POOL 扩充：5G通信/AI/软件/游戏/新能源车/医药 等主线品种
  - 修复红利 boardKeywords 空 bug + 进攻日红利减分
  - `styleFit`：进攻日成长加分、防守日避险加分
  - `mainlineLink`：主线→ETF 直出匹配（如主线=AI → 人工智能ETF/科创50）

### App.tsx 数据流
- `newsItems` 修复：从 dataStore `getAllSince(近2日)` 读真实新闻（原来空数组）
- battlePlan 结构：`{ gate, candidates, llmRanked, marketStyle, etfs, candidateThemes }`
- 推荐落盘：主线（含龙一龙二龙三）+ ETF
- LLM 精排：规则渲染后异步 1 次，失败降级

### BattlePlan.tsx（重建为"主线作战卡"）
- 风格徽标（🔥进攻/🔁轮动/🛡️防守 + 风险偏好）
- ≥3 主线区块：第一/第二/第三 + 脉冲线标记（LLM判定）
- 每线：龙一龙二龙三（角色徽标 + 理由）+ LLM 逻辑 + 风险提示
- ETF 排序区块：4 只（含主线直出标记）
- 候选观察池（板块4-8名）

### 其他
- `index.html` title v9.15.1 → v9.16
- `App.tsx` footer v9.16 · build 08-02 16:50

---

## v9.15.1 — 今日推荐 bug 修复（v9.15 hotfix） (2026-08-02)

### Bug 1：闸门 × 0.3 错判为"谨慎模式"
- 原因：`deriveGateMode` 用 `factor < 0.3`（严格小于），0.3 不满足，被错分到 cautious（0.3-0.7）
- 修复：`factor <= 0.3` → low 模式（v9.15 边界 bug）

### Bug 2：低闸门模式个股推荐为空
- 原因：极端情绪下 topThemes 板块的成分股被 `buildVetoList` 全否决（mainNet<0 + smallNet>0），topStocks 为空
- 修复：低闸门模式 + topStocks 为空时，从涨停板 rawPool 中选资金最强 2 只作为"低闸门精选"
  - 绕过 stockScore 因子计算（涨停板已确认封板）
  - 标 tier="B" + invalidation="低闸门精选：涨停板资金最强"

### 其他
- `index.html` title v9.15 → v9.15.1
- `App.tsx` footer v9.15.1 · build 08-02 13:50

---

## v9.15 — 今日推荐 3 模式分层（机构纪律+游资选股 融合） (2026-08-02)

### 问题
- 旧版"今日无推荐"在闸门≤0.3 时一票否决，但用户实际需求是"强中选强，推荐主线标的"——即使情绪过热，**最强主线**仍有资金接力，错过机会成本高
- 旧逻辑偏机构风控，缺游资视角的"低仓试探"机会

### 改造
- `regimeGate.ts` GateResult 新增：
  - `mode: "full" | "cautious" | "low" | "empty"` 4 模式
  - `positionLimit: number` 建议仓位上限 %
  - `riskLevel: "low" | "mid" | "high" | "none"` 风险等级
- `BattlePlan.tsx` 3 模式渲染：
  - **full**（闸门≥0.7）: 正常模式，显示所有 A/B 档
  - **cautious**（0.3≤闸门<0.7 或熔断）: 谨慎模式，主题前 3 + 个股前 5 + 全部 ETF + 风险徽标
  - **low**（闸门<0.3）: 低闸门模式，主题前 1 + 个股前 2 + ETF 前 1（**最强主线**）+ 仓位角标 + 红色警示横幅
  - **empty**（数据缺失）: 显示"今日无推荐"
- ThemeCard / StockCard / ETFCard 新增 `showPositionCap` 角标（"💰 上限 30% 仓"）

### 仓位上限规则
- full: 100% × 闸门（如 0.8 → 80%）
- cautious: 50% × 闸门
- low: 30% × 闸门
- 空仓: 0%（缺数据时）

### 其他
- `index.html` title v9.14 → v9.15
- `App.tsx` footer v9.15 · build 08-02 13:30

---

## v9.14 — 连续动作+展开 + 画像按票聚合 + 操作建议5维评分 (2026-08-01)

### A. 游资连续动作 + 展开
- `SeatRepeatPanel` 每行加 + 按钮
- 展开：复用 SeatHistoryExpansion（按股票聚合版），看该席位做过的所有票

### B. 席位画像按票聚合（v9.13 + 号改版）
- `seatLedger.ts` 新增 `buildSeatStocksByDept(deptName, maxDays)`：按股票聚合
- `SeatHistoryExpansion` 重写：列出该席位做过的每只票（次数+累计净买入+平均T+1+末次T+1+末次上榜日）
- 头部汇总：近30日做过的票数 / 累计上榜次数 / 累计净买入

### C. 操作建议多重信号交叉验证（5 维评分，v9.14 核心新增）
- `analyzeSeatsGroup` 重构为 5 维加权评分：
  - 行为模式 35%（派系组合：格局主买+砸盘主卖=95分；新面孔/数据不足=35分）
  - 集中度 25%（合力加分≥3家同买；独食减分单家>60%）
  - 历史 T+1 20%（买方前五的 T+1 均收益方向）
  - 席位类别 10%（机构主导加分；机构派发减分；北向加仓加分）
  - 新面孔比例 10%（已识别派系占比<40%减分）
- `BuySellAnalysisPanel` 重写：
  - 头部：买方主导派/卖方主导派/综合分/信号强度
  - 信号徽标（多枚，good/warn/bad/info 四色）
  - 一句话操作建议
  - 风险警示（低分/独食/新面孔多）
  - 5 维评分进度条
  - 派系分布

### 其他
- `index.html` title v9.13 → v9.14
- `App.tsx` footer v9.14 · build 08-01 20:15

---

## v9.13 — 席位画像 + 号展开 + 龙虎榜操作建议 (2026-08-01)

### A. 席位画像 + 号展开（点击行查该席位历史）
- `seatLedger.ts` 新增 `buildSeatHistoryByDept(deptName, maxDays)`：返回该席位近 N 天上榜记录
- `DragonTiger.tsx` SeatProfileCard 每行加 + 按钮，展开显示该席位最近操作
  - 列：日期 / 股票名 / 方向（买/卖）/ 净额 / T+1收益（已回填）
  - 鼠标悬停 + 按钮高亮（amber）

### B. 龙虎榜买入/卖出前五加行为模式 + 操作建议（核心新增）
- `seatBehavior.ts` 新增 `analyzeSeatsGroup(buyers, sellers, behaviorMap)`：
  - 综合买卖双方前五的"行为模式"分布
  - 输出：买方主导派 / 卖方主导派 / 派系分布 / 一句话操作建议 / 信号强度
  - 6 大操作建议规则（格局派主买+砸盘派主卖 → "洗盘嫌疑大、可作中线跟踪"等）
- `DragonTiger.tsx` SeatTable 每行加两列：画像（席位名标签）+ 行为（格局派/砸盘派/波段派等）
- 展开行加 BuySellAnalysisPanel：显示主导派徽标 + 一句话操作建议 + 派系分布

### 其他
- `index.html` title v9.12 → v9.13
- `App.tsx` footer v9.13 · build 08-01 19:56

---

## v9.12 — 持仓-主线匹配修复 + 游资行为模式长期打标 (2026-08-01)

### A. 持仓-主线匹配 bug 修复（v9.10 P3 增强）
- **bug 根因**：原匹配只看"申万行业名==主线 board 名"，但太极实业等行业（光学光电子）今天没在 top10 industry 内；且"涨停票"常因"光通信/低空经济"等小众概念发力，不在行业维度
- 修复点：
  - `positionMatch.ts` 增加"概念匹配"维度（行业 OR 概念双匹配）
  - `App.tsx` mainline 拉取范围：industry 10→30, concept 10→30, region 6→10（更多主线候选）
  - 新增"概念异动"状态：涨幅 ≥5% 但行业/概念都不在主线 → 标 🔥概念异动（不再是孤立）
  - 新增"弱势孤立"状态：跌幅 ≤-3% 且不匹配 → 标 ⚠弱势（区别于普通孤立）
  - 提示语区分"行业匹配"vs"概念匹配"vs"概念异动"
- `Dashboard.tsx` PositionMatchStrip：5 种状态色 + 警示条 + 匹配来源角标

### B. 游资/机构长期行为模式标签（v9.12 核心新增）
- `lib/seatBehavior.ts`（新）：基于 `SeatProfile` 的统计自动给席位打行为模式
- 5 种行为标签（v9.12 已实现，可按数据微调阈值）：
  - **格局派**（红）= 值得跟踪：T+1 ≥+2% + 胜率≥60%
  - **波段派**（橙）= 适合跟踪波段：T+1 ≥+3% 但胜率<60%
  - **接力派**（紫）= 高频高胜可长线跟：上榜≥10次 + 胜率≥50%
  - **砸盘派**（灰）= 务必警惕：T+1 ≤-2% 或胜率<35%
  - **一日游**（浅灰）= 上榜后次日常跌
  - **新面孔** / **数据不足**（兜底）
- `DragonTiger.tsx` SeatProfileCard 新增"行为模式"列 + 配色图例
- 鼠标悬停看 triggers 数据（reasons 数组）

### 其他
- `index.html` title v9.11 → v9.12
- `App.tsx` footer v9.12 · build 08-01 19:42

---

## v9.11 — 游资标签全面化 + 两融观察券商风格重做 (2026-08-01)

### A. 游资标签全面化（席位画像）
- `lib/seatProfiles.ts` SEAT_PROFILES 从 14 条扩充到 ~35 条，覆盖主流游资：
  - 顶级游资（rose 红）：章盟主（国泰海通上海江苏路）/ 赵老哥（银河绍兴）/ 炒股养家（华鑫上海分公司）/ 佛山系（财通佛山新城等）/ 欢乐海（财通杭州延安路）
  - 次级游资（hot1 橙）：作手新一（财通杭州解放路）/ 苏南帮（华泰苏州人民路）/ 益田路荣超（招商深圳益田路）/ 思明南路（财通厦门思明南路）
  - 主流席位（hot2 绿）：章牛（国海济南）/ 上海超短帮（东方上海分公司）/ 中信系游资 / 孙哥（古北路/溧阳路）/ 财通杭州系 / 东兴北京系 / 太平洋系
  - 综合席位（fund 紫）：拉萨帮 / 招商深圳系 / 中金财富系 / 开源系 / 成都北一环 / 南京太平南路 / 申万宏源系 / 海通系 等
- 新增 `isTopHotMoney()` 判断顶级游资（红色高亮）
- 已有的"知名游资"占位标签全部替换为具体名字（龙虎榜/席位画像/连续动作 三处自动生效）

### B. 两融观察券商风格重做
- `components/MarginPanel.tsx` 全重写：
  - 顶部 4 卡：融资融券余额 / 融资余额 / 融资买入额（当日）/ 融券余量金额，每卡带"较前日 ▲/▼ 数值"变化指示
  - 顶部时间窗：1月 / 3月 / 半年 / 1年，显示区间累计（融资买入+净买入）
  - 主图：两融余额走势（融资余额折线 + 融券余量柱状，双 Y 轴）
  - 主图时间窗：3M / 6M / 1Y / 3Y
  - 副图：融资资金流（融资买入额柱 + 融资净买入柱，红涨绿跌）
  - 数据源标签："沪深两市融资融券汇总 · 交易所 T+1 披露 · 数据截至 YYYY-MM-DD"

### C. 个股雷达两融直观化
- `components/StockWatchlist.tsx` MarginSignalCard 升级：
  - 4 指标卡：融资余额 / 融券余额 / 今日净买入 / 5日净买入
  - **变化率多窗口对比柱（核心新增）**：3/5/10 日变化率中线对齐迷你柱状图，一眼看加速/减速
  - 净买入多窗口：3/5/10 日净买入
  - 信号徽章 + 一句话解释保留

### 其他
- `index.html` title v9.10 → v9.11
- `App.tsx` footer v9.11 · build 08-01 19:25

---

## v9.10 — 十年机构视角四大优化：信号验证闭环 / 情绪动量仓位 / 持仓主线匹配 / 游资连续动作 (2026-08-01)

按"机构决策闭环"原则实施四大优化，让工具从"信息聚合器"升级为"决策系统"。

### P1 信号验证闭环（最高优先：没有胜率的信号=噪音）
- `lib/signalLedger.ts`：
  - 新增 `runSignalBackfill()` 批量自动回填 T+1/T+5（真实日K收盘价），配合 `isBackfilledToday`/`markBackfilledToday` 幂等
  - `getSignalStats()` 增加 `health` 字段：胜率≥55%有效 / 45-55%一般 / <45%存疑 / 样本<10不足
- `App.tsx`：回填三保险（首载自动 + 30分钟定时 + SignalPanel手动按钮），不再依赖"盘后打开页面"
- `components/SignalPanel.tsx`：新增"补全回填"按钮 + 健康度角标（存疑红色高亮）
- `lib/recTracker.ts`：新增 `getBoardHitBadge`/`getStockHitBadge`（按板块/个股查历史推荐命中率）
- `components/BattlePlan.tsx`：板块卡/个股卡新增 🎯 历史命中率徽标（绿≥60% / 黄40-60% / 红<40%）

### P2 情绪动量 + 仓位映射（机构看变化率，不看绝对值）
- `lib/sentimentStore.ts`：
  - 新增 `recordIntradaySentiment()` 日内采样（5分钟节流，保留80点）
  - 新增 `loadIntradaySeries()` / `computeMomentum()`（30分钟斜率 → 升温/降温/平稳）
  - 新增 `suggestPosition()` 仓位建议：情绪×动量×闸门 → 建议总仓位%（10%-100%）
- `components/Dashboard.tsx` GateGauge 升级：
  - 情绪日内折线（纯SVG零依赖）
  - 动量标签（🔥升温/❄️降温/→平稳）
  - 建议总仓位卡片（先定仓位，再谈标的）

### P3 持仓-主线匹配（交易员每天第一问：我的票还在主线上吗？）
- `lib/positionMatch.ts`（新）：`matchStockToMainline()` 用行业映射把自选股对应到主线板块阶段
- `components/Dashboard.tsx` 新增 PositionMatchStrip 卡片：
  - 顺风（在主线上）/ 孤立（不在任何主线）/ 逆风（所在板块退潮→提示减仓）
  - 逆风数量>0 时红字警示 + 每只票的板块阶段徽标

### P4 龙虎榜游资连续动作跟踪（单日上榜 vs 反复动作）
- `lib/seatLedger.ts`：新增 `buildSeatRepeatActions()` 聚合近60日"同席位同票≥2次"的连续动作
- `components/DragonTiger.tsx`：新增 SeatRepeatPanel：
  - 持续买入（游资反复加仓）/ 持续卖出（派发中回避）/ 买卖反复（博弈主战场）
  - 每次动作显示次数、方向、T+1均值溢价、上榜日期

### 其他
- `index.html` title v9.9.1 → v9.10（与 footer 统一）
- `App.tsx` footer v9.10 · build 08-01 18:46

---

## v9.9.1 — 修复：时区bug全量治理 + 关键性能/质量改进 (2026-08-01)

本版本系统性修复一组跨时区/数据一致性 bug，覆盖 12 个源文件。根因是多个组件用
`new Date().toISOString().slice(0, 10)` 取日期，而 `toISOString` 返回 UTC；中国时区
(CST, UTC+8) 在本地凌晨 0:00-8:00 之间 UTC 仍在「昨天」，导致：

- AI 缓存命中「昨天」的旧结果（同一 payload 永远不刷新）
- 信号账本 / sentimentStore 写入昨日的 key
- 督导室「昨天」「7.30」解析漂移一天
- 状态条「今日信号数」永远为 0
- 行情面板静音判定为「今日已过期」（永远重新弹）

### A. 时区 bug 全量修复（统一本地日期工具）
- `lib/format.ts`（新工具）：新增 `localDateStr()` / `localDateStrOffset(days)` /
  `localDateStrCompact()`，基于 `Date.getFullYear/getMonth/getDate` 拿本地年月日。
- `App.tsx`：3 处 `toISOString().slice(0,10)` 改 `localDateStr()`（情绪信号、推荐落盘、
  盘后归因）。
- `lib/ai.ts`：`cacheKey` 与 `statsKey` 改本地日期，避免凌晨跨日缓存错配。
- `lib/boardMap.ts`、`lib/sentimentStore.ts`、`lib/dataStore.ts`、`lib/newsMemoStore.ts`：
  全部淘汰边界/历史 key 改本地日期。
- `components/IntelligenceDrawer.tsx`：
  - `parseQueryDate` 时区公式 `(8*60 - getTimezoneOffset())*60000` 错算成 +16h，
    改为直接用 `localDateStrOffset(d)`，与 dataStore 口径一致。
  - 督导室 `dateLabel` / `getAllSince(...)` 改本地日期。
- `components/AlertBanner.tsx`、`components/StatusBar.tsx`、`components/Dashboard.tsx`、
  `components/DailySummary.tsx`、`components/WeeklyCoach.tsx`、`components/Playbook.tsx`、
  `components/SignalPanel.tsx`：本地日期统一。

### B. AI 中枢加固
- `lib/ai.ts`：`getCache` 加 2 小时 TTL（CACHE_TTL_MS=2h），盘前预案不再永命中旧结果。
- `lib/aiPrompts.ts`：`annRank` fallback 改为 JSON 数组（之前 markdown 导致
  `parseAIJSON` 提取失败 → 公告 AI 评分丢失）。

### C. 个股雷达（StockWatchlist）关键 bug
- `refreshStocks` 改 `Promise.allSettled` 并发（30 只股票 ~6s 串行 → 一次并发）。
- 失败的股票保留旧数据（之前 `setStocks(results)` 整体替换 → 失败股票从列表消失）。
- `setStocks(prev => ...)` 函数式更新，去除对 `stocks` 闭包依赖，60s 刷新 effect 不再反复重建。
- API Key 保存从 `localStorage.setItem('llm_api_key', k)` 改为 `setApiKey(k)`（ai.ts），
  写入 `ai_settings_v1`，与 `callAI` 读取口径一致。

### D. App.tsx 状态机与订阅
- countdown setState updater 内 `refreshAll()` 反模式修复：把副作用移到独立 `setInterval` 回调。
- 单独的 refresh watchdog，规避 StrictMode 双调 + inFlight 护栏边界。
- 顶部 `TopNav` 铃铛角标改为订阅 `alertBus.subscribe()`，emit 触发时实时刷新（之前直接
  `getUnreadCount()` 在 render 读取，bus 变化不会重渲染 → 角标永远不更新）。
- `Dashboard` `showAI` 加 `useEffect` 跟随 phase（盘后自动展开 AI 复盘）。

### E. 其他
- `index.html` title v9.9 → v9.9.1（与 footer 统一）
- `App.tsx` footer v9.9 → v9.9.1 · build 08-01 18:10

---

## v9.9 — 新增：两融观察（全市场+个股）+ 修复三个功能 Bug (2026-08-01)

### A. 新增两融（融资融券）功能
- `lib/margin.ts`（新）：东财数据中心两融接口封装
  - `fetchMarginHistory(days)`：全市场两融历史汇总（RPTA_RZRQ_LSHJ，沪深合计，2010至今）
  - `fetchStockMargin(code)`：个股两融明细（RPTA_WEB_RZRQ_GGMX，沪/深/创/科全覆盖）
  - `detectMarginSignal()`：融资客动向信号检测（加速建仓/持续流入/流出），依据融资余额 3/5/10 日变化率梯度
- `components/MarginPanel.tsx`（新）：全市场两融观察面板
  - 融资余额/今日净买入/融资买入额/融券余额 四指标卡 + 环比
  - 历史趋势图（融资余额折线 + 净买入柱，1月/3月/半年/1年切换）
- `components/StockWatchlist.tsx`：个股雷达新增融资信号卡（余额/今日净买入/5日10日变化率 + 🔥加速建仓徽章）
- `components/FundStructure.tsx`：两融 TODO 占位卡替换为真实数据（融资余额+环比+今日净买入）

### B. 修复三个功能 Bug
- **个股雷达 60s 刷新清空 AI 研判**：effect 依赖从 `loadInfo`（每 60s 重建的引用）改为仅 `selected`，刷新不再清空 AI 结果/追问记录
- **LimitBoard 晋级率时区混算**：改为接口真实交易日 qdate + `loadPrevZTSnapshot`（与 App 同口径，兼容节假日/跨日），删除 UTC toISOString 推算
- **AnnouncementPanel AI 归因去重失效**：判断键统一为 stockCode（原 has(artCode)/存 stockCode 不一致 → 重复调用 AI）

### C. 其他
- `index.html` title v6 → v9.9（版本号与 footer 统一）

---

## v9.8.10 — 修复：themeScore 新闻归组改用数据驱动 boardMap (2026-07-31)

修复：themeScore 自带第二份硬编码板块词表（11 个板块关键词），与已数据驱动化的 boardMap 脱节。板块评分的"消息"维度用陈旧硬编码词表，新题材（低空/算力/机器人）评不到分。

**A. 移除硬编码词表**：
- `themeScore.ts`: 删除 `BOARD_NEWS_KEYWORDS` 硬编码数组（11 个板块关键词）

**B. 改用动态词表**：
- `themeScore.ts`: 导入 `matchBoardsByText` 从 boardMap
- 新闻归组逻辑改为：`matchBoardsByText(item.title)` 返回匹配的真实板块名数组
- 为每个匹配的板块累加分值（不再依赖硬编码关键词）

**效果**：
- 新题材（低空经济/算力/机器人等）可被 boardMap 词表正确匹配并评分
- 板块消息维度与行业/概念分类保持一致，无脱节
- 评分更准确反映真实市场题材热度

---

## v9.8.9 — 修复：涨停板晋级率计算口径改正+与闸门熔断同源 (2026-07-31)

修复：涨停板"晋级率"定义应为"昨日首板中今日继续涨停的比例"，分母应为昨日首板数而非今日涨停+炸板数；LimitBoard 与 App/regimeGate 统一使用同一口径数据源。

**A. 口径统一（App.tsx）：**
- 晋级率计算改为：昨日 lbc===1（首板）的个股中，今日 lbc>=2（继续涨停）的比例
- 昨日无首板个股→promotionRate 保持 null（无样本，不是0）
- 更新 PROMO_TIER 注释，明确为"昨日首板今日继续封板比例"

**B. 显示层修复（LimitBoard.tsx）：**
- 晋级率计算改用昨日快照数据（从 localStorage 加载）
- 分母改为昨日首板数，分子为昨日首板中今日继续涨停的数量
- 昨日快照缺失或解析失败→promotionRate 保持 null
- 显示层：null 时显示"—"，非 null 时显示百分比
- 更新 sub 文案为"昨日首板今日2连板+比例"以明确口径

**C. 闸门熔断联动（regimeGate.ts）：**
- 核对确认 regimeGate 使用的 promotionRate 与 App.tsx 同源（均来自 overview.promotionRate）
- 更新 FUSE_PROMOTION_RATE 注释，明确为"昨日首板今日继续封板比例 < 10%"

**效果**：
- 涨停板页"晋级率"数字准确反映昨日首板今日继续封板比例
- 闸门熔断判断使用真实晋级率数据，不再被错误触发
- 无昨日快照时显示"—"而非错误近似值

---

## v9.8.8 — 修复：情绪分源头在数据缺失时返回 null（根因） (2026-07-31)

修复：App.tsx 在涨跌家数接口失败时把 sentiment 算成 50（误导性默认值），改为 null + 回退昨日有效值；sentimentStore 不再跳过 50 的保存（原逻辑 `if (score === 50) return` 导致数据缺失时无记录）。

**A. 情绪分根因修复**：
- `App.tsx`: `sentiment` 类型改为 `number | null`，数据缺失时设为 null 并回退昨日情绪
- `App.tsx`: 所有 `sentiment` 比较（告警/显示）加 null 守卫
- `OverviewData` 接口：`sentiment: number | null`

**B. 存储层修复**：
- `sentimentStore.ts`: 删除 `if (score === 50) return` 过滤（该逻辑导致数据缺失时无法保存，且 50 也是有效情绪值）

**C. 下游组件适配**：
- `StatusBar.tsx`: 情绪分显示改为 `sentiment != null ? sentiment : "—"`
- `Playbook.tsx`: payload 中 sentiment 默认值改为 null（不再默认 50）
- `Dashboard.tsx`: 已通过 `overview?.sentiment` 可空类型兼容

**D. 闸门层联动**：
- `regimeGate.ts` 已在 v9.8.6 中加 null 守卫，此时会返回 "数据不足·暂不给出系数"

**效果**：
- 夜间/周末/接口失败时，情绪分显示"—/数据不足"，不再误导为 50 分
- 闸门/告警/盘前剧本等下游模块收到 null 时统一兜底，不再误判
- 情绪分按交易日冻结存储，有效值（包括 50）均正常保存

---

## v9.8.7 — 新增：全局ErrorBoundary防单点崩溃白屏 (2026-07-31)

新增：全局 ErrorBoundary，单个数据模块崩溃时显示友好兜底页(可一键刷新)而非整页白屏；本地数据保留。

**A. 错误边界组件**：
- 新建 `src/components/ErrorBoundary.tsx`（必须为 class 组件）
- 实现 `getDerivedStateFromError` 捕获错误并更新状态
- 实现 `componentDidCatch` 打印错误日志
- 兜底 UI：⚠️ 图标 + "页面模块异常"标题 + 友好提示 + 错误信息预览 + "刷新页面"按钮

**B. 全局应用包裹**：
- `main.tsx`: 导入 ErrorBoundary，在 StrictMode 内用 ErrorBoundary 包裹 App

**效果**：
- 正常使用不受影响
- 任一组件抛异常（接口返回非预期结构、JSON.parse 失败等）时，显示友好兜底页而非白屏
- 本地数据（自选股/情报库）保留不丢失

---

## v9.8.6 — 修复：市场闸门在情绪数据缺失(0/null)时不再误判为"极度恐慌×0.2" (2026-07-31)

修复：市场闸门在情绪数据缺失(0/null)时不再误判为"极度恐慌×0.2"，改为显示"数据不足·暂不给出系数"；仪表盘情绪分/闸门系数无效时显示"—"。

**A. 闸门计算护栏**：
- `regimeGate.ts`: `GateResult.factor` 改为 `number | null`
- `computeGate`: 最开头插入数据缺失护栏，当 `sentiment == null || !Number.isFinite(s) || s <= 0` 时，返回 `{ factor: null, label: "数据不足·暂不给出系数", reason: [] }`

**B. UI展示兜底**：
- `Dashboard.tsx` GateGauge: 情绪分显示改为 `s != null && s > 0 ? s : "—"`
- `Dashboard.tsx` GateGauge: 闸门系数显示改为 `gate.factor != null ? gate.factor.toFixed(1) : "—"`
- `BattlePlan.tsx`: 闸门系数显示改为 `gate.factor != null ? gate.factor.toFixed(1) : "—"`
- `BattlePlan.tsx`: 所有 `gate.factor >= X` 比较前加 `gate.factor != null &&` 守卫
- `BattlePlan.tsx`: `showNoRec` 条件中 `gate.factor <= 0.3` 改为 `gate.factor != null && gate.factor <= 0.3`

**效果**：
- 夜间/周末/接口失败时，首页"情绪×闸门"卡片显示"— / 数据不足"，不再出现 ×0.2 极度恐慌
- 盘中情绪正常时（如 55），仍正常显示 55 与 ×1.0 等

---

## v9.8.5 — 修复：推荐命中率统计改为真实日K收盘价回填T+1/T+3 (2026-07-31)

修复：推荐命中率统计改为真实日K收盘价回填T+1/T+3(原用当前价冒充)；删除无意义的"个股超额胜率"(同组自比必然≈50%)，改为"T+1上涨率+平均T+1收益"。

**A. 新增日K收盘价接口**：
- `api.ts`: 新增 `fetchStockDailyCloses(code, days=40)`，从 push2his 取日K收盘价，返回 Map<日期, 收盘价>

**B. 推荐归因回填改造**：
- `recTracker.ts`: 导入改为 `fetchStockDailyCloses`
- `runAttribution`: 改为按日期取历史收盘价回填 T+1/T+3，真实计算涨跌幅
- 旧的"当前价近似"逻辑彻底移除

**C. 命中率统计口径改造**：
- `HitRateStats` 接口：删除 `alphaWinRate`，新增 `avgT1` (平均T+1收益%)
- `computeHitRates`: 改为统计 T+1上涨率 + 平均T+1收益率
- `getHitRateText`: 文案改为"近20次推荐 · T+1上涨率X% · 平均T+1±Y%"
- `getHitRateForPrompt`: 文案改为"近N次推荐统计：T+1上涨率X%，平均T+1收益Y%（样本N条）"

**效果**：
- 作战卡底部文案不再出现"个股超额 X%"，改为"T+1上涨率… · 平均T+1…"
- 盘后自动归因后，旧推荐记录的 pctT1/pctT3 基于真实收盘价（F12 可见 `kline` 请求按 code 取日K）
- 样本<20 时显示"样本积累中"，不再提前展示误导百分比

---

## v9.8.4 — 容量说明P3：累积库扩容+诚实标注+命名确认 (2026-07-31)

优化：累积库硬上限6000→10000、UI显示最早保留日期并标注"网页存储有限、月级追溯待本地PostgreSQL"；确认情报台与AI督导用户标题已区分。

**A. 累积库容量透明化**：
- `dataStore.ts`: 硬上限 `HARD_LIMIT = 6000` → `10000`
- `IntelligenceDashboard.tsx`: 状态条显示最早保留日期 `累积库{stats.totalCount}条（最早{stats.oldestDate}）`
- 添加容量说明："网页存储容量有限，仅保留近期数据；完整月级追溯请在本地部署后接入 PostgreSQL（存储抽象层已就绪）"

**B. 命名确认**：
- 情报台 = 🧠 全栈情报分析台
- 督导 = 💬 AI交易督导
- 两个面板标题清晰区分，用户不混淆

**效果**：
- 用户能看到累积库真实保留范围
- 知道网页存储有限，月级追溯需本地 PostgreSQL 部署

## v9.8.3 — 一致性P2修复：健康接口名+AI降级标识+北向资金 (2026-07-31)

修正：健康面板接口名与实际请求对齐(全球指数/商品汇率/主力资金/板块资金流/板块成分股/个股行情/个股公告)；个股雷达AI研判增加规则版降级标识；确认北向资金仅显示断供提示。

**A. 健康面板接口名修正**：
- fetchCommodities: "板块资金流" → "商品汇率"
- fetchGlobalIndices: "板块成分股" → "全球指数"
- fetchMarketMainFund: "全球指数" → "主力资金"
- fetchBoardFundFlow: "商品汇率" → "板块资金流"
- fetchBoardConstituents: "个股行情" → "板块成分股"
- fetchStockOne: "板块资金排行" → "个股行情"
- fetchStockAnnouncements: "资金历史" → "个股公告"

**B. AI降级统一标识**：
- callLLM 返回类型改为 `{ text: string; degraded: boolean }`
- 详细研判/追问/批量扫描处均解构 degraded 字段
- AI研判结果标题处，当 degraded 为真时显示 "⚡ 规则版" 红色角标

**C. 北向资金确认**：
- FundStructure.tsx 两融卡片仅显示"数据待接入"，无数字误导

**效果**：
- 健康面板各接口名与Tab实际数据对应正确
- 个股雷达AI研判在AI不可用时出现"⚡规则版"角标
- 资金结构区北向资金只显示接口断供，无数值误导

## v9.8.2 — 链接P1修复：海外指数+隔夜品种可点击 (2026-07-31)

修复：全球信号海外指数链接改用 globalMarketUrl(原用中文名拼URL致404)、补全韩国/台湾；隔夜关联品种(金/油/铜/美元/人民币)改为可点击真实行情链接。

**A. 海外指数链接修复**：
- `GlobalSignals.tsx`: 海外指数 href 改用 `globalMarketUrl(idx.name)`
- `realLinks.ts`: `globalMarketUrl` 补全韩国KOSPI/台湾加权映射

**B. 隔夜品种可点击**：
- `realLinks.ts`: 新增 `commodityUrl` 函数，支持美元指数/人民币/黄金/原油/铜
- `GlobalSignals.tsx`: 隔夜关联品种 `<div>` 改为 `<a>`，使用 `commodityUrl`

**效果**：
- 点击纳斯达克100/恒生指数/韩国KOSPI/台湾加权等能正确跳到东方财富对应指数页（不再404）
- 点击黄金/原油/铜/美元/人民币卡片能跳到对应商品行情页

## v9.8.1 — 数据源P0修复：龙虎榜/解禁切JSONP+成交额历史修正 (2026-07-31)

修复：龙虎榜/解禁查询切JSONP绕过CORS；成交额历史修正beg参数(原beg=0返回1990数据)、顺序请求+10分钟缓存+重试规避限流。

**A. 龙虎榜 + 解禁查询切 JSONP**：
- `fetchDragonTigerList`: `fetch(...)` → `trackedJsonp("龙虎榜", url, 12000, "callback")`
- `fetchDragonTigerSeats`: `fetch(...)` → `trackedJsonp("龙虎榜席位", url, 10000, "callback")`
- `fetchLiftBan`: `fetch(...)` → `trackedJsonp("解禁", url, 8000, "callback")`

**B. 成交额历史完全重写**：
- 修正 `beg=0` 返回1990年远古数据 → 改用 `ymdPlus(-(days + 15))`
- 顺序请求沪深两市，降低 push2his 并发
- 模块级缓存 10 分钟（成交额为日级数据）
- 单调用重试退避（2次尝试，间隔900ms）

**效果**：
- 龙虎榜 Tab 正常显示个股与席位（不再空）
- 健康面板"成交额历史"从 0% 逐步变绿
- 个股雷达"解禁否决项"能正常判定

## v9.8 — 督导室全站数据聚合：AI接收所有可用信息回答任何问题 (2026-07-31)

**需求**：AI底座需接收所有信息，基于全栈数据回答任何问题。

**根因**：督导室仅提供部分数据（市场快照+自选股），缺失全市场公告/实时快讯/板块资金流/涨停池详情等关键信息。

**修复**：buildSupervisorPrompt 改造为全站数据聚合器，包含9大维度：
① 市场盘面（情绪分）
② 市场整体行情（指数/涨跌家数/成交额/主力资金）
③ 情报台结论（阶段/主线/趋势/指引+全盘分析）
④ 板块情绪统计
⑤ 涨停池详细信息（涨停数/炸板数/炸板率+前15只个股）
⑥ 全市场公告（最近10条，含股票代码和标题）
⑦ 实时快讯（最近10条，含时间）
⑧ 板块资金流Top（净流入/净流出前5名）
⑨ 自选股详情（行情+消息正文+公告）

**效果**：AI现在可基于全站9大类真实数据回答任何问题，无信息盲点。

## v9.7 — 督导室信息盲点修复：接收完整行情+消息正文数据 (2026-07-31)

**根因**：督导室 buildSupervisorPrompt 只传递消息标题，未包含消息正文(summary)和个股行情数据，导致AI回答时信息严重不足，用户询问"个股表现如何"时只能基于标题猜测。

**修复**：
① **添加市场整体行情**：指数行情(上证/深证/创业板等价格涨跌) + 涨跌家数统计 + 成交额数据，构建完整市场快照
② **丰富自选股数据**：
   - **行情维度**：价格、涨跌幅、主力净流入(万)
   - **消息维度**：标题 + 正文摘要（之前只传标题，现在包含 `summary.slice(0,80)`）
   - **公告维度**：标题列表
③ **支持历史日期查询**：指定日期时拉取该日自选股历史消息，行情数据仍为当天实时数据
④ **格式优化**：消息标签改用方括号`[利好]``[利空]``[中性]`，数据分隔符统一为" | "，提升AI解析准确性

**效果**：用户询问"我的关注个股面表现如何"时，AI可基于真实价格/涨跌/资金流向+完整消息内容给出准确分析，而非仅依赖标题关键词匹配。

## v9.6 — 督导室AI回答质量修复(system/user分离+专用任务) (2026-07-31)

根因：督导室走stockJudge任务，system用"复盘分析师"角色+数据和指令混在user里→AI复述数据不回答问题。
修复：
①新增supervisor任务(aiPrompts.ts)：system/user由IntelligenceDrawer构建透传，不复用SYSTEM_PREFIX
②SUPERVISOR_SYSTEM专用角色指令："问什么答什么/自然段落/像操盘手说话/不要复述数据标签"
③buildSupervisorPrompt返回{system,user}分离：system=角色指令+日期提示，user=数据快照+用户问题
④supervisor任务参数：temperature=0.4(更自然) maxTokens=4000 thinking=false(避免思考模式空内容)
⑤数据标签改为可读文本(情绪温度计/情报台研判/涨停池)，不再用【】包裹数据块

## v9.5.1 — 盘中驾驶舱补回MarketOverview+PopularityRadar (2026-07-31)

盘中(trading)布局左侧补回指数详情(MarketOverview)和人气榜拥挤度(PopularityRadar)，解决盘中时段驾驶舱组件过少的问题。

## v9.5 — 修复思考模式回退链路(核心bug)+超时调至30s (2026-07-31)

核心 bug：thinking=true 返回空时直接 return 降级，不给 thinking=false 回退机会。
修复：
①executeAI 循环重构：thinking=true 空/异常 → continue 回退 thinking=false 再试同端点；thinking=false 也失败 → break 跳下一个端点
②超时 20s→30s（思考模式长 prompt 需要更多时间）
③每一步加 console.warn 日志（端点号+thinking状态+错误原因）
④lastError 贯穿循环，最终降级消息显示真实原因（不再一律"网络错误"）
⑤超时提示文案同步更新 "30s超时"

## v9.4.5 — 修复思考模式"返回内容为空"降级 (2026-07-31)

修复思考模式下 agnes content 为空导致的"返回内容为空"降级：
①ai.ts fetchWithTimeout 解析回退 reasoning_content（思考模式答案在该字段）+ console.warn 日志
②aiPrompts.ts stockJudge max_tokens 从 3000 提至 8000（思考消耗 token，原值太小→只思考没正文输出空间）
③验证：关思考能正常回答→确认是思考字段问题→开思考后 reasoning_content 兜底也正常

## v9.4.4 — stockJudge maxTokens调至8000 (2026-07-31)

TASK_CONFIG.stockJudge.maxTokens从3000调至8000：思考模式消耗token，原值太小导致模型只思考没空间输出正文→content空。agnes免费且输出上限65K，8000无压力。

## v9.4.3 — callAI兼容思考模型(reasoning_content fallback) (2026-07-31)

fetchWithTimeout响应解析：content空时回退读reasoning_content(思考模式下agnes把答案放该字段)，并console.warn打印finish_reason+raw便于F12排查。

## v9.4.2 — 督导室日期识别重构(parseQueryDate+getAllOnDate) (2026-07-31)

①督导室日期解析器改用parseQueryDate(返回{ymd,dash})，支持"7.30"点号分隔+昨天/前天/M月D日/YYYYMMDD
②板块统计改用getAllOnDate精确取该日(不再getAllSince+filter)
③情报台结论标签带日期"(2026-07-30)"
④自选股整段用if(!qd)包裹(识别到日期时跳过，专注市场总结)
⑤系统Prompt追加日期场景提示"用户问的是【日期】的消息面"
⑥占位示例改为"7.30怎么样/对昨天做个总结"

## v9.4.1 — 情报台"分析该日"重构 (2026-07-31)

①dataStore新增getAllOnDate()精确取某日全部素材(无范围模糊)
②情报台UI分两行：第一行=范围选择+立即分析，第二行=date input+📅分析该日（紫色按钮独立）
③runIntelligence用getAllOnDate替代getAllSince+plusDays过滤hack，指定日期分支更干净
④结果进分段时间轴manual槽可回看；数据不足时诚实显示"0条快讯+0条公告"

## v9.4 — 板块表修复+情报台指定日期+督导日期识别 (2026-07-31)

①boardMap增加构建日志+forceRebuildBoardMap强制重建(SettingsModal加"🔄重建板块表"按钮，返回词表/映射条数)
②情报台"立即分析"支持指定日期(date input精确取该天dataStore数据，按钮文案动态显示)
③督导室自动识别用户提问中的日期(昨天/前天/N天前/上周X/YYYY-MM-DD/MM月DD日等)，切换到该日期的情绪分+情报memo+板块统计+涨停快照，历史日期跳过自选股实时拉取
④督导室占位文案增加日期示例提示

## v9.3.1 — 督导Prompt升级全站快照版 (2026-07-31)

作战督导室 buildSupervisorPrompt 升级为全站快照版：覆盖市场盘面(情绪分)+情报台结论(阶段/主线/趋势/指引)+板块情绪统计(代码计数→formatStatsForPrompt)+自选股真实新闻公告，模型基于完整仪表盘数据回答，禁编造。

## v9.3 — 告警去重+督导接地+信息摘录 (2026-07-31)

①alertBus 冷却判断移到流水入口前，同id 15分钟内彻底不入流水不通知 ②App.tsx 告警改跃迁护栏(false→true才报一次，sentiment≤0/资金缺失不报) ③作战督导室改接地式prompt(拉自选股真实新闻/公告喂模型，禁编造数字) ④Dashboard新增ImportantFeed重要信息摘录(真实新闻+公告带标签/链接/摘要)。

## v9.2 — 情报台重构完成 (2026-07-31)

v9.2：①情报台分段改段末触发+终盘22点后补跑+刷新不重跑 ②分析接入涨停梯队/炸板率(市场在交易什么) ③智能窗口(凌晨/早盘不足自动往前补) ④手动全量分析+范围选择器(今日/近3/7/30天) ⑤板块归类全数据驱动(行业f128+概念实时表，消除硬编码) ⑥右上角多模型设置面板 ⑦修复成交额历史接口(beg参数+顺序请求+缓存重试)

## v9.1.2 — 情报台核心逻辑升级 (2026-07-31)

IntelligenceDashboard: ①手动分析加范围选择器(今日/近3天/近7天/近30天)走 manual slot 可进时间轴回看 ②自动触发改智能窗口(当日不足25条自动扩至3天) ③终盘(final)加宽1天取数 ④状态行动态显示"手动·近N天"或slot名 ⑤IntelSlot 类型新增 manual。

## v9.1.1 — 修复成交额历史接口 (2026-07-31)

修复成交额历史接口——修正 beg 参数(原 beg=0 返回1990年远古数据)、沪深改顺序请求降低 push2his 并发、加 10 分钟缓存与重试以规避东财限流空响应。

## v9.1 — 多模型设置中心 + ⚙️ 设置弹窗 (2026-07-31)

新建 aiSettings.ts 多厂商设置存储（Agnes/DeepSeek/智谱/Moonshot/通义/OpenAI/自定义 7 家预置，OpenAI 兼容协议），自动迁移旧 llm_api_key；ai.ts 改为从 settings 读取 model/baseUrl/thinking/maxTokens（Agnes 保留双域名备选）；新建 SettingsModal.tsx 深色弹窗（厂商选择自动填充+编辑+Key显示隐藏+思考开关+maxTokens+测试连接+AI统计+清空缓存/素材库/导出记忆）；TopNav 右上角加 ⚙️ 入口。

## v9.0.2 — 板块归类改数据驱动 (2026-07-31)

板块归类改为东方财富真实数据驱动，消除全部硬编码，行业+概念全覆盖。新建 boardMap.ts 每日构建全市场股票→行业映射(f128)+真实板块词表(行业100+概念500)，新闻用文本匹配动态词表、公告用代码→行业精确匹配；产业链追溯下拉动态化(含自由输入)并展示新闻+公告混合时间线；intelStats 公告进入真实板块统计桶。

## v9.0.1 — 情报台段末触发+limitPool接入+刷新防重跑 (2026-07-31)

IntelligenceDashboard 三项修正：①分段触发改为段末时间窗（pre 8:30-9:14 / morning 11:25-11:35 / noon 14:55-15:05 / afterclose 15:05-22:00 / final 22:00+不限），在数据最完整时生成分析；②runIntelligence 新增 fetchLimitPoolSummary 取涨停梯队/炸板率/最高板作为"市场在交易什么"的硬证据传入引擎；③triggeredSlots 持久化到 localStorage（intel_triggered_YYYYMMDD），刷新页面不重跑已完成的分段。

## v9.0 — 全栈情报分析台重构完成 (2026-07-31)

修复全栈情报分析台：①全天自动累积新闻+公告（去重/带正文/带标签，localStorage 持久化、30 天滚动、可产业链追溯，已为 PostgreSQL 预留抽象层）②代码完成全部计数统计，模型只做研判、强制每条结论标注来源 ③按盘前/早盘/午盘/盘后分段输出 + 22:00 终盘总结 ④新增市场在交易什么/趋势研判 ⑤max_tokens→3000、开 thinking。

## v8.9.4 — 阶段五：App接线完善 (2026-07-30)

App→NewsPanel strongBoards 增加 boardRank.inflow 二级回退（mainline 未就绪时用 boardRank 概念板块净流入 Top5），确保情报分析台从首次渲染即有真实强势行业名，不再默认空。

## v8.9.3 — 阶段四：情报台UI重构 (2026-07-30)

IntelligenceDashboard 重写：分段触发(pre/morning/noon/afterclose/final各只触发一次)+22:00终盘用全天累积数据；展示新增「市场在交易什么」+「当前趋势」两大块；所有核心事件展示可点击📎来源；新增产业链追溯视图（选板块→30天相关新闻倒序列表）；新增分段时间轴（当日快照可切换查看各阶段主线变化）。

## v8.9.2 — 阶段三：情报引擎重写 (2026-07-30)

newsMemoStore v2: 新增 whatMarketTrades/trend 字段 + 分段存储(saveSegmentMemo/getSegmentMemos) + 30天覆盖分段key；aiPrompts stockJudge maxTokens 800→3000 + thinking开启；llmNewsIntelligence 重写：用 computeStats 代码统计 + formatStatsForPrompt/formatMarketBlock/pickTopSourced 构造 Prompt（模型只做研判不数数）、强制每条结论标注 source、source→url 溯源匹配（精确→包含）、找不到标⚠️未溯源、按 slot 分段/终盘写盘。

## v8.9.1 — 阶段二：累积写入接通 (2026-07-30)

AnnouncementPanel 每次拉取后自动 upsertAnnouncements 到 dataStore；NewsPanel 每次 enrichNews 后自动 upsertNews（带 summary/isOverseas）；新增 marketSnapshot prop 从 App 传入（sentiment/指数/主力净额）；IntelligenceDashboard 接收 slot/marketSnapshot 为下阶段 Prompt 分段准备。

## v8.9 — 重构全栈情报分析台 (2026-07-30)

重构全栈情报分析台：①全天自动累积新闻+公告（去重/带正文/带标签，localStorage 持久化、30 天滚动、可产业链追溯，已为 PostgreSQL 预留抽象层）②代码完成全部计数统计，模型只做研判、强制每条结论标注来源 ③按盘前/早盘/午盘/盘后分段输出 + 22:00 终盘总结 ④新增市场在交易什么/趋势研判 ⑤max_tokens→3000、开 thinking。

## v8.8 — 全栈情报分析台真实数据接入 (2026-07-30)

修复全栈情报分析台：①接入真实公告与新闻正文（不再恒为空）②放开 max_tokens=3000 并开启 thinking ③Prompt 强制只基于真实素材归纳且每条结论标注来源 ④UI 展示可点击来源。

## v8.7 — 工程卫生清理+AI中枢统一迁移+情报数据穿透 (2026-07-30)

V8.7 工程整治：修复全部14个 tsc 未用 import 警告达成零错误编译；删除4个废弃组件(KeyIndicators/Mainline/Pitfalls/StockMonitor)；StockWatchlist 个股研判与 DailySummary 复盘两处 LLM 调用从直连 AGNES 域名迁移到 callAI 统一中枢（享受缓存/限速/降级），全仓 AGNES 直连引用清零；IntelligenceDashboard 全栈情报台接入真实强势板块数据（从 mainline.boards 净流入 Top5 透传），替代空数组占位。

## v8.6 — AI交易督导侧边窗 (2026-07-30)

V8.6 新增：于网页右上角部署「💬 AI交易督导窗」(Intelligence Drawer)，按键呼出不遮挡底层的半屏客服式交互空间。集成【警报&公告时间线】与【作战督导会话】，支持对任何盘中异动、利好快讯点击「一键向AI核实」，Agnes 2.5 会基于你的持仓标的与主线周期长线记忆给出即时游资操作督导。

## v8.5 — 消息全栈分析台 (2026-07-30)

V8.5 新增：把消息面升级为全栈情报分析台；结合过往5日历史情报记忆、资金共振情况以及当日精选重磅公告，由 Agnes 2.5 Flash 输出明确的【题材生命周期定位（启动/发酵/高潮/分歧/退潮）】、【利好聚集行业】和【短线避坑进攻指引】，每日20:30自动存储长效记忆，终结仅靠标题粗粗打标分类的历史。

## v8.4 — 情报金字塔记忆库 (2026-07-30)

V8.4 新增：设立 src/lib/newsMemoStore.ts 金字塔长周期记忆库，支持自动持久化存储每日主线定格数据（保留30个交易日）；在消息面板增加「一键导出 JSON 备份 / 导入恢复」开关，摆脱纯静态网页数据易失的痛点，为 AI 长上下文研判奠定历史记忆基础。

## v8.3.2 — 全局板块分类法 (2026-07-30)

V8.3.2 板块口径整治：新建 boardTaxonomy 全局分类（白名单>规则>频道），东财概念频道混入的持股主体/业绩标签/风格标签/地域板块被系统性识别隔离；作战卡改 行业（t:2)+过滤题材（t:3) 双轨候选池，行业与涨停池hybk同源直配根治梯队归并；资金主线主推区仅行业+题材，风格标签收进"市场结构观察"折叠组作情报参考；高低切与明暗盘输入同步净化。

## v8.3.1 — 推荐输出改排名制+置信档 (2026-07-30)

V8.3.1 热修复：综合分绝对门槛(<60不推）与中性默认分堆叠导致常态零推荐——改为排名制TopN输出+A/B/C置信档，闸门仅压缩数量不参与总分；ETF资金维接入f164真实5日净额；梯队归并改双向模糊匹配+别名表；新增?debug=1评分诊断模式与候选观察池。

## v8.3 — 推荐归因闭环 (2026-07-30)

V8.3 归因闭环：推荐落盘signalLedger，盘后自动计算T+1/T+3方向命中率与个股超额胜率，注入周复盘上下文，作战卡显示近20次滚动胜率，形成推荐→验证→复盘自改进回路。

## v8.2 — LLM 消息维度接入 (2026-07-30)

V8.2 LLM消息维度：Agnes 2.5 Flash 批量评估题材催化与个股消息（严格JSON+容错解析+钳制校验），消息权重随题材阶段动态浮动（启动30/发酵20/高潮10），渐进式渲染先规则后LLM，限速日缓存预算内运行，失败自动降级规则版。

## v8.1 — 盯盘作战舱布局 + 提醒中枢三通道 (2026-07-30)

V8.1 作战舱：驾驶舱重构为时段驱动布局（盘前预案/盘中作战/盘后复盘），新增 alertBus 提醒中枢（预警流水/标题闪烁/WebAudio声音/系统通知，15分钟冷却），自选股异动带，涨停温度计横条，题材梯队缩略卡。

## v8.0 — 作战推荐引擎（规则机版） (2026-07-30)

V8.0 新增作战推荐引擎（规则机版）：市场闸门×（板块35/25/20/20 + 个股30/25/20/15/10 + ETF 40/35/25）三层评分，一票否决先行，推荐带因子分解与失效条件，低闸门期自动收缩为仅ETF。

## v7.7 — 情绪温度计接入昨日涨停溢价与连板晋级率因子 (2026-07-30)

V7.7 新增：情绪温度计引入两个超短因子——昨日涨停股今日平均涨幅（隔日赚钱效应，±5 分）与 2 板→3 板晋级率（±5 分），并新增市场最高连板高度展示（不计分）。数据来自本地昨日涨停池快照+单次批量行情查询，无新增高频请求。昨日快照缺失时因子显示数据积累中且不计分，不以 0 分冒充。

## v7.6 — 涨停池快照写入提升到主刷新管道 (2026-07-29)

V7.6 修复：涨停池快照原本仅在打开龙虎榜复盘 Tab 时写入，导致未打开该 Tab 的日期无快照，高低切切换检测与断板检测次日静默失效。现将快照保存/读取抽为 src/lib/ztSnapshot.ts，并在 App 主刷新管道中每次拉取涨停池后立即写当日快照；快照 key 优先采用接口返回的真实交易日 qdate（兼容法定节假日），昨日快照改为"取最近一条历史快照"而非本地日期推算。

## v7.5 — 修复明暗盘模块运行时崩溃 (2026-07-29)

V7.5 修复：DarkPool 明暗盘模块因引用未定义变量 marketTotalFlow 在运行时崩溃，被 catch 静默，导致面板永久不显示数据；补全变量定义（取全市场主力净流入 f62)。同时修正明暗盘失败提示文案中明盘/暗盘定义颠倒的错误（明盘=超大单+大单，暗盘=中单+小单）。

## v7.4 — 产业链价格监控 (2026-07-29) (commit: 0f92ce5)

> 产业景气价格盯梢（波段机构的"季前信号"）。数据源以期货行情为代理，全部探测兜底。

- **品种监控表** (`src/lib/commodities.ts`)：
  - 8个品种：碳酸锂/工业硅/生猪/螺纹钢/沪铜/原油/黄金/白银
  - 每品种含 `secidCandidates`（候选 secid 数组）、`chain`（传导链一句话）、`relatedBoards`（相关概念板块）
  - 运行时用 `ulist.np/get` 逐个探测取第一个有数据的；全部失败→该品种剔除
- **产业链价格卡片** (`src/components/CommodityChain.tsx`)：
  - 位置：资金主线 Tab（与全球信号平行）
  - 每品种一行：现价/日涨跌/近5日%/近20日%
  - 近5/20日走 push2his kline(klt=101)，每品种每天只拉一次，存 `cmd:YYYY-MM-DD:name` 缓存
  - 一个品种都拿不到→整卡显示"待接入"
- **拐点标记**：
  - 口径：近20日%由负转正 或 |近20日%|>15% → amber高亮"拐点确认中"
  - 注释说明：先于财报的景气信号，大宗价格拐点通常领先企业盈利拐点1-2个季度
- **板块传导联动**：
  - 品种名 hover 显示 chain 传导逻辑 tooltip
  - 末列显示 relatedBoards 对应概念板块今日涨跌幅
  - 复用 mainline.boards + darkPool.topBoards 已有数据做名称匹配，零新增请求
  - 匹配不到显示"—"
- 卡片底部注明："现货价（生意社等）待本地部署阶段接入"

## v7.3 — 席位溢价库 (2026-07-29) (commit: e7601d4)

> 龙虎榜席位从"当日展示"升级为"溢价数据库"，靠时间沉淀积累席位画像。

- **席位台账** (`src/lib/seatLedger.ts`)：
  - 每次拉取龙虎榜成功后增量写入 `seats:YYYY-MM-DD`
  - 字段：deptName/stockCode/stockName/direction/net/closeAtDay + T+1/T+5 回填字段
  - 同日同席位同股票同方向不重复写；保留120个交易日，超出删最旧
- **席位档案** (`src/lib/seatProfiles.ts`)：
  - 将龙虎榜原有游资标签库迁移统一维护（14条规则覆盖机构/北向/知名游资/量化）
  - 导出 `matchSeatTag()` 和 `isHotMoneySeat()`
  - DragonTiger.tsx 标签匹配改为引用本文件
- **T+1/T+5 溢价回填**：
  - 复用 push2his 日线接口（kline/get），每天检查2-15天前未回填记录
  - 批量查询个股收盘价序列，计算 T+1/T+5 涨跌幅
  - 回填失败跳过等明天，不阻塞页面
- **席位画像卡片**（龙虎榜 Tab 新增）：
  - 按 deptName 聚合近120日买入方上榜记录
  - 显示：出现次数 / T+1平均涨幅 / T+1胜率
  - 样本<5 标"样本积累中"
  - 分级：T+1均值>2% → 红标"高溢价"；<-1% → 灰标"负溢价"
- **合力/独食标记**：
  - ≥3家不同游资席位同买一只 → 🤝"合力"标
  - 单一席位净买占该股榜单净买>60% → 🍽"独食·接力风险"标
  - 信号条显示在龙虎榜列表上方 + 个股行内标记

### 工程
- `DragonTiger.tsx` 完全重写：引用 seatProfiles/seatLedger，删除内嵌标签库
- 龙虎榜现有功能（列表/席位展开/上榜原因/净买Top5）全部保留
- HistoryPerformance 统计精简，由席位画像+台账回填接管溢价分析

## v7.2 — AI 四模块接入 (2026-07-29) (commit: 7483193)

> 公告归因 / 梯队把脉 / 快讯三行 / 周报教练，全走 v7.0 中枢 callAI + parseAIJSON。

### 1. 公告归因 annRank
- 触发：淘金区新★★/★★★条目出现时批量调用(≤15条)；每日18:30兜底补全量
- 输出：纯 JSON 数组 `[{code, theme, score(1-5), logic, watch}]`
- 解析：统一 `parseAIJSON(text, ["code","score"])`，坏元素丢弃保留其余
- 展示：公告行末显示 `AI5`~`AI1` 评分徽章（≥4绿/≥3黄/其他灰），hover 显示 logic+watch
- AnnouncementPanel 存 `ai:annrank:YYYY-MM-DD` 缓存

### 2. 梯队把脉 ladderScan
- 触发：交易时段每15分钟 + 收盘一次（挂交易时段状态机）；限速命中→顺延到下一窗口
- 输入：题材梯队前5组 + 情绪分 + 炸板率 + 断板名单
- 输出：【周期定位】【明日看点≤3】【断板风险≤3】
- 新组件 `LadderPulse.tsx`，放驾驶舱右列资金速览下方
- 规则版：按(涨停数/炸板率/最高板)阈值表输出周期定位

### 3. 快讯三行 newsDigest
- 触发：消息面Tab盘中每30分钟自动 + 手动刷新按钮
- 输入：最近快讯标题(≤60条)
- 输出：恰好3行【政策面】【资金/市场面】【外围/风险】每行≤40字
- 固定在快讯滚动条上方（不参与滚动），violet 主题色
- 规则版：按关键词库粗筛出各维度第一条

### 4. 周报教练 weeklyCoach
- 触发：周五15:30后 或 周末首次打开
- 输入：本周预案本全部条目 + aiReview + 执行度 + 情绪分序列
- 输出：【纪律执行率X%】【重复错误模式≤2条引日期】【下周动作恰好2条】
- 新组件 `WeeklyCoach.tsx`，放驾驶舱右列预案本下方
- 存 `weekly:YYYY-Www`，保留最近8周可回看

### 工程
- `aiPrompts.ts`：annRank/ladderScan/newsDigest/weeklyCoach 模板 + 分级参数 + 完整 fallback
- 全部 JSON 任务统一 `parseAIJSON` 解析（围栏/前言/尾注鲁棒处理）
- 断网降级：四卡全部显示规则版+角标，无白屏
- 无免责措辞

## v7.1 — AI 盘前剧本与盘后对照 (2026-07-29) (commit: e04ef84)

> 走 v7.0 中枢 callAI，打通"剧本→对照"核心闭环。

### A：盘前剧本 (preopenPlan)
- **触发**：每天 8:00-9:25 首次打开驾驶舱且当日无缓存时自动调用
- **payload（T-1 口径）**：昨日情绪分+标签/涨停数+炸板率+最高板/题材梯队前3/公告★★★种子/隔夜外围涨跌幅/日期；缺失项标"无该项"
- **输出契约**：【今日主线假设】【出手条件≤3】【风险红线≤2】【备选剧本】
- **自动填入**：结果提取出手条件等自动填入预案本输入框（用户可改，09:30 照常锁定）
- **角标**：`AI生成 HH:mm`；degraded 时角标"规则版"
- **重新生成**：按钮直接可用，限速时置灰60秒提示"请求过频，稍候"
- **规则版 fallback**：按情绪分档位（≥65/≤35/中性）输出完整四标题框架

### B：盘后对照 (closeReview, thinking=on)
- **触发**：15:05 后首次打开自动 / 预案本点"生成今日对照"
- **payload**：当日预案原文 + 今日情绪分/涨停跌停炸板率/梯队变化/主线板块涨跌/警报记录/执行度
- **输出契约**：【剧本命中度 X/3】【偏差归因 引数字】【明日剧本草案 3条】
- **持久化**：写入 `playbook:YYYY-MM-DD.aiReview`；degraded 时同样写入标"规则版"
- **周视图**：新增"AI命中度"列，从 aiReview 中正则提取 X/3

### 工程
- `AITaskPayload.preopenPlan` / `closeReview` 丰富为完整字段结构
- `Dashboard.tsx` 新增传入 globalData / mainline 到 Playbook
- `App.tsx` Dashboard 渲染点传入 globalData / mainline
- 全站 AI 相关"仅供参考"措辞已清除（DailySummary/StockWatchlist）

## v7.0 — Agnes2.5 统一 AI 中枢 (2026-07-29) (commit: d632970)

> AI 全面接入的地基：官方 cn 域名双活 / 任务分级参数 / 缓存限速 / 单飞 / 鲁棒 JSON 降级。

- **AI 中枢** (`src/lib/ai.ts`, 310行)：
  - `callAI(task, payload)` → `{text, fromCache, degraded, latencyMs}`
  - **官方域名双活**：`AGNES_ENDPOINTS = [.cn(主), .com(备)]`，网络层错误自动切备用重试
  - **Thinking 模式**：按 `chat_template_kwargs: {enable_thinking:true}` 开启；报错自动降为普通调用再试
  - **分钟限速**：`AI_RATE_PER_MIN=10` 滑动窗口，命中直接走规则版不排队
  - **缓存**：`ai:cache:task:日期:hash` 存 localStorage，同日命中 fromCache=true；超300条按时间删最旧
  - **单飞**：同 key 在途只一个 Promise
  - **降级链**：切域名重试→仍失败→规则版(degraded=true)；20s超时同理
  - **`parseAIJSON()`**：剥除围栏→正则提取`[...]`/`{...}`→JSON.parse→数组逐元素校验
  - **统计**：`ai:stats:YYYY-MM-DD` 记录 calls/totalLatency/failures；导出 `getAIStats()`
  - **顶栏**：🤖 图标旁显示"今日AI X次"
  - Key 在前端仅供自用，注释标明后续迁移服务端代理
- **模板库** (`src/lib/aiPrompts.ts`, 210行)：
  - 共享 system 前缀（禁免责/禁模糊/引数值/分段≤3行）
  - 8个任务 `TASK_CONFIG` 分级参数表（temperature/maxTokens/thinking）
  - 每个任务含 prompt 构建器 + 规则版 fallback
- **全仓域名统一**：
  - DailySummary.tsx / StockWatchlist.tsx：删除硬编码域名，改用中枢常量+主备双活
  - grep `agnes-ai.com` 仅剩 ai.ts 备用域名一处 ✅
- **回归**：现有个股 AI 研判/盘后复盘功能保持原样可用（域名切换为 .cn 主+.com 备）

## v6.7 — 人气榜拥挤度反向指标 + 高低切切换警报 (2026-07-29) (commit: ec762a9)

> 两个情绪结构指标：散户关注度反向参考 + 资金高低切换预警。

### 第一部分：人气榜拥挤度（反向指标）
- **接口探测** (`fetchPopularityRank` in api.ts)：
  - POST `emappdata.eastmoney.com/stockrank/getAllCurrentList`
  - 先 fetch 尝试，CORS 失败 → 整卡片显示"待接入"，禁止假数据
  - 带 `recordApiCall` 遥测
- **拥挤度雷达卡片** (`PopularityRadar.tsx`)：
  - 放驾驶舱右列底部（Dashboard.tsx 内）
  - Top50 按代码段集中度统计，同段 ≥8 只 → 红字"拥挤度极高：历史经验对应派发窗口"
  - 与昨日 Top50 对比（存 `popularity:YYYY-MM-DD`），新进榜标"新入榜"绿色
  - 无昨日数据标"首日运行"；只保留最近5日快照
  - 卡片顶部固定口径说明："本榜为散户关注度，用作反向参考"

### 第二部分：高低切切换警报
- **纯函数** (`detectHighLowSwitch` in themeLadder.ts)：
  - 条件A（旧主线熄火）：近5日主力净流入 Top3 题材，今日涨幅<0（放量不涨）
  - 条件B（新题材脉冲）：某题材昨日涨停 0 只、今日 ≥3 只首板
  - 阈值全部提为命名常量并注释依据：
    - `OLD_MAINLINE_TOP_N=3` / `OLD_MAINLINE_PCT_THRESHOLD=0`
    - `VOLUME_AMPLIFY_RATIO=1.2` / `NEW_THEME_MIN_FIRST_BOARD=3`
- **三级警报集成** (App.tsx + AlertBanner.tsx)：
  - A+B 同日成立 → amber 级："资金高低切：资金从[旧]撤出迹象，[新]首板脉冲，关注换边"
  - 仅B → info 级："新题材首板脉冲：[题材]"
  - 昨日快照缺失 → 不触发警报（首日运行静默）
- **AlertBanner 升级**：新增 `info` 级渲染（灰色底小字），与 critical/warning 平行
- **调试开关**：URL `?simulate=1` 用构造数据演示两种警报样式
  - 模拟：旧主线=[AI概念/半导体]熄火，新题材=[低空经济]脉冲
  - 注释标明仅供验证，正常访问不触发

### 工程
- 数据复用：高低切使用 mainline.boards（已拉取的板块资金流）+ overview.limitPool.rawZTPool（已拉取的涨停池），零新增请求
- 昨日快照复用 ThemeLadder 的 `ztpool:YYYYMMDD` 存储
- 人气榜探测失败不影响其他模块

## v6.6 — 题材梯队仪表盘 (2026-07-29) (commit: c27468c)

> 涨停池升级为"题材梯队"视角：按行业分组 → 先锋/中军识别 → 梯队完整度 → 断板预警。

- **纯函数模块** (`src/lib/themeLadder.ts`)：
  - 输入 ZTPool 原始数组，输出按 hybk 分组的题材组
  - 每组计算：height(最高连板) / tiers(首板/二板/三板+) / pioneer(最早封板) / bellwether(最大成交额)
  - 排序：height 降序 → count 降序
  - 断档检测：高度≥2但缺少中间层级→标记 gapTiers
  - 断板检测：比对昨日快照，lbc≥3且今日不在池→返回断板列表
  - 纯函数，不碰 DOM / localStorage / 网络
- **题材梯队卡片** (`src/components/ThemeLadder.tsx`)：
  - 置于"龙虎榜复盘"Tab 顶部
  - 每组一行可展开：题材名 | 高度badge(≥3金色渐变) | 梯队X/Y/Z | 先锋(名+时间) | 中军(名+成交额)
  - 10:00前封板标"早盘先锋"amber标签
  - 梯队缺层灰显"断档"删除线
  - 展开显示组内个股明细（lbc降序：代码/名称/连板/封板资金/换手/成交额/首封/炸板）
- **断板预警**：
  - 每日首次取得 ZTPool 后存快照 (`ztpool:YYYYMMDD`)，只留最近7日
  - 昨日 lbc≥3 且今日不在池 → 卡片顶部红字条"昨日X板[名称]今日断板，警惕中位股风险"
  - 无昨日快照 → 灰显"首日运行"
- **数据复用**：
  - `LimitPoolSummary` 新增 `rawZTPool` 字段，透传已拉取的涨停池原始数组
  - ThemeLadder 通过 `overview.limitPool.rawZTPool` 接收数据，零新增网络请求
  - pagesize 已确认为 500，无需修改

## v6.5 — 盘后公告淘金 (2026-07-28) (commit: d57b496)

> 公告从"个股否决工具"升级为"盘后题材种子库"，全市场扫描+关键词打标+三级评级+增量NEW。

- **全市场公告接口** (`fetchMarketAnnouncements`)：
  - 复用 `np-anotice-stock.eastmoney.com/api/security/ann`，去掉 `stock_list` 参数获取全市场公告流
  - 先探测 `page_size=100`，失败自动降级为 50，再失败显示"待接入"
  - 通过 `trackedJsonp` 走全局队列（并发≤2），与个股公告接口互不干扰
- **公告淘金面板** (`AnnouncementPanel.tsx`)：
  - 置于"消息面"Tab 顶部，作为独立分区
  - **关键词打标**（正则匹配）：利好15词(中标/成交/签订/框架协议/战略合作/投产/量产/涨价/提价/回购/增持/股权激励/实际控制人变更/重组/注入) + 利空8词(减持/立案/警示函/问询/预亏/商誉减值/解禁/质押)
  - **三级评级**：★★★=中标/涨价/投产/重组/控制人变更(置顶+金色左边框) / ★★=合作/增持/回购 / ★=其余利好利空
  - **同股合并**：同一股票多条公告合并显示，计数角标，可展开查看全部
  - **标签筛选**：全部/利好/利空 三按钮切换
  - 列表每行：时间/股票名/彩色标签/标题(截断60字)/星级，点击跳转公告原文
- **增量与缓存**：
  - 15:05-19:00 高峰期每10分钟自动拉取第一页与缓存做diff，新条目打"NEW"绿色闪烁标记
  - 非高峰时段进入时拉一次，不自动刷新
  - 当日结果存 localStorage (`ann:YYYY-MM-DD`)，重开秒读
  - 跨日自动清理，只保留最近5个交易日缓存
- **回归测试**：`fetchStockAnnouncements`（个股否决用）完全未修改，不受影响
- 接口失败时显示"待接入"而非空白，有try/catch兜底

## v6.4 — 盘前预案本 (2026-07-28)

> 决策前置：盘前写剧本→定时锁定→盘后对照→周视图，覆盖复盘的前半环。

- **盘前预案本** (`src/components/Playbook.tsx`)：
  - 三个输入：今日主线假设 / 出手条件(若X则Y) / 风险红线
  - 按日期存 localStorage (`playbook:YYYY-MM-DD`)，跨日期数据隔离
  - **定时锁定**：`LOCK_TIME=09:15` 后自动锁定只读（纪律功能），UI 标注"盘前已锁定"
  - **盘后对照**：15:05 起切换为对照视图，左侧预案原文 vs 右侧今日实际（情绪分/涨停数/炸板率）
  - 盘后单选"是否执行预案"（是/部分/否），写回同一 key
  - **周视图**：折叠区列出本周每天的预案+执行度
  - 数据结构预留 `aiReview`/`updatedAt` 供后续 AI 盘后点评接入
- 挂在驾驶舱右列（Dashboard 组件内）
- 不接新接口，纯 localStorage

## v6.3 — 构建产物级残留清理 + 旧逻辑死活核对 + 工程基线 (2026-07-28)

> 经构建产物 grep 验证 v6.2 声明有残留，本版补齐。

**构建级验证结果（源码级清零）：**
- 字号<11px: 0处 ✅
- 源码 orange/yellow/cyan/sky/blue/purple: 0处 ✅
- prev_sentiment(业务代码): 0处（仅注释中历史说明保留）✅
- 洗盘低吸/诱多出货/拉升做T(业务代码): 0处 ✅
- pz=50(旧串行统计): 0处 ✅

**旧逻辑清除：**
- 北向残留：FundStructure北向卡片删除，App.tsx north字段删除
- 旧涨跌停统计：MarketBreadth.limitUp/limitDown删除，串行pz=50代码删除
- 明暗盘旧模型：judgeFlowType改为四象限（2参数），DarkPool FlowBadge删除旧标签
- 旧情绪存储：prev_sentiment替换为sentimentStore按日存储

**v6.2 勘误**：v6.2 声称"106处字号全部提升、cyan→slate、purple→amber"，实际构建产物仍有残留（LimitBoard渐变色用了orange/yellow、DarkPool FlowBadge保留了旧6组合标签、MarketBreadth仍含limitUp/limitDown字段和串行统计代码），本版v6.3完成真正的构建级清零。

## v6.2 — 字号/色彩语义收敛、移动端优化与路由级分包 (2026-07-28)

> 视觉一致性与性能收尾。

- **全站最小字号≥11px**：text-[7/8/9/10px] 全部提升为 text-[11px]（106处），信息密度改用间距和色彩浓淡解决
- **色彩语义收敛**：
  - 红涨绿跌（数据）、amber（可交互/强调）、灰阶（层级）、rose 仅严重警报
  - cyan → slate（北向/医药标签）、purple → amber（公告标签）
  - violet 保留给 AI 功能区
- **标题统一**：`<title>` 和页脚版本号统一为 "A股实时交易辅助终端 v6"
- **React.lazy 分包**：龙虎榜/个股雷达/消息面改为 lazy + Suspense 按需加载
- 构建产物体积：787KB（singlefile 模式合并后）

## v6.1 — 驾驶舱首页、常驻状态条与三级警报体系 (2026-07-28)

> 首屏改为盯盘驾驶舱，核心信息一屏可见；三级警报替代常驻横幅。

- **驾驶舱首页**（新默认Tab）：左主列=指数+温度计+广度，右列=资金结构+机构资金，一屏展示核心信息
- **常驻状态条**（所有Tab吸顶可见）：情绪分+涨/平/跌+涨停/跌停/炸板率+成交额+主力净额+信号数+健康点，超宽横向滚动
- **三级警报体系**（替代旧的常驻🚨横幅）：
  - 严重(red横幅+静音按钮)：重度背离
  - 警告(amber小字)：情绪分穿越80/25
  - 提示(info)：预留
  - "今日不再提示"静音按钮（localStorage按日记忆）
- **导航重组**：驾驶舱 / 资金主线 / 个股雷达 / 龙虎榜复盘 / 消息面
- **lucide-react 图标**：状态条和警报使用 Activity/TrendingUp/AlertTriangle 等替代 emoji
- 版本号更新至 v6.1

## v6.0.5 — 信号账本、复盘日记与数据导出备份 (2026-07-28)

> 建立"信号→验证→复盘"闭环。

- **信号账本**（`src/lib/signalLedger.ts`）：
  - 系统触发否决/四象限/周期切换/情绪分穿越80/25时自动追加台账记录
  - 记录：日期/类型/标的/当时价/信号描述
  - 上限500条，按日期倒序
- **T+1/T+5 回填**：每次进入页面检查距今≥1天的记录，用日线接口补收盘价和收益率（每条只补一次）
- **信号命中率卡片**：按类型统计 T+5 平均收益和胜率，样本不足10条标注"⚠️"
- **复盘日记**：DailySummary 下方，三行输入（今日操作/是否执行信号/自评1-5分），按日期存 localStorage，周视图回看
- **数据导出/导入**：序列化全部 localStorage 键为 JSON 下载/恢复，恢复前弹确认

## v6.0.4 — 交易时段状态机调度、Tab懒加载与静默刷新 (2026-07-28)

> 根因：固定60s刷新在盘后/休市时浪费请求且触发限流；全屏loading骨架闪烁影响体验。

- **交易时段状态机**（`src/lib/tradingSession.ts`）：
  - 盘中(9:30-11:30/13:00-15:00)：60s刷新
  - 集合竞价(9:15-9:29)：30s刷新
  - 盘后(15:01-23:59)：300s(5分钟)刷新
  - 午间休市/盘前静默：停止自动刷新
  - 周末：全天停刷，标注"周末休市"
  - 导航栏显示当前时段（盘中/盘后/午间休市等）
- **静默刷新**：首次加载显示loading骨架，后续刷新数据原位更新不闪烁，仅顶栏倒计时变化
- **等宽数字**：全站 `font-variant-numeric: tabular-nums`，数字变化时宽度不抖动
- 刷新时自动检测时段边界（跨时段时刷新间隔自动调整）

## v6.0.3 — 接口健康遥测面板与陈旧数据兜底策略 (2026-07-28)

> 根因：num() 把 undefined 静默转 0，接口字段变更时全系统"看似正常实则全错"；模块失败即清空比显示陈旧数据更危险。

- **接口遥测**：新增 `src/lib/apiHealth.ts`，每个 JSONP 调用记录 name/成功否/耗时/时间戳
- **trackedJsonp 包装器**：api.ts 中 12 个核心接口调用改为带遥测的 `trackedJsonp`，自动记录成功率和耗时
- **strictNum 函数**：解析失败返回 `null` 而非 0，用于关键聚合字段防止"静默归零"
- **健康面板**：TopNav 右侧新增健康指示圆点（🟢≥80% / 🟡≥50% / 🔴<50%），点击展开面板显示各接口成功率/均耗时/最后成功时间
- **陈旧数据兜底**：模块获取失败时保留上一次有效数据（而非清空），首次即失败才显示"数据不可用"

## v6.0.2 — 个股否决项扩充与T+1制度提示 (2026-07-28)

> 扩充否决条件（减持/监管/业绩雷/ST/解禁），新增制度提示，新闻/公告加缓存。

- **否决条件新增**（复用已有公告/新闻接口，正则扫描标题）：
  - ST/*ST/退 → "风险警示/退市风险"
  - "减持(计划|进展|完成)" → "重要股东减持"
  - "立案|行政处罚|警示函|问询函" → "监管风险"
  - "预亏|业绩亏损|商誉减值" → "业绩雷"
  - 未来30天内有解禁（`RPT_LIFT_STAGE` 接口，真实数据）→ "X天内有解禁"
- **制度提示**（非否决，常驻小字）："T+1：当日买入次日方可卖出 · 本票单日波动上限±10/20/30%"
- **否决 badge 展示**：红/黄/紫色标签逐条列出，原有3条保留
- **5分钟内存缓存**：新闻/公告/解禁查询结果缓存5分钟，切换个股不重复打接口
- **新增接口**：`fetchLiftBan`（api.ts，datacenter RPT_LIFT_STAGE）

## v6.0 — 信息架构整合 + AI复盘 + 交互收尾 (2026-07-28)

> 最终整合版：导航重组 + AI每日复盘 + 倒计时刷新 + 版本页脚。

### 导航结构重组（5个一级Tab）
- **大盘温度**：AI复盘总结 + 指数概览 + 情绪温度计 + 资金结构
- **资金主线**：明暗盘监控 + 全球信号 + 隔夜商品
- **龙虎榜复盘**：龙虎榜 + 涨停板复盘（合并为一个Tab）
- **个股雷达**：自选股池 + AI研判 + 追问
- **消息面**：国内/国外快讯双栏

### AI每日复盘总结（新模块）
- 综合情绪温度计/资金结构/涨停复盘/指数表现四大数据源
- 五段式输出：市场情绪/主线题材/资金解读/次日关注/风险提示
- 强制引用具体数值，禁止模糊表述
- 历史记录保存（localStorage，最多10条），支持查看对比

### 交互细节收尾
- **倒计时刷新**：导航栏显示"Xs后刷新"倒计时（替代静态时间戳）
- **手动刷新按钮**：保留在倒计时旁边
- **版本页脚**：底部常驻显示 v6.0 + 最后更新时间 + 数据源
- **重度背离警报**：顶部红色横幅文案优化

## v5.4 — 消息面 + 全球信号升级 (2026-07-28)

> 快讯结构化标签+板块筛选+星级置顶 / 隔夜商品汇率真实数据+联动提示。

### 消息面模块升级
- **结构化标签**：每条快讯自动打标板块标签（12种板块关键词匹配）+ 情绪倾向圆点（🟢利好/🔴利空/⚪中性）+ 重要程度星级（★★★/★★/★）
- **重要消息置顶**：3星级消息（含国常会/央行/证监会等关键词）加粗高亮+左侧金色边框+置顶
- **板块筛选**：下拉框筛选特定板块的相关快讯
- **板块关键词库**：半导体/AI概念/新能源/汽车/医药/军工/金融/地产/消费/黄金/能源化工/基金

### 全球信号模块升级
- **隔夜关联品种**（全部真实数据）：
  - 美元指数 (`100.UDI`)
  - 离岸人民币 (`133.USDCNH`)
  - COMEX黄金 (`101.GC00Y`)
  - NYMEX原油 (`103.CL00Y`)
  - COMEX铜 (`101.HG00Y`)
- **联动提示**：每个品种附带"对A股相关板块的历史联动提示"静态文字说明

## v5.3 — 概念板块资金流排行升级 (2026-07-28)

> 板块排行从静态双表格升级为可交互的多Tab+排序+轮动矩阵。

- **Tab切换**：净流入Top10 / 净流出Top10 / ⚠️流入转流出（第三Tab筛选近5日净流入但今日转净流出的板块，标注"警惕获利了结"）
- **表头点击排序**：今日净流入/近5日/近10日/涨跌幅/换手率均可点击排序（升降序切换）
- **新增列**：换手率（板块整体 f8 字段）、涨跌幅
- **量价背离标注**：资金方向与涨跌幅方向相反时，板块名称旁自动显示橙色"量价背离"标签
- **资金轮动矩阵图**：Treemap 热力矩阵，绿色=流入/红色=流出，面积代表金额大小（使用已有 Recharts 库，零新增依赖）
- **独立组件**：提取为 `BoardRankPanel.tsx`，代码与 FundStructure 解耦

## v5.2 — 资金结构与主力出货升级 (2026-07-28)

> 资金结构模块全面改造：分级预警 + 20日走势 + 出货强度 + 两融卡片。

- **分级预警机制**（替代原"一票否决"单级警报）
  - 💡 轻度背离（黄色）：今日主力净流出
  - ⚠️ 中度背离（橙色）：主力出+散户进，或5日持续流出
  - 🚨 重度背离（红色闪烁）：全面背离+持续多日（原一票否决场景）
  - ✅ 结构健康（绿色）/ ⚡ 结构分歧（黄色）
- **近20日主力资金走势折线图**：在资金连续性模块下方新增，红色折线展示每日净额变化
- **主力资金占成交额比/出货强度**：新增卡片，自动标注"弱/中/强"
- **两融资金卡片**：UI 已搭建，标注 TODO 待接入全市场两融汇总接口
- 资金力量卡片从3列改为4列布局

## v5.1 — 情绪温度计 + 指数概览升级 (2026-07-28)

> 情绪温度计全面升级（因子明细+五级色阶+变化标注）+ 指数概览集成涨停池数据。

### 情绪温度计升级
- **因子明细列表**：展示8个计分因子及各自贡献分值（涨跌家数比/涨跌停差值/平均涨跌幅/指数涨跌幅/涨停活跃度/炸板率扣分/主力资金方向/基础分），每个标注"+X"或"-X"
- **较上次变化标注**：显示"较上次 ↑+5分"或"↓-3分"，localStorage 缓存上次分值
- **五级色阶**：极度恐慌(紫) → 恐慌(蓝) → 中性(黄) → 贪婪(橙) → 极度贪婪(红)，带图例
- **历史分位数**：预留 UI（TODO: 接入250日历史数据）
- **新增计分因子**：涨停活跃度加分（复用涨停池数据）+ 炸板率扣分 + 主力资金方向加减分

### 指数概览升级
- **涨停池数据集成**：涨跌家数行新增"炸板数(炸板率%)"和"连板分布(X板Y只)"，复用第2批涨停池接口
- **成交额量能标签**：根据涨跌方向+成交额自动生成"放量上涨/缩量下跌/放量下跌/缩量上涨/横盘整理"彩色标签
- **两市成交额**：直接在涨跌家数行下方显示
- **共享数据层**：涨停池数据获取函数提取到 api.ts（`fetchLimitPoolSummary`），LimitBoard 和 MarketOverview 共享

## v5.0 — 个股监控大改造（自选股池 + AI研判升级 + 追问） (2026-07-28)

> 个股监控模块全面重写，自选股池、AI研判、追问三大升级。

### 自选股池改造
- 支持最多 **30只** 股票，每只卡片显示：代码/名称/现价/涨跌幅/主力净额/异动角标
- **异动信号计数**：自动检测5种异动（主力出散户进/涨跌停/量比>2.5/换手>15%/持续流出），红色圆点角标显示
- **按异动排序**：切换按钮，一键按异动信号数量降序排列
- **批量刷新**：一键刷新所有股票行情

### AI研判升级（六段式）
- Prompt 重写：**强制引用具体数值**（禁止"资金流出较多"等模糊表述）
- 新增**概率化/统计性判断**要求（无精确数据时明确标注为经验判断）
- 新增**同类股对比段**：提及同板块1-2只代表性股票，判断领涨/跟涨/滞涨
- 六段结构：资金面 → 消息面 → 技术面 → **同类股对比** → 操作建议 → 风险等级

### AI批量扫描
- **一键扫描**全部自选股，每只生成健康度评分(1-100) + 一句话提示
- 评分显示在左侧卡片右下角（🟢≥70 / 🟡≥40 / 🔴<40）

### 追问功能
- 研判结果下方新增追问输入框
- 支持多轮对话，追问时自动携带股票数据 + 历史研判作为上下文
- 追问回复按序号显示在研判区域内

## v4.9.1 — 涨停板复盘（全真实数据重写） (2026-07-28)

> 用东方财富涨停池/炸板池/跌停池真实接口完全重写，去除所有模拟数据。

- **接口切换**：从 push2 行情接口改为 `push2ex` 涨停池专用接口（`getTopicZTPool` / `getTopicZBPool` / `getTopicDTPool`），ut=`7eea3edcaed734bea9cbfc24409ed989`
- **全部真实数据**：连板数(`lbc`)、首封时间(`fbt`)、最后封板时间(`lbt`)、封板资金(`fund`)、炸板次数(`zbc`)、所属行业(`hybk`)、涨停统计(`zttj`) 全部来自真实接口
- **炸板池独立接口**：不再模拟，直接调用 `getTopicZBPool` 获取炸板股完整数据
- **跌停池独立接口**：调用 `getTopicDTPool` 获取跌停股含封单资金、开板次数等字段
- **自动回退**：当日无数据（非交易日/盘前）自动尝试前一交易日

## v4.9 — 涨停板复盘 (2026-07-28)

> 新增独立模块：涨停板复盘（涨停/跌停/炸板/连板梯队/题材热度）。

- **核心统计卡片**：今日涨停数、跌停数、炸板数、炸板率、晋级率（5 张卡片横排）
- **连板梯队分组**：按连板高度分组（首板/2连板/3连板/4+），高连板用金色-红色渐变色突出稀缺性，点击展开显示个股明细
- **涨停原因自动归类**：14 种题材关键词匹配（并购重组/业绩预增/AI概念/半导体/军工/新能源/ST/次新股等），每只股票旁显示彩色题材标签
- **题材热度排行**：柱状图展示各题材下涨停股票数量排名（Top8）
- **炸板股观察**：单独列出炸板股（代码/名称/收盘涨幅/题材/成交额），标注为次日重点关注
- **跌停板列表**：与涨停对称的跌停股票表格
- **数据来源**：涨跌停个股列表来自东方财富 push2 行情接口（**真实数据**）；连板数/炸板状态/封板时间/晋级率为**模拟数据**（TODO: 待接入 `push2ex/getTopicZTPool` 涨停池专用接口）
- **导航新增**："涨停复盘" Tab，位于"龙虎榜"与"主线与潜力"之间

## v4.8 — 龙虎榜与游资席位追踪 (2026-07-28)

> 新增独立模块：龙虎榜数据 + 游资标签 + 联动统计 + 历史表现。

- **龙虎榜个股列表**：展示最新龙虎榜上榜个股，含代码、名称、现价、涨跌幅、净买入额、上榜原因（彩色标签：涨幅偏离/跌幅偏离/换手率/振幅/连续偏离等）
- **席位明细展开**：点击个股展开买入前五 + 卖出前五营业部明细表格，买入红色底纹、卖出绿色底纹
- **知名游资/机构标签库**：自动匹配营业部名称，打标签：
  - 🔵 机构席位（"机构专用"）
  - 🟢 北向资金（"沪/深股通专用"）
  - 🟠 知名游资（拉萨帮/章盟主/赵老哥/华鑫上海等 10+ 个关键词）
  - 🟣 量化席位
- **游资联动统计**：上榜原因分布 + 龙虎榜净买入 Top5
- **历史表现统计**：基于已有后续数据计算次日/3日/5日/10日平均涨跌幅和胜率；最新一期无后续数据时显示模拟示例（TODO 标注）
- **数据来源**：东方财富数据中心 `datacenter-web.eastmoney.com`（`RPT_DAILYBILLBOARD_DETAILSNEW` + `RPT_BILLBOARD_DAILYDETAILSBUY/SELL`），真实接口数据
- **导航新增**："龙虎榜" Tab，位于"资金结构"与"主线与潜力"之间

## v4.7 — 个股监控 + 快讯分栏 + 板块过滤 `3b1f764` (2026-07-28)

> 两大新模块上线 + 板块数据清洗 + 翻译问题修复。

- **个股监控模块**（替换原"重要指标监控"）
  - 左栏：监控个股列表，可添加/删除 6 位代码，localStorage 持久化
  - 右栏：选中个股的实时信息流，聚合资金面 + 新闻(利好/利空标注) + 公告
  - AI 研判：接入 Agnes AI (`agnes-2.5-flash`)，综合资金面 + 消息面生成研判报告
- **快讯双栏**（替换原单栏快讯）
  - 🇨🇳 国内重要消息 + 🌍 外围国际消息，各自独立滚动
  - 通过 50+ 关键词自动分类（美联储/高盛/日本/韩国/地缘等）
- **板块过滤**：新增 30+ 关键词黑名单，过滤掉"融资融券/MSCI 中国/大盘股"等假概念板块
- **翻译修复**：添加 `translate="no"` 等标记，防止 Chrome 自动翻译将"净流出"误译为"净突破"

## v4.6 — 跌停修复 + 韩台指数 `8d0c28b` (2026-07-28)

> 彻底修复跌停显示为 0 的 bug + 新增韩国/台湾指数。

- **跌停统计串行化**：改并发为串行执行（每个板块依次请求涨停端 + 跌停端），避免 10 个并发 JSONP 请求触发浏览器限流
- **全球信号新增**：韩国 KOSPI (`100.KS11`) 和台湾加权 (`100.TWII`) 指数

## v4.5 — 三项修复 `dc89e21` (2026-07-28)

> 跌停统计修复 + 板块资金流排行 + 明暗盘判断逻辑重写。

- **跌停统计修复**：`pz=5000` 大请求频繁 502，改用小分页策略（涨幅最高 100 条 + 最低 100 条），分别统计涨停/跌停，彻底解决"跌停显示 0"的 bug
- **板块资金流排行**：在资金结构模块新增概念板块净流入/净流出 Top10 表格，显示今日/5日/10日净额及连续流入/流出天数
- **明暗盘判断逻辑重写**：采用同花顺 6 种组合模型
  - 明盘 = 超大单 + 大单（公开大资金）
  - 暗盘 = 中单 + 小单（含主力拆单隐蔽资金）
  - 6 种主力动向判断：主力看多 / 主力看空 / 洗盘低吸 / 拉升做T / 吸筹 / 诱多出货
  - 新增"资金总体流向"卡片（5 列布局）

## v4.4 — 接口稳定性修复 `4ab7346` (2026-07-28)

> 修复 GitHub Pages 部署后部分模块数据加载失败的问题。

- **JSONP 自动重试**：新增 `jsonpOnce` + 带退避重试的 `jsonp` 封装（最多 3 次），应对东方财富接口间歇性 502/超时
- **资金结构接口字段精简**：`fetchMarketMainFund` 去掉 `f69/f75/f81/f87/f165/f175/f184` 等占比类冗余字段，降低 502 概率
- **30天资金历史接口修复**：`fetchMarketFundHistory` 废弃 `secid2` 联合参数（会触发服务端 500），改为分别请求沪深两市再按日期合并
- 开启 GitHub Pages 部署：`main` 分支 → `/docs` 目录

## v4.3 — Build & Deploy `620196d` (2026-07-27)

> 当前版本。基于 v4.2 的代码，调整构建配置以支持 GitHub Pages 部署。

- **构建输出改为 `/docs`**：`vite.config.ts` 中 `build.outDir` 设为 `docs`，产物纳入版本控制
- **部署方式**：GitHub Pages → Deploy from branch `main` → `/docs` 目录
- **预览地址**：<https://benlau88832-collab.github.io/stock-monitor/>
- 新增 `vite-plugin-singlefile`，将所有 JS/CSS 内联到单个 `index.html`

## v4.2 `4f80f56` (2026-07-27)

> 加固接口令牌 + 涨跌家数异常兜底。

- 为所有 `push2.eastmoney.com` 请求补上 `ut=bd1d9ddb...` 通用令牌参数，降低接口返回不完整/异常数据的概率
- 涨跌家数异常兜底：当接口返回 0 或明显偏小值时，使用分板块汇总数据做 fallback
- 修复部分场景下 `diff` 字段为对象而非数组导致的解析崩溃

## v4.1 `84884bf` (2026-07-27)

> 修复涨跌家数根因 + 新增个股关注、利好利空监控。

- **根因修复**：全市场涨跌家数统计从单页采样（~100只）改为分板块（主板/创业板/科创板/北交所）分页查询后合并，覆盖全部 ~5000 只个股
- 新增个股监控模块（`StockMonitor.tsx`）：输入 6 位代码查看资金流与一票否决信号
- 新增避坑指南模块（`Pitfalls.tsx`）

## v4 `b195ae7` (2026-07-27)

> 全面修复真实 bug，不改布局颜色。

- **全市场涨跌数据**：分板块获取 + 处理 `diff` 对象/数组兼容
- **资金快照**：新增 30 天历史记录，支持图表/表格切换和折叠，`localStorage` 持久化
- **明暗盘 TOP10**：全部 10 个概念板块都可展开成分股，添加洗盘/出货信号判断
- **板块级别**：从行业板块改为概念板块
- **链接修复**：所有东方财富链接格式已验证可跳转（`realLinks.ts` 重写）
- 情绪温度计公式优化：`upRatio×40 + limitScore×1.3 + avgPctScore×0.8 + indexScore + 20`

## v3 `8739c0b` (2026-07-26)

> 从 Next.js 迁移到 Vite + React + Tailwind 全新重构。

- 技术栈迁移：Next.js → Vite 7 + React 19 + Tailwind CSS 4 + TypeScript 5.9
- JSONP 跨域封装：绕过浏览器 CORS 限制，直接调用东方财富 `push2` API
- 全市场 5000+ 个股涨跌统计
- 模块化组件架构：TopNav / MarketOverview / FundStructure / DarkPool / GlobalSignals / KeyIndicators / NewsPanel / Mainline 等

---

### 分支说明

| 分支 | 状态 | 描述 |
|------|------|------|
| `main` | ✅ 默认分支 | 最新代码 + `/docs` 构建产物（GitHub Pages 部署源） |
| `arena/*` | 🔄 工作分支 | Arena.ai Agent Mode 会话专用分支 |

> 所有过时分支（`v2-test`, `v3-test`, `019f9dee` 等）已在之前的会话中清理。
