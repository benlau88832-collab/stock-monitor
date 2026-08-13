// ============================================================
// 版本常量（v9.47：footer 去硬编码 —— 每次发版更新此处即可）
// 引用：App.tsx footer
// v9.77：V2 审查（游资/机构视角操盘实用性）P0/P1 修复批次
// v9.78：性能修复 —— 渐进式主线渲染（LLM 归类不阻塞首帧）+ AI 并发限流器（响应 Agnes 并发限流）
// v9.79：性能韧性修复 —— 板块映射延迟构建 / ErrorBoundary / 18s 空池不覆盖
// v9.80：卡顿根因修复 —— jsonpQueue 熔断快速短路 + 超时 10s→4s + 数据源异常横幅 + 推送业务码校验 + AIConsole 打字机 + PG 备份脚本
// v9.83：LLM 切换 DeepSeek V4 Flash（OpenCode Go 中转，Key 仅存 server/.env）—— max_tokens 600/1200→2000
//   （推理模型思考占 token，实测 600 时 content 为空）+ chat_template_kwargs 仅 Agnes 传 + hostGuard 加 opencode.ai
// v9.82：断源快速失败补丁 —— 人气榜/双榜/宽基ETF 8s→3s + 人气榜60s缓存 + 熔断flapping优化(成功衰减)
//   + 非交易日Agent自动调研跳过(省Agnes配额) + 宽基ETF失败明确文案
// v9.81：卡顿整改（性能发布）—— refreshAll 模块链并行化(Σ→max) + 熔断按host分桶(6→3) + 长超时收紧
//   + 涨停池断源回退深度受限 + refreshFast防重叠 + 龙虎榜161请求风暴收敛 + 渲染路径memo化
//   + dataStore内存缓存 + cloudStore增量同步(修复bulk 100条截断) + AIConsole打字机降频 + Recharts memo
//   + 服务端加固（启动补抓链互斥/非交易日跳LLM/盯价与主题分析防重叠/proxy 6s/theme-analysis异步化）
// v9.84.1：分类体系统一（阶段2）—— 词表单源 CONCEPT_GROUPS 共享(.js 前后端同require+vite commonjsOptions, 消灭 cron 词根漂移)
//   + F10概念持久化(stock_concepts 表 + /api/db/concepts 服务端抓取落库) + 自选股雷达主线标签(classifyStock+呼应当前主线⚡)
//   + 单股全景端点 /api/db/stock/:code(概念/新闻/公告/调研/盯价/席位/涨停历史一次聚合并行)
// v9.84.2：AI大脑层+盘中异动+多通道推送（阶段3+4合并）——
//   3.1 /api/brain/context 全站快照聚合（情绪/涨停梯队/主线Top/板块资金/龙虎榜/黑天鹅/公告强催化/次日闸门）
//   3.2 /api/brain/pg Agent PG 查询工具组（快讯/公告/涨停历史/席位/调研/市场日序列，工具名白名单）
//   3.3 AIConsole 对话结论回写（个股裁决→雷达旁标，动作判断→决策审计 decision_log）
//   3.4 真流式 SSE（stream 端点 reasoning_content 过滤+chat_template_kwargs 仅 Agnes；AIConsole 简单问答流式渲染）
//   3.5 死任务接线（policyDiff 政策解读 / eventClassify LLM 精分级 / dailyReviewAuto 立即 AI 复盘）
//   3.6+4.1 盘中大脑快照每5min（服务端情绪分/板块资金快照落库，关页不断链）+ 板块集体异动引擎（≥3涨停/资金脉冲）
//   4.2 异动前端接入（30s 轮询 kv anomaly → alertBus 横幅/声音/标题闪烁）
//   4.3 封单衰减下沉 server（detectSealDecay 同构，关页不失）
//   4.4 推送多通道并发（Server酱/企微/Bark/飞书 webhook/Qmsg 酱 QQ，hostGuard 白名单）
// v9.84.3：半成品清理（阶段5）—— ETF matchScore 随机数→真实评分 + MarketOverview 历史分位数接 PG 250 日 + LOCAL_TOKEN 默认启用
// v9.84.4：数据链与AI链路修复 —— JSONP 本地优先走服务端 /api/proxy（浏览器直连 10-15s 超时 vs 服务端秒回）+ callAgentChat 补带 x-local-token
// v9.113.0：终审交付层重构（T0 dataLayer PG 优先 / T2 intentRouter 五档路由 / T3 LLM 收尾 / T4 decisionDirect 决策直达 / T1-2 横幅三态）
// v9.113.1（T1-1 D-01 收尾）：主面板数据管道 PG-first —— refreshAll 第 9 路并行拉 PG 快照，
//   涨停池三优先（实时 push2 直连 > PG 派生池 > push2delay 兜底）+ 情绪/溢价/晋级率 PG 兜底 + MarketOverview PG 角标
// v9.114.0（T5/T6 可靠性收敛 + 面板精简）：T5-1 boardTrap 文案核对（grep=0 不接线，板块级宿主维持 v9.106.2 定调）/
//   T5-2 统一 /api/health（数据源+AI 端点+PG 连通+SW 版本聚合，OpsPanel 统一 SLA）/
//   T5-3 SW 版本强制更新（activate 通知页面强制 reload，消除"需硬刷新"约定）/
//   T6 面板收敛（主线/资金面/盘前准备三分区语义对齐，主 Tab 5 个保持收敛）
// v9.115.0（S1-1 单一 AI 认知层）：server/lib/cognition.js buildCognition 纯函数（情绪周期6阶段/资金信号/
//   风险闸门/龙头接力，每字段带 Provenance 溯源）+ verifyCognition hash 校验 + rawFromBrainContext 适配
//   （PG buildBrainContext 输出 → 认知 raw，只换数据源下游零改动）+ GET /api/cognition 全站唯一认知端点
// v9.116.0（S2 决策直达层）：composeDecision 五支柱（准入/仓位/离场/风控/诱多，纯函数 <1ms 永不降级）+
//   DecisionCard 升级一键裁决面板（候选龙头自动亮 + 9:25/13:00 决策窗口 P0 高亮）+ /api/decisions 路由
//   （服务端 decisionLayer.js CJS 双端同构）
// v9.117.0（S3 主动智能）：时段引擎 resolveSession（8 阶段 + 9:25/13:00 决策窗口）+ 规则谓词四件套 +
//   runProactiveTick 时段洞察（规则前置 0 token，LLM 仅盘后复盘/剧本/盘前简报受预算标记）+
//   /api/proactive 路由 + cron 主动流落库 + ProactiveFeed 面板（盘前准备区，时段切换 + 预算条）
// v9.118.0（S4 操作习惯场景融合）：四场景纯函数（stageToAction 情绪周期买卖点 / assessAuctionVolatility 竞价 /
//   composeIntradayAction 异动处置 / buildCloseList 尾盘减仓，0 token）+ ScenarioPanel 四 tab 面板
//   （读认知层动态，结论可触达决策直达——独立条不增面板）
// v9.119.0（S3-3 补全 + 验收对齐）：主动流 LLM 润色实际接线（refineInsightsWithLLM 受时段预算、
//   失败回退规则原文永不降级）+ cron 时段调度六入口（盘前/竞价/早盘/午后/尾盘/盘后 → kv proactive:latest）+
//   /api/proactive 优先读润色版 + /api/health checks 数组（对齐 ③ 全局验收命令）
// v9.120.0（卓越 S1-1b/S1-1c 认知推理层）：reasoning.js 纯函数（assessCoherence 跨5维共振+背离 /
//   deriveDrivers 因果驱动链 / computeDelta 环比变化率 / makeForecast 前瞻预判 / buildNarrative 一句话理解）+
//   /api/reasoning 端点（含 prevCog 历史版 + 利好新闻催化）+ 助手注入 narrative + ReasoningPanel 推理面板
// v9.121.0（卓越 S2-1b 决策直达游资战术）：assessTactics 五件套（接力分/情绪买卖点/买点/卖点纪律/梯队位置）+
//   composeDecisionCore 返回加 tactics（双端同构）+ DecisionCard 游资战术行（五支柱不动纯加字段）
// v9.122.0（卓越 S3-2b 主动智能消费预判）：runProactiveTick 第 4 参 reasoning —— forecast.conditions
//   作为额外触发源（每条产出一条"前瞻预判"洞察，P0/P1、0 token、可触达决策卡）；路由/cron 双路径注入
// v9.123.0（卓越审查修复批次 P0×4+P1×7）：决策直达个股真实装配（stockSnapshot.js：push2delay→腾讯，
//   装配失败降级 {code}）+ ladderPosOf 空名守卫（双端）+ 决策读认知表（version 0 废弃）+
//   资金明暗盘数据链（f66/f72/f78/f84 → 暗盘/明盘真实计算，明细缺失诚实"流入/流出"，五维共振恢复真五维）+
//   主动流润色质量闸（政策语料空不润色 + 拒绝语黑名单）+ 认知 session 真实时段注入（双时钟合并）+
//   llmCore length 重试 headroom 生效（发送上限对齐 12000，diag 实测网关接受）+ forecast 六阶段全覆盖（启动/分歧）+
//   龙头数据缺失不误报 P0 + 前端决策卡工具失败走认知近似兜底 + buildReasoning 60s 缓存/轻量变体 +
//   复盘链注入认知单行 + 双端决策核 golden 测试（新增 10+ 用例，T-2~T-14）
// v9.124.0（蓝图 4A 资讯聚合·批次 A）：个股雷达信息透明化数据层——news_feed 跨源资讯表 +
//   newsAgg.js（emweb F10/search-api/财联社 normalize 纯函数 + mapNewsToEntities 概念打标 0 token
//   + upsertNewsFeed 幂等去重）+ GET /api/news?code=&name=（feed ∪ 快讯名称匹配兜底）+
//   cron 盘前 9:10/盘后 15:20 抓自选+主线龙头新闻（0 LLM 失败静默）
// v9.125.0（蓝图批次 B 离线部分）：雷达资讯聚合区（个股雷达 Tab 内选中标的 📰 资讯区，消费 /api/news，
//   不增面板）+ 纪律教练前置（behaviorCoach 行为偏差检测纯函数：频繁交易/不止损/追高/处置效应
//   四类信号 0 token + GET /api/coach，N<3 不判定防误报，提醒引用行为金融原理）
// v9.126.0（蓝图 L4 批次 C）：情绪周期回测引擎——stageFromDaily（market_daily+sentiment 逐日重建阶段，
//   与认知层同一 deriveSentimentStage 判定函数，回测口径=生产口径）+ stageBacktest 分阶段统计
//   （次日溢价胜率/平均溢价/晋级率，N<5 标注样本不足）+ GET /api/backtest/stage（阈值校准参考对照蓝图表）
// v9.127.0（蓝图批次 D 前置 + 数据质量修复）：①premiumAvg 落库链修复——根因=push2delay ulist.np 字段错位
//   （v9.123.0 实测）→ 主源腾讯批量（parseTencentQuotesBatch GBK 纯函数）+ 错位值 |v|<30 护栏兜底；
//   ②战法命中率 /api/backtest/strategy（decision_post T+5 PnL × 拍板动作 × 置信度桶，N<20 标注）；
//   ③持仓体检 /api/positions（trade_ledger 净额汇总+均价+集中度，现价未注入盈亏诚实 null）
// v9.128.0（一致性审查修复批次 P0×3+P1×7）：五路子代理全站审计（数值口径/双端同构/kv契约/端点契约/名实）
//   → P0-1 情绪多套公式词表同屏互斥（报告列架构决策待定调，本批不动公式）/
//   P0-2 决策卡 stage 口径修复（resolveDecisionStage：认知 stage 优先，trend down/up 仅兜底——此前
//   前端阶段分支永不命中、仓位双端分叉 15% vs 21%）/P0-3 getFreshCognition 全站新鲜认知
//   （盘中陈旧>30min 即时重建落库，治精灵锁竞争导致的 11.5h 陈旧认知；cognition/proactive/
//   reasoning/decisions 四消费点统一接入）/
//   P1-1 anomaly 双写形状兼容（精灵事件不再渲染"涨undefined%·NaN亿"）/P1-2 assistantAgent 死键
//   quote/fund/anns→announcements/P1-3 决策窗口左闭右开双端对齐/P1-4 涨停阈值参数化 limitPct
//   （trapDetector/stockExit 三调用点传 stockLimitPct，20cm 板近涨停判定失真修复）/P1-5 盈亏颜色
//   红盈绿亏对齐全站惯例/P1-6 proactive kv 补 cognitionVersion/P1-7 前端 AI 超时 95s→300s
//   （覆盖服务端空答重试链 275s，杜绝孤儿烧 token）/P1-8/P1-9 cron 调度注释与"前端等价"失效引用名实对齐
// v9.129.0（一致性收敛重构·用户授权合并）：情绪体系单源化——①新建 src/lib/emotionStage.ts
//   （deriveStage 六词唯一判定 + 唯一词表 {冰点,退潮,启动,发酵,高潮,分歧}，与 server/lib/cognition.js
//   deriveSentimentStage 双端同构，golden 测试全输入空间锁定）；②emotionCycle 五档判定废弃（涨停/高度/晋级
//   仅作证据展示）；③emotionAnalysis 5 档组合词废弃（委托认知层判定）；④stageModel.emotionToStage 词表映射
//   删除（主线阶段=题材维度与情绪周期=市场维度概念边界声明）；⑤前端情绪分总分公式（upRatio×40+…+15）删除，
//   单一来源=PG sentiment_snapshot（顶部/认知横幅/情绪雷达/状态机四面板同分同阶段）
//   ——v9.129.1 收口：服务端删 sentiment:键 前端上传兜底（污染源，曾 90vs16 漂移）；顶部直接消费
//   /api/cognition（第 10 路并行拉取），浏览器实测六面板同分同阶段（90/发酵/极度贪婪）
// v9.130.0（终审修复批次 P0×2+P1×3）：D2 竞价五步流水（findAuctionOpportunities 纯函数：
//   板块批量涨停扫描→过滤非独立行情→龙头/跟风识别→未涨停+套利空间筛选→排除一字板，0 token+
//   竞价台"板块异动·上车机会"区+6 单测）/N1 主线排序 tie-breaker 统一（认知层 primaryTheme 与
//   大脑快照 top1 同排序键）/D1 竞价作战区上移驾驶舱顶部（竞价台+强度榜+AI 预判龙一 收敛，原散落
//   Dashboard 左栏底部与资金主线盘前准备区）/N3 溢价·晋级率 PG 单源（服务端口径优先，前端实时仅兜底）/
//   D3 个股监控公告栏资讯聚合（StockWatchlist 选中标的 📰 滚动聚合，与盯价监控资讯区并存）
// ============================================================
// v9.131.0（终审修复批次二 N4-N9 收尾）：N4 场景融合三 tab 接真实数据（竞价=昨日涨停池强度榜首
//   腾讯行情/异动=anomaly 事件/尾盘减仓=/api/positions 真实持仓，删除演示常量 600001/3.5% 等）/
//   N5 蓝图端点接线（纪律教练+持仓体检接纪律面板；阶段回测胜率接情绪雷达卡，N≥5 才展示）/
//   N6 "重新裁决"按钮改"读取缓存裁决"（名实相符）/N7 精灵·大脑双推送统一冷却（pushDedup 共享去重键 30min）/
//   N8 历史情绪分归档通道语义注释/N9 计分因子明细标注"总分以认知层为准"
// ============================================================
// v9.132.0（终审报告复核 D2 修正）：竞价五步流水"未涨停+套利空间"候选池修复——
//   未涨停股不在今日涨停池 → 板块映射改由昨日涨停快照 prevHybk 提供（原实现该步在生产恒空，
//   结构性死步；测试改为真实生产形状——候选不在今日池、映射来自昨日快照）
// ============================================================
// v9.133.0（游资改造·阶段一：注意力重构"三时段作战台"）：
//   ①主动智能流 ProactiveFeed 并入驾驶舱竞价作战区（盘前竞价+隔夜+时段洞察同屏，原资金主线盘前准备区移除）
//   ②认知推理面板/场景融合 盘中默认折叠（决策区一行化：认知横幅+决策卡+作战卡）
//   ③情绪周期雷达默认折叠（与认知横幅去重）；研究工具（情绪叙事报告/8 折叠面板/运维面板）收进
//   "📚 研究台"details，盘后默认展开、盘中折叠（防分散注意力）
//   ④事件三级研判 EventClassifyPanel 移回消息面 Tab（驾驶舱决策区只留 裁决+选股）
// ============================================================
// v9.135.0（游资改造·阶段二~五 合并发布）：
//   阶段二 交易闭环：拍板确认自动写 trade_ledger（runPostHook 第⑤件事）+ 纪律面板"成交录入"一行表单
//     （此前 saveTrade 生产零调用→纪律教练恒空）+ /api/positions 注入现价（push2delay→腾讯，未平仓盈亏可算）
//   阶段三 主线一致性：作战卡标题"🧠 认知主线"徽标（认知层 primaryTheme 与实战候选不同时标注两口径）
//   阶段四 阈值收口：前端 thresholds.ts 增 FUSE/PENALTY_START/LOW_ABSORB_MAX + regimeGate/mainline/lowAbsorb
//     收口引用；服务端新建 server/lib/thresholds.js（cognition 15%/20%、factorIc 35/20 收口）；
//     新增 thresholdsGolden.test.ts 双端 golden 锁定
//   阶段五 竞价补强：竞价台"普涨日"提示（上涨占比>85% 板块效应参考性弱）+ 决策卡 9:25 多候选
//     （认知龙头 + 主线 Top1-2×3 只候选按钮）
// ============================================================
// v9.136.0（交接 0813 五任务批次）：
//   任务1 主线彻底单源（架构项）：服务端 runThemeAnalysis 主题打分对齐前端 calcMainlineStrength
//     （server/lib/mainlineStrength.js CJS 同构 + golden 锁定；themes 落库 ztCount/height/strength +
//      strength 降序重排；brainContext/cognition 排序键同步）——前端实战引擎降级实时增量：
//     渲染锚定认知主线（cognitionMainline.ts 同名置顶/theme_analysis 补位 + BattlePlan llmRanked 层锚定），
//     作战卡徽标改"🏛 认知锚定"（原"🧠 认知主线"不一致提示语义废止）
//   任务2 N2 闸门收敛：产品定调=盘中实时权威（regimeGate 熔断式），服务端 brainContext gate 标注
//     快照口径（PG 线性计分式，助手快照/决策 Agent 上下文用），注释声明不合并
//   任务3 炸板率阈值收口：intradayRules R3 引 BLAST_SURGE_FROM/TO（双端 golden）；
//     reasoning.js LLM 文案插值 BLAST_RISK_PCT；stageBacktest 校准档位注释声明
//   任务4 /api/decisions 契约定案：决策卡优先 POST 服务端（现价装配），失败降级本地 kernel；
//     删 GET 批量端点（零消费者），POST=裸 DecisionVerdict 契约
//   任务5 trade_ledger 闭环：纪律面板 sell/stop 自动匹配持仓成本（体检持仓 avgCost 优先）+ computePnl
//     真实盈亏落 pnl_pct；体检持仓一键"卖"联动带出代码/名称/数量
// ============================================================
// v9.138.0（四身份审查《波段景气度重构》· 阶段一功能发布）：
//   🆕 波段位置模型 swingStage（平台识别/放量突破/首板次日低吸/主升/加速/退潮）
//   🆕 波段主线引擎 swingMainline（趋势40%+资金35%+催化25%，行业粒度方向榜）
//   🆕 持仓逻辑台账 logicLedger（逻辑/催化验证点/破位线/四类提醒）
//   🆕 业绩验证日历 earningsCalendar（财报季窗口/持仓提醒）
//   🆕 波段决策核 swingDecision（波段五支柱：位置/买点/止损/止盈/逻辑）
//   🆕 波段作战室 SwingWarRoom（方向榜+逻辑台账+波段决策卡+业绩日历，驾驶舱置顶）
//   🆕 服务端 /api/proxy/board-kline、/api/proxy/stock-kline（板块/个股日K，push2his http 主源实测修正：
//      push2his 仅 https 对 node TLS ban，http 直连稳定；腾讯 fqkline 不支持 bk 前缀板块代码（param error））
//   🔻 降噪（Q5）：竞价作战区/竞价台/强度榜/预判龙一/盘中精灵（cron+浮层）移除或停用，
//      保留涨停池/情绪参考；leaderPredict LLM 任务不再调用（省配额）
// ============================================================
// v9.139.0（阶段二：代码结构重构 —— 拆 God Component + 契约单源 + 存储迁移机制）：
//   #14 App.tsx 1774→250 行：状态/抓取/效果管线整块搬移 src/hooks/useMarketData.ts（数据 hook 层），
//      App 只剩页面容器（Tab 分派 + JSX，解构同名返回值行为零改动）
//   #14 Dashboard.tsx 1337→842 行：9 个展示型组件拆入 src/components/dashboard/DashboardWidgets.tsx
//      （领域组件层，纯 props 驱动，不消费 useMarketData）
//   #17 API 契约单源化：OverviewData/FundStructureData/DarkPoolData/GlobalData/MainlineData/
//      SentimentFactors 迁至 src/lib/marketTypes.ts（App 仅 re-export，17 处既有导入零改动）
//   #19 localStorage 版本迁移机制：src/lib/lsMigrate.ts（registerMigration/runLocalStorageMigrations，
//      ls_schema:key 版本戳幂等，逐键隔离失败不阻断）+ 首个迁移（user_profile_v1→v2 补齐 feedbackStats、
//      stock_watchlist→v2 规范化去重）+ 5 单测；main.tsx 挂载前执行
// ============================================================
export const APP_VERSION = "v9.139.0";
export const BUILD_DATE = "2026-08-14";
