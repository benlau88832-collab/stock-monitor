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
// ============================================================
export const APP_VERSION = "v9.85.0";
export const BUILD_DATE = "2026-08-09";
