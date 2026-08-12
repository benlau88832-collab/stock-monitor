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
// ============================================================
export const APP_VERSION = "v9.124.0";
export const BUILD_DATE = "2026-08-13";
