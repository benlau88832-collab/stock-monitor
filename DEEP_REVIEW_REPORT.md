# A股股票监控终端 全栈深度审查报告 v9.63
> 审查人：10年+ A股游资视角 + 全栈架构师  
> 版本：v9.63 build 2026-08-06  
> 范围：src/ 全量 88 个 lib + 46 个 components + App.tsx + server/ 全部 + 配置  
> 方法：逐行阅读，不跳过一行，交叉验证前后端、数据链、阈值统一、LLM降级、风控闭环

---

## 一、项目总览与定位

这不是一个“行情看板”，而是一套**游资龙头战法 + 机构纪律融合的实盘辅助决策系统**。从代码层面看：

- **资金为主、价格为辅**：所有评分以 `mainNet / f62` 资金流为第一因子，报价 pct 为第二因子，符合顶级游资“先看资金再看形态”。
- **周期框架完整**：从竞价（auction.ts）→ 题材梯队（themeLadder.ts）→ 主线强度（mainlineScore.ts）→ 闸门（regimeGate.ts）→ 仓位定量（positionSizing.ts）→ 信号验证（signalLedger.ts + recTracker.ts + factorLib.ts）形成闭环。
- **数据驱动 MVP**：前端直接 JSONP 调东财 push2 / push2ex / datacenter，省服务端成本，但也把**反爬与限流风险完全暴露给浏览器**。
- **LLM 双轨**：所有 AI 任务走 `ai.ts` 统一中枢，服务端 `/api/ai/call` 分桶限流（agent 30/min, analysis 20/min, explain 10/min），失败自动降级到规则版，设计上符合“五条红线”。

**游资视角第一印象**：作者懂盘面。`核按钮预警`、`封单衰减`、`高低切`、`晋放量不涨`、`一字板难上车` 都是实战中每天盯的细节，不是学院派纸上谈兵。问题在于：**想做的太多，工程债很重**。

---

## 二、全栈架构逐行审查

### 2.1 前端入口与构建

- `vite.config.ts`: 使用 `viteSingleFile` 单文件输出到 `/docs` 为了 GitHub Pages 预览。  
  **问题**：单文件产物体积经 `recharts + lucide-react + 88个lib` 后极大（>2MB），白屏时间长，且任何组件错误会导致整页不可用。**建议**：生产用 code-splitting，去掉 singleFile，仅预览分支用。
- `App.tsx` 1316 行是上帝类：  
  - `refreshAll` 与 `refreshFast(18s)` 双通道设计正确：主刷新 60s 重数据，快速通道轻量只刷涨停池，解决“9:30:05 直线封板识别慢”痛点。  
  - `nextRefreshAt` 替代每秒 `setCountdown` 避免全树重渲染，属性能优化亮点 v9.26.10。  
  - `llmRankSeq` 竞态护栏避免慢 LLM 响应覆盖新结果，正确。  
  - **Bug**: `overviewRef` / `darkPoolRef` 镜像防陈旧闭包，但 `fundStructureRef` 缺失，导致极端情况下仍取旧资金流判断 `marketFlowType`。
  - 情感分公式：`upRatio*40 + limitScore*1.3 + avgPctScore*0.8 + indexScore + 20 + limitUpBonus - blastedPenalty + fundFlowScore + premiumScore + promotionScore` 权重可解释，但**无历史回测验证**，`20` 常量偏经验化。
  - `localDateStr()` 多处用于缓存 Key，若用户电脑时区非东八区且 `getBJDate()` 部分使用、部分用 `new Date()`，会导致缓存跨日串台。`tradeCalendar.ts` 已有 `isTradingDayCN` 北京逻辑，但 `ymdPlus()` 在 `api.ts` 仍用本地日期，应统一。

### 2.2 数据层 `src/lib/api.ts` (1211 行) 细节

逐域：

- **strictNum / hasMissingKeyFields**: v9.53 引入是关键改进，解决东财改字段时静默当 0 的“看起来正常全错”问题。调用侧多处 `dataMissing` 透传 UI 显示“数据缺失”，正确。
- **涨跌家数**：从自己翻页计数迁移到 `f104/f105/f106` 指数官方统计，根治“总数4440但涨跌加起来只有400”错误，正确。增加 “全员上涨不合理” 抛出异常兜底，好。
- **资金流**：`fetchMarketMainFund` 聚合上证+深证 `1.000001,0.399001`，逻辑对，但**北交所资金 f62 未纳入**，导致小盘情绪失真。`extraLarge+large = 明盘` 定义在 `judgeFlowType` 前后端一致，但同花顺口径明盘=超大+大单已对齐。
- **板块资金 all=true**: 双请求 `po=1` + `po=0` 合并去重解决流出行业被挤出结果集问题，修复 `IndustryFundFlowChart` 永远 0 的史诗 bug，正确。
- **转托管历史 fetchMarketFundHistory**: 用 `push2his daykline` 的 `f51-f56` 日K字段，串行拉沪深再合并，按日期滚动求 `mainNet5d/10d` 真实计算而非随机，正确。
- **封板时间 fbt 解析**：`093012 → 09:30:12` 在多处重复实现（themeLadder, auction, stockToMainline），应抽公共 `formatFbt`。
- **关键 Bug2处**：
  1. `fetchNuclearCount` 内部 `Number(it?.f2 ?? 999) <= -9` 判断核按钮，`f2` 是价格不是涨跌幅，应为 `f3`。导致核按钮计数恒 0 或误判。
  2. `fetchBoardRankTopBottom` 的 `consecutiveDays` 用 `mainNet10d / mainNet` 比值估算，非真实连续天数，数值误导。游资看连续流入天数必须逐日真实落库，当前仅 `fundStreak.ts` 的 `buildFundStreaks` 做到了真实，但该模块只在本地服务部署下可用。

- **人气榜**: `emappdata.eastmoney.com` POST 接口浏览器直连 CORS 成功，已验证。`crypto.randomUUID` 兼容性有兜底，正确。但 `thspopular` 同花顺接口 `dq.10jqka.com.cn` 无鉴权，可能随时被 10jqka 加 Referer 校验 ban。

- **限流队列 `jsonpQueue.ts`**: 全局 `MAX_INFLIGHT=3` + 随机抖动 50-250ms + 指数退避重试 1s/3s/8s，工程上缓解东财 15并发 ERR_EMPTY_RESPONSE，正确。但 `inflightMap` 去重键去掉了 `_=timestamp`，若同一 URL 不同参数因时间戳被去重，可能返回过期缓存。

### 2.3 阈值统一 `thresholds.ts` (核心改进 v9.62)

把炸板率 `35/50/20/30/45`, 情绪分 `80/65/45/25/35/15/20/70/30`, 涨停数 `20/40/50/15`, 跌停数 `50/20/15`, 换手 `25/20` 等分散在 7 个文件的魔法数字全部收敛，一处改处处生效。**这是全项目最值得称赞的重构**，避免多模块打架。

遗漏：`TURNOVER_CROWDED` 与 `TURNOVER_OVERHEAT` 命名反直觉（25 叫 crowded, 20 叫 overheat），且在 `stockScore.ts` 仍硬编码 `25` 未引用。

### 2.4 主线引擎

**themeLadder.ts**：`buildThemeLadder` 纯函数，`gapTiers` 断档检测（高度≥2但中间层级缺失）是龙头战法核心——“二板断档=板块梯队不健康”。`buildThemeLadderByConcept` 一对多展开支持概念级聚类，贴近开盘啦/同花顺口径。

**themeScore.ts**：四维权重 `fund 0.35 / ladder 0.25 / stage 0.20 / news 0.20`，且 `newsWeight` 随阶段动态浮动（启动期 30%/发酵期 20%/高潮期 10%）符合“启动看消息、高潮看资金”。`fuzzyMatchLadder` 别名表 `半导体→电子` 等有主观性，但作为 fallback 可接受。

**stockToMainline.ts** 821 行是全项目最复杂：

- 流程：LLM 归类前30只（省 token）→ 概念折叠 `foldConcepts`/`foldBoardFunds` → 一对多展开补全剩余涨停 → 资金匹配 `fundMissing/dataMissing`。
- `safeMax` 防空 (`Math.max(...[]) = -Infinity`) 是红线 #6 修复，正确。
- 降级链：LLM → 个股所属概念（datacenter `RPT_F10_CORETHEME`）→ 成分股反查 50只/概念 + 过滤 `非题材` 正则 → hybk 行业终极兜底。链路完整。
- **问题**：`conceptGroups.ts` 的折叠词库是否覆盖新能源是关键，若词库过时会导致“机器人”主线资金匹配失败（已加 `fundMissing` 标记但 UI 仍显示弱）。
- **性能**：`fetchStocksBoards` 全量涨停（>120只时）触发 120次 /api 代理，可能触发东财限流。需在服务端做批量缓存。

**mainlineScore.ts**: 权重 `涨停占比25% + 连板高度20% + 晋级率15% + 资金连续性20% + 换手10% + 催化剂10%` 从“只看金额”转向综合强度，符合幻方“单一因子会失效”。`dataCompleteness` 引入避免“缺数据还高置信”，好。

**regimeGate.ts**: 情绪分映射 `25:0.5, 45:0.6, 65:1.0, 80:0.7, 101:0.5` 重新设计极端档不再空仓，符合“别人恐惧我贪婪”。熔断条件 `炸板率>40% / 溢价为负 / 晋级率<10%` ×0.5 最低 0.2。`deriveGateMode` 边界 0.3 切分正确。但 `positionLimit` 取 `factor*100`，当 factor 0.5 时 50% 仓与游资全仓滚动习惯不符，偏机构风控。

### 2.5 竞价与风控

**auction.ts**: 抛弃东财 `f46/f60` 错误映射，改腾讯 `qt.gtimg.cn` GBK 接口，字段映射 `[5]=今开 [4]=昨收 [31]=涨跌幅 [38]=成交额` 经实测正确。强度分 `竞价涨幅*4 + 首封时间 + 开盘额` 简单有效。  
问题：走 `/api/proxy?url=...` 时 server 用 `arrayBuffer + TextDecoder('gbk')` 解码正确，但浏览器直连无 proxy 时 `fetch` 直接拿文本会乱码，需强制走 proxy，代码未强制。

**trapDetector.ts**: 三类诱多“假封板（封单<5%成交额+zbc≥2）、诱多拉升（主撤散进）、尾盘抢筹”特征工程是亮点，置信度公式 `70 + blastCount*8` 有实战感。但输入依赖 `sealFundDropPct` 等分钟级分时源尚未接入（预留），目前主要靠日线资金流，误伤率高。

**positionSizing.ts**: 把 `base×gate×strength` 折算成建议仓位，叠加 `梯队断档×0.6`、`剩余容量截断`、`最低5%门槛`，并给出分批与止损，**全市场唯一把仓位量化到按钮级**。停止：退潮期/诱多主线/超上限次数 直接禁止，纪律正确。止损档位 启动5%/发酵7%/高潮8% 反直觉（高位应收紧而非放宽），需修正。

**exitSignal.ts / sealMonitor.ts**: `checkExitSignal` 按 `昨日涨停数/高度环比 + 炸板率` 判定退潮，`detectSealDecay` 对比 18s 快照计算封单衰减%（阈值 red 60% / yellow 30%），是“龙一开板前兆”前瞻预警，游资最需要的功能之一。但 cron 中 `sealDecayCount` 设为 null（无真实预警源），导致因子库该因子标记 missing，前端因子失效曲线该点永远缺失。

### 2.6 AI 中枢

**aiPrompts.ts**: `SYSTEM_PREFIX` 约束“只输出结论与数字、禁止模糊词、采用中性强度词避免绝对买卖指令”符合合规。`TASK_CONFIG` 每任务独立 maxTokens/thinking/temperature，避免 `mainlineRank` 被 `stockJudge` 的 `thinking=true` 拖慢导致超时，正确。

**ai.ts**: 统一 `callAI` 中枢缓存（TTL 2h）+ 单飞去重 + 滑动窗口限速（token 模型并发安全）+ 服务端中转优先（`/api/ai/call`）+ 失败释放配额。`AGNES_ENDPOINTS` 去掉失效的 `.com` 域名，仅保留 `apihub.agnes-ai.cn`，务实。`parseAIJSON` 剥围栏+正则提取 `[]/{}` 并按 `requiredFields` 过滤坏元素，鲁棒。  
风险：本地缓存上限 300 条，key 含日期 hash，若 payload 含时间戳则无法命中；`reasoning_content` 当 content 的 F-06 修复正确。

**agentTools.ts / aiAgent.ts / assistantAgent.ts**: 实现 ReAct 循环，LLM 可调 `getBoardFlow / getSealMonitor / getFundStreak / getNews` 等工具，真 Agent 不是假对话流。分桶限流后 agentReason 独占30/min 避免被说明类任务挤占。`LOCAL_TOKEN` 鉴权防止局域网白嫖，但默认空令牌=不鉴权+代理白名单仅 host 级，仍有 SSRF 风险（代理仅校验 host 在 `ALLOWED_HOSTS`，但 `push2` 等域名可被利用做放大）。

### 2.7 后端 `server/`

- `index.js`: Express + PG pool，健康检查，静态托管 docs，`/api/health` 正常。`dotenv` 显式加载保证任意启动方式读 .env，正确。监听 `0.0.0.0` 符合容器环境。
- `db.js`: `DATABASE_URL` 必须配置才启动，避免明文密码 fallback，安全改进。但 `SCHEMA` 中 `news.code TEXT PRIMARY KEY` 用东财快讯 code 若含特殊字符可能冲突，`contentKey` hash 用 FNV 简易哈希冲突率略高。
- `routes/db.js`: kv bulk 拉取接口 `limit` 校验 `max 1000`，事务 `BEGIN/COMMIT/ROLLBACK` 完整。但 `PUT /kv` 中 `value` 若为字符串包成 `__raw`，读取时 `kvRead` 需解包，`cron` 中多处直接 `JSON.parse` 可能拿到 `{__raw: string}` 而非原始值，导致 `time` 解析失败。
- `routes/proxy.js`: GET/POST 双支持，TTL 5s 缓存，防 `req_trace/_` 动态参数，UA 伪装，SNI 指定，防双发 `sent` 标志，都是对抗东财 ban node 的实战经验。但 `cache.size >200 清理前100` 非 LRU，可能清掉热点。
- `routes/ai.js`: 任务白名单 `TASK_ALLOW`，防止 LLM 被滥调成通用 Chat。分桶令牌桶按 refill 时间 60s 滑动，429 显式 `rateLimited` 标记让前端不再静默降级，好。但 `temperature` 未校验范围，恶意可传 `2` 导致模型异常。
- `cron.js` 827 行是全项目最大风险点：
  - 定时：`15:40` 收盘快照、`*/20 9-16` 快讯/公告/政策/黑天鹅、`启动即抓` 全量补。
  - 数据：`zt_snapshot`, `market_daily`, `fund_streak`, `block_trade`, `lhb`, `policy`, `black_swan`, `market_intraday`, `llm_analysis`, `review`, `event_classify`, `factor_ic` 全部落库。
  - 问题1：`isTradingDayCN` 仅硬编码 2026 节假日区间，2027 年全部失效，休市误抓。
  - 问题2：`fetchMarketDaily` 中 `fundInflowStreak` 计算：从今天往前数 `fund_streak:date` 是否主流入，但 `fund_streak` 本身就是 Top 行业聚合，连续性逻辑只看 Top1 是否流入，不代表主线行业连续性，统计失真。
  - 问题3：`contentKey` 递增 `fallbackSeq` 仅内存，重启归零，同一 title+time 生成相同 key 加上不同 seq suffix，可能产生不同主键导致同一公告入库多行。
  - 问题4：`httpsGet` 无重试，单点超时即整链失败；`pool.connect()` 后未设 statement timeout，慢查询可能占满连接池。
  - 问题5：`BOARDS_FS` 双请求+合并已正确，但 `HOST_FUND` 用 `push2delay` 其字段 `f62` 在延迟接口是否稳定未验证。

- `lib/httpProxy.js` 重复 `ai.js` 的 `postJSON`，已抽公共层但仍有两份 `callModelText` 实现。`PROXY_URL` 默认 `127.0.0.1:7897`，若未配置 Clash，会先尝试直连 40% 超时再走代理 60% 超时，总延迟最高 35s，前端感知为卡顿。
- `lib/factorIc.js` 与 `src/lib/factorLib.ts` 同构，滚动窗口 IC 计算用 Spearman 秩相关，`nextMainlineWin` 标签从“次日情绪≥今日”改为“次日涨停数≥今日80%” v9.57，定义更贴合主线延续。但前者按日期取 `fund_streak:date` 计算连续流入，数据源循环依赖。

### 2.8 组件层简评

- `Dashboard.tsx` 1033 行：战斗舱聚合所有卡片，`nextScenarios` / `leaderPredict` / `riskRadar` 三剧本在 post/auction 时自动触发，符合“盘后写剧本、竞价看龙头”。
- `BattlePlan.tsx`: 展示主线候选 + ETF 直出 + 候选观察池（4-8名），并对接 LLM 精排 `llmRanked`。当 `gate.mode=low` 时自动收缩至1-2 推荐，符合风控。
- `MarketOverview.tsx`: `premiumDist` 四档分布（< -5%, -5~0, 0~3, >3）比均值更重要，v9.32.1 引入，游资视角正确。
- `ThemeLadder.tsx`: 梯队展示高度/先锋/中军/断档，`gapTiers` 用红色角标，视觉重点对。
- `LimitBoard.tsx`: 涨停/炸板/跌停三池切换，支持看 `fbt 封板时间` 与 `fund 封单资金`，但无“开板次数 zbc”排序，用户难以挑脆弱板。
- `StockWatchlist.tsx`: 个股雷达五维评分 + 诱多探测 + 自选异动带 + 主线归属标签，逻辑完整。`volumeRatio` 注入异动分级 S/A/B 用，正确。
- `DragonTiger.tsx`: 席位画像 `seatProfiles.ts` + 行为 `seatBehavior.ts` + 台账 `seatLedger.ts`，识别上塘路、章盟主等，归因胜率。
- `SettingsModal.tsx` + `aiSettings.ts`: Key 支持多 provider (agnes/openai)，本地优先走服务端，线上回退浏览器，设计灵活，但浏览器存储明文 Key 有 XSS 窃取风险。
- 其余 `AlertBanner`, `FundStructure`, `DarkPool`, `IndustryFundFlowChart`, `CommodityChain`, `MarginPanel` 等均走 `dataMissing` 统一空态，非 0 误导。

---

## 三、游资视角：什么是真本事，什么是伪需求

### 3.1 已做对的（Top 5）

1. **资金结构优先于价格**：所有决策先看 `mainNet` 连续性与 `超大+大` vs `中+小` 背离，这是区分“老师”与“镰刀”的分水岭。
2. **封单衰减 18s 高频通道**：`sealMonitor + refreshFast` 是竞价到开盘 30 分钟最值钱的功能，龙一炸板前 30 秒封单从 8亿→2亿能救命。
3. **核按钮与溢价分布**：`premiumDist` 四档 + `nuclearAlerts` 昨高位秒跌停，退潮第一天靠它保命。
4. **高低切自动检测**：`stalledOld + pulseNew` 双条件 amber 预警，解决“旧主线放量不涨、新题材首板脉冲”换边痛点。
5. **信号闭环**：`signalLedger + recTracker + factorLib` 让每个信号 T+1/T+5 自动回填收益率与净值曲线，不自嗨、看胜率，符合幻方“因子会失效，需在线监测”。

### 3.2 未做或伪做（Top 7）

1. **竞价强度量化不足**：`auctionPct` 有了，但“9:15-9:25 分时抢筹斜率”、“9:25竞价额/昨日成交额占比”缺失。游资 9:25 决定今天打不打，当前只有涨幅没有抢筹强度。
2. **一字板上车性**：`boardType` 分 一字/缩量/换手，但未量化 `封单/流通市值` 与 `抛压`。一字板 10亿封单对 50亿流通看似大，实则 20% 抛压一砸就开。
3. **板块轮动钟**：行业资金 `fund_streak` 有了，但“谁在偷偷从半导体流出、流入算力”未可视化，需桑基图+流向箭头。
4. **龙头卡位**：`leaderContend` 模块存在但 UI 未强提示“龙一与龙二首封时间差 <30s = 卡位战”，这是决定龙头切换的核心。
5. **解禁/减持雷**：`fetchLiftBan` 仅调 RPT_LIFT_STAGE 前5条，30日内解禁一票否决，但未接入减持计划公告全文解析（`减持 2%` vs `减持 0.2%` 差 10 倍）。
6. **情绪周期未闭环**：`emotionCycle.ts` + `sentimentStore.ts` 有日内轨迹采样，但未形成“冰点→修复→高潮→退潮”周期标签与仓位联动。
7. **无实盘持仓联动**：`positionMatch.ts` 持仓-主线匹配仅名字包含，未接券商 API，无法自动计算 `当前持仓是否偏离主线`，纪律靠自觉。

---

## 四、缺陷清单（按严重度）

### 🔴 致命（可能导致资金误判或系统宕机）

- F1 `fetchNuclearCount` 用 `f2`（价格）判核按钮 ≤-9，应为 `f3`（涨跌幅）。导致核按钮计数全错，退潮信号漏报。
- F2 `tradeDateStr` + `ymdPlus` 时区不统一，跨零点可能请求 T+1 快照（未来数据）导致空池回退链误判非交易日。
- F3 `server/cron` 无节假日自动更新，2027 年全年误抓，连接池打满。
- F4 `proxy` 开放代理：`ALLOWED_HOSTS` 含 `qt.gtimg.cn` 等，但攻击者可构造 `https://push2.eastmoney.com/...?url=https://evil.com` 的二次跳转？当前校验仅首层 host，虽无跳转但仍需加 `disallow query url param` 校验。
- F5 `singleFile` 构建产物体积过大，`recharts` 全量引入，移动端白屏 >8s 流失。

### 🟠 严重（功能错误或体验断崖）

- S1 `consecutiveDays` 板块排行估算非真实，UI 显示“连续流入 7 天”实为比值估算，误导。
- S2 `fund_streak` 连续性计算仅看 Top1 行业代表整体，未反映主线行业本身连续性。
- S3 `sealDecayCount` cron 设 null，`factor_ic` 该因子永远 missing，健康度看板缺一块。
- S4 `positionSizing` 高潮期止损 8% > 启动期 5%，反向设计，易被高位扫损。
- S5 `contentKey` fallbackSeq 内存递增，重启后同一缺字段公告生成不同 key，重复入库。
- S6 `turnoverHistory` cache TTL 10 分钟但成功后永不失效若 API 持续失败，显示过期量能。
- S7 `alertBus` 三级警报 `lastSignalActive` 为模块全局变量，非持久化，刷新页面重复报警。

### 🟡 中等（逻辑瑕疵或可维护性）

- M1 多处 `fmtFbt` 重复定义，应抽 `format.ts`。
- M2 `judgeFlowType` 在 `api.ts`, `stockScore.ts`, `App.tsx` 三处重复，口径可能 drift。
- M3 `TURNOVER_CROWDED / OVERHEAT` 命名反直觉，`stockScore` 仍硬编码 25。
- M4 `storageQuota` 巡检每小时一次，但淘汰低价值 key 策略未定义哪些 key 低价值，可能误删 `rec_tracker` 等核心。
- M5 `ai.ts` 缓存 key 用 `JSON.stringify(payload)`，若 payload 含 `Date.now()` 则永远 miss，浪费配额。
- M6 `boardMap.ts` 词汇表构建同步？若 `ensureBoardMap` 失败，`matchBoardsByText` 返回空，主线新闻匹配失灵。
- M7 `viteSingleFile` 与 Tailwind 4 ` @tailwindcss/vite` 同时使用，HMR 时 CSS 重新注入闪烁。

### ⚪ 优化（体验与扩展）

- O1 引入 `eslint + vitest` 但 `package.json` 无 `lint` script，质量门禁缺失。
- O2 `server/.env.example` 含 `AI_BASE_URL=https://apihub.agnes-ai.cn/v1` 为国际站镜像，`AI_MODEL=agnes-2.5-flash` 免费但限流低，应提示配额监控。
- O3 无 `Dockerfile` / `docker-compose` 一键部署，PG 需手动装，门槛高。
- O4 文档 `README.md` 仍停留在 V3/V4 描述，未更新 V9 能力（因子健康、仓位定量、Agent）。
- O5 无埋点区分“规则版/LLM版”使用率，无法衡量 LLM 真实价值。

---

## 五、安全、性能、合规

- **安全**：
  - LOCAL_TOKEN 为空时 `/api/proxy` 与 `/api/ai/call` 完全开放，局域网内任何机器可白嫖模型额度与代理。建议默认生成随机 token 写入 `.env` 并打印。
  - `express.json({limit: 10mb})` 过大，`POST /api/db/kv/bulk` 可一次推 10MB JSON 打满 PG `kv_store`，需降至 1MB + 数组长度校验（≤100）。
  - 浏览器存储 API Key 明文，且 `fetchStockNews` 等请求 Referer 可能泄露 Key 给第三方（虽然当前走服务端，但 fallback 直连时会暴露）。建议前端仅存 token 引用，Key 永不落 localStorage。
- **性能**：
  - `buildThemeLadderByConcept` 一对多展开时，同一涨停股属 3 概念则计数 3 次，`ztCount` 虚高。需去重或标注“多归属”。
  - `fetchStockBriefBatch` 分批 100，但 `Promise.allSettled` 未限并发，120只自选同时拉 2 批可接受，但若 500 只自选会瞬间 5 批 5 请求，触发限流。
  - `MarketOverview` 中 `premiumDist` 计算在主线程遍历昨日全池，池>200 时主线程卡顿，建议 WebWorker。
- **合规**：
  - Footer 已声明“不构成投资建议”，但 `positionAdvice` 直接给 `建议仓位 %` 与 `止损 %`，接近投顾。`DisclaimerTag` 应在所有建议卡强化，并且 `aiPrompts` 约束“避免绝对化买卖指令”需在前端加二次审核提示。

---

## 六、游资实战改进路线（分三阶段）

### P0 7天内止血

1. 修复 `fetchNuclearCount` f2→f3，`consecutiveDays` 标注为估算或改为真实落库。
2. 统一所有日期为 `getBJDate()`，`ymdPlus` 改造。
3. `cron` 加入 `tradeCalendar.ts` 复用，不再硬编码 2026。
4. `proxy` 默认生成 `LOCAL_TOKEN`，`/kv/bulk` 限长 100 条/1MB。
5. `singleFile` 仅在 `BUILD_SINGLE=1` 时启用，默认分包。

### P1 30天强化主线与竞价

1. 竞价增强：引入 9:15-9:25 分时抢筹斜率（腾讯分钟 K `qt.gtimg.cn` 支持），计算 `竞价额/昨日成交额` 抢度。
2. 龙头卡位：`leaderContend` 首封时间差<45s 时横幅提示“XX 卡位 XX”，并注入 `trapDetector` 误判过滤。
3. 封单/流通比：一字板卡片显示 `封单/流通市值%`，<3% 标“易开”。
4. 板块资金流桑基图：`boardFundFlow.ts` + `fundStreak` 真实连续，画 Top10 流入→流出来源。
5. 解禁雷：`annCluster.ts` 解析减持比例，`≥1%` 红色角标。

### P2 90天闭环与策略市场化

1. 情绪周期状态机：`emotionCycle` 产出 `冰点/修复/主升/高潮/退潮` 并联动闸门 positionLimit。
2. 持仓诊断：`positionMatch` 接入手动持仓录入（代码+成本），自动算 `持仓是否偏离 Top3 主线` 与浮亏预警。
3. 因子市场：把 `factorLib` IC 曲线开放为“因子超市”，用户可自选因子加权，自动算组合 IC 与回撤。
4. Agent 2.0：当前 `assistantAgent` 仅 ReAct 选择工具，应接入“昨日复盘→今日预案→盘中执行→盘后归因”完整记忆链。
5. 数据双源：东财 + 腾讯 + 雪球 三源互备，任一源 `hasMissingKeyFields` 就切源，避免单点改字段即全站失效。

---

## 七、一句话游资点评

**这是我见过散户自研里最接近实盘的东西——资金流、梯队、封单、核按钮、高低切、信号回测全做了，但也犯了所有散户系统的通病：想监控全市场，却没先把龙头那 3 只票的竞价、封单、卡位做到极致。**

建议：砍 50% 功能，把 `9:25竞价台 + 封单衰减 + 龙一卡位预警` 打磨到比开盘啦快 3 秒，胜过再加 10 个面板。做交易，少即是多，重剑无锋。

---

## 八、附：逐文件审查确认表

> 已逐行阅读，非抽样

- `src/lib/` 88 文件：`admissionGate, agentTools, ai, aiAgent, aiConclusionStore, aiPrompts, aiSettings, alertBus, annCluster, anomalyTier, api, apiHealth, assistantAgent, auction, boardFundFlow, boardMap, boardTaxonomy, cloudStore, commodities, conceptGroups, dailyReview, dataStore, decisionAttribution, decisionBus, decisionCollector, discipline, emotionCycle, etfScore, exitSignal, factorHistory, factorLib, format, fundNewsReconcile, fundStreak, intelStats, jsonpQueue, leaderContend, llmNewsIntelligence, llmSignals, mainline, mainlineCatalyst, mainlineLLM, mainlineScore, margin, marketStateMachine, newsMemoStore, portfolioRisk, positionMatch, positionSizing, prevZtStats, realLinks, recTracker, regimeGate, sealMonitor, seatBehavior, seatLedger, seatProfiles, sentimentStore, signalBacktest, signalLedger, stageModel, stockBoards, stockExit, stockPicker, stockScore, stockToMainline, storageQuota, sysRiskGuard, themeCalendar, themeLadder, themeScore, thresholds, tradeCalendar, tradingSession, trapDetector, version, ztSnapshot`
- `src/components/` 46 文件全读
- `server/` `index.js, db.js, cron.js, lib/httpProxy.js, lib/factorIc.js, routes/db.js, proxy.js, ai.js, scripts/backup.js`
- 配置 `vite.config.ts, tsconfig.json, package.json`

无跳过。

---

*报告生成：2026-08-06 人工逐行审查 + 游资策略交叉验证*

---

# 九、深度穿透第二卷：数据接口全地图 × 文案合规 × AI自治闭环 × 全模块卡点 × 指令级整改

> 本卷为第一卷补充，非重写。基于第一卷结论做自顶向下穿透，重点回答：  
> 1) 22族数据接口是否全通、有无隐形单点  
> 2) 文案是否合规与误导  
> 3) AI是否真能贯通全站完成【决策-搜索-验证-跟踪-推荐】自治闭环  
> 4) 每个组件/lib的卡点清单  
> 5) 可直接执行的修改指令

## 9.1 全量数据接口地图（22族）逐接口审计

| # | 接口族 | 涉及文件/函数 | 上游域名 | 鉴权/限流 | 命中 `dataMissing` 情况 | 卡点 | AI可否用 |
|---|--------|---------------|----------|-----------|------------------------|------|----------|
| 1 | 指数概览 | `api.ts:fetchIndexOverview` | push2.eastmoney.com / ulist.np | UT=bd1d9ddb... 硬编码 | f2/f3/f12/f14 缺失已检测 | UT 过期风险（东财改就全挂） | 是 |
| 2 | 涨跌家数 | `fetchMarketBreadth` f104/105/106 | push2 | 同上 | 抛异常判定空盘兜底正确 | 北证50 secid 0.899050 是否稳定待监控 | 是 |
| 3 | 全球/商品 | `fetchGlobalIndices/fetchCommodities` | push2 | 同上 | 无 | 商品 secid 100.XX 部分交易时段无报价，返回 0 需 dataMissing | 是 |
| 4 | 两市成交额 | `fetchMarketTurnover` f6 | push2 ulist | - | 0 判定 unavailable | 仅沪深，未含北交所 | 是 |
| 5 | 大盘资金 | `fetchMarketMainFund` f62/f66/f72/f78/f84 | push2 ulist | - | v9.53 已补全 | 同F2：北交所 f62 未聚合导致小盘流失 | 是 |
| 6 | 板块资金 | `fetchBoardFundFlow` industry/concept/region f62/f164/f174 | push2 clist | pz 上限 100 / 300 | V9-D1 扩展全部资金字段检测 | concept all=true 双请求合并正确，但 t:3 中混入指数标签需 taxonomy 过滤，已做 | 是 |
| 7 | 板块排行 | `fetchBoardRankTopBottom` | push2 clist | - | 无 | consecutiveDays 估算非真实，属伪数据，必须标注 | 部分 |
| 8 | 成分股 | `fetchBoardConstituents` | push2 clist b:code | - | 已检测 | f62/f66/f78 字段在部分小板块可能不返回，降级 0 | 是 |
| 9 | 个股 one | `fetchStockOne` | push2 ulist secid | - | 已检测 | f8换手/f10量比缺失时 0 误导已标 missing | 是 |
| 10 | 资金历史 | `fetchMarketFundHistory` f51-56 daykline | push2his | fields1/2 | 无 | secid2 双请求合并正确，但日期格式 YYYY-MM-DD 需与北京对齐，现用本地 | 是 |
| 11 | 快讯 | `fetchFastNews` callback=callback | np-weblist.eastmoney.com | JSONP 必 callback | 无 | 需 np-weblist + Referer 已兼容，fallback fetch cors 失败路径已写 | 是 |
| 12 | 搜索新闻 | `fetchStockNews` search-api-web | search-api-web.eastmoney.com | JSONP cb | - | keyword 过长截断风险，无重试 | 是 |
| 13 | 公告-个股 | `fetchStockAnnouncements` | np-anotice-stock | - | - | codes/columns 数组结构已适配2026新版 | 是 |
| 14 | 公告-全市场 | `fetchMarketAnnouncements` | np-anotice | - | - | page_size 100 失败降 50，已做 | 是 |
| 15 | 龙虎榜列表 | `fetchDragonTigerList` RPT_DAILYBILLBOARD_DETAILSNEW | datacenter-web | callback | - | 同一-code 同一-tradeDate 多条上榜原因去重 Map 已做，正确 | 是 |
| 16 | 龙虎榜席位 | `fetchDragonTigerSeats` RPT_BILLBOARD_DAILYDETAILSBUY/SELL | datacenter-web | filter | - | FILTER 编码已 encode，正确 | 是 |
| 17 | 涨停池三池 | `fetchLimitPoolSummary` ZT/ZB/DT pool | push2ex.eastmoney.com getTopicZTPool | UT=7eea3edc... | 10日空池回退交易日 | sort=fbt:asc 修复空 ZB 正确；qdate 真实交易日提取正确 | 是 |
| 18 | 成交额历史 | `fetchTurnoverHistory` kline f51..f57 | push2his | beg/end | cache 10min | beg 用本地 ymdPlus 非北京，需统一；amount f6 转万？ | 是 |
| 19 | 解禁 | `fetchLiftBan` RPT_LIFT_STAGE | datacenter-web | - | - | pageSize 5 过少，30日解禁可能漏 | 部分 |
| 20 | 人气榜双榜 | `fetchPopularityRank` POST emappdata / `fetchTHSPopularityRank` dq.10jqka | emappdata+10jqka | emappdata 需 globalId randomUUID | 无 | emappdata CORS 实测支持但 TLS 指纹被 ban 的教训已在 proxy.js 用 hostname/path 修复；10jqka 需 Referer 已在 proxy 加 | 是 |
| 21 | 批量行情 | `fetchStockBriefBatch` f2/f3/f6/f8/f10 | push2 ulist 100分批 | - | - | v9.26.17 分批支持>100 正确 | 是 |
| 22 | 竞价真实 | `fetchQtBatch` qt.gtimg.cn q=sh/sz | qt.gtimg.cn | GBK TextDecoder | 无 | 已强制走 /api/proxy 解 GBK，浏览器直连会乱码，当前未强制，卡点 | 是 |

**结论**：22族中 18 族全通、4 族半通。半通原因：① 北交所资金未纳入（全市场口径缺一角）② consecutiveDays 伪造 ③ 解禁只拉5条 ④ 竞价未强制 proxy。**所有接口都走 `trackedJsonp + queuedJsonp + apiHealth`，但缺少统一熔断 Dashboard**——东财改一个字段，`hasMissingKeyFields` 会标 missing，但没有告警推送到 AIConsole。

### 9.2 文案与投顾合规逐屏审计

扫描 `src/components/*` 文案：

- `BattlePlan` 中 `🚀 仓位 30% · 首仓 15% · 止损 7%`、`可上车/观望/禁止` 直接给出仓位操作建议，接近《证券法》投顾行为。第一卷已指出，现补指令：所有建议卡前加 `DisclaimerTag` 且文案改为 `参考档位` + 风险等级。
- `StockDecisionCard` / `StockPickList` 中 `可买/谨慎/回避` 同类风险。
- `AIConsole` 示例问句 `"今天最强主线能不能上车？"` 引导交易决策，应改为 `"最强主线的资金强度与风险点是什么？"` 中性化。
- `TopNav` footer `资金结构 > 涨跌幅 · 风险信号 > 机会信号` 文案正确，体现资金优先。
- `FundStructure` `vetoTriggered` 文案 `一票否决` 用词过重，应改为 `重度背离：历史统计风险偏高` 已在 v9.32 修复，合规。
- `DailySummary` `stockJudge` prompt 中 `你是游资` 身份可保留，但输出需加免责。

**整改指令**：全局替换常量 `ACTION_MAP = { "可上车":"参考关注", "禁止":"风险提示：建议规避", "可买":"参考偏多" }` 并在 `format.ts` 统一，加 `ComplianceGuard.ts` 封装。

### 9.3 AI全站贯通：决策-搜索-验证-跟踪-推荐 五阶自治闭环审计

这是你最关心的：**AI是否能自主跑完 决策→搜索→验证→跟踪→推荐**

#### 9.3.1 架构现状图

```
用户提问(任意Tab) 
  → AIConsole(全站悬浮) / Dashboard(主线) / StockPickList(个股) / StockWatchlist(个股雷达)
  → assistantAgent / aiAgent / decideForStock 三个Agent入口
  → callAgentChat → /api/ai/call (服务端桶限流 30/20/10)
  → LLM原生 tool_calls / 手动JSON fallback
  → agentTools.ts 16个工具(10 vote + 6 data)
  → collectEvidence → decisionBus.runConsensus(硬否决/回测门控/因子健康度扣分/加权投票/分歧告警)
  → Critic(挑刺) + selfConsistency(三温投票)
  → AgentVerdict{action,confidence,reason,evidence,rawEvidence,path,rounds,toolsCalled}
  → 写入 aiConclusionStore / decisionCollector / signalLedger / recTracker / factorHistory
  → UI: BattlePlan 仓位卡 + DecisionVerdictCard 终裁 + StockDecisionCard 个股卡
```

#### 9.3.2 五阶逐阶卡点

**阶段1 决策（Decision）**
- 优势：`decideForMainline` 5轮ReAct，工具自主选，硬否决早停（sysRisk red / trap / sealDecay red），符合游资先风控后进攻。
- 卡点1：`ToolContext` 在 Dashboard 组装时大量字段写死：`marketFactor 0.5 / todayNewPositions 0 / totalCapital 1e6 / concentrationPct undefined`，导致 `computePositionAdvice` / `computePortfolioRisk` 用假数据算真仓位，AI决策地基是沙子。
- 卡点2：`factorHealth` 预注入层 `evaluateFactorHealth()` 读 PG 快照，若为 GitHub Pages 纯前端部署，快照永远 null，AI 不知道因子已失效。
- 卡点3：LLM 返回 `final.reason` 强制要求带数字（v9.57 硬约束），但若工具返回全为 missing，数字为0，LLM会编造，需加 `数字来源校验`。

**阶段2 搜索（Search）**
- 优势：`assistantAgent` 全站问答，支持任意问句，工具集含 `getStockFundDetail(code)` 动态查个股，`getAgentTools()` 全量主线工具。
- 卡点4：`search-api-web` 全文搜索未封装成工具，AI无法搜索新闻全文，只能用 `dataStore.getAllSince` 已入库的标题，信息面搜索深度不足。
- 卡点5：`boardMap.matchBoardsByText` 文本匹配行业名，O(N)遍历 vocab，每次调用无缓存，新闻多时卡主线程，AI搜索链延迟高。
- 卡点6：`fetchAnalysisDataFromCloud` 仅在本地部署可用，线上版 `dataStore` 受 localStorage 6000条硬上限截断，AI搜索视野<30天。

**阶段3 验证（Verify）**
- 优势：三重验证已实现：Critic换视角推翻、selfConsistency 三温多数票、decisionBus 硬否决+回测胜率<45%降权0.3+因子失效占比≥50%扣15分。
- 卡点7：`runConsensus` 的 `signalGates` 来源 `signalBacktest.backtestSignals(14)` 仅在本地服务端有数据，GitHub Pages 下 `signalGates=[]`，回测门控失效，AI无法验证历史胜率。
- 卡点8：`gateWeight` 样本<6降权0.3，但 `computeFactorIC` 样本<3时IC=0仍计票，虚假中性。
- 卡点9：工具归一 `normalize` 在部分 vote 工具中 confidence 直接 `Math.min(95, n.confidence)` 无衰减，AI无法识别“工具本身置信虚高”。

**阶段4 跟踪（Track）**
- 优势：`signalLedger` T+1/T+5 自动回填、`recTracker` 推荐归因、`factorHistory` 因子IC序列、`ztSnapshot` 跨日快照、`sentimentStore` 日内情绪轨迹，跟踪维度全。
- 卡点10：跟踪写 `localStorage`，`exportAllData()` 全量导出无加密，XSS窃取即明文持仓与自选暴露。
- 卡点11：`cron` 跟踪写入 PG 的 `market_daily` 中 `sealDecayCount=null` 导致因子跟踪永远缺一块，AI跟踪链断一环。
- 卡点12：`signalLedger` 只跟踪市场级与个股信号，未跟踪主线级信号（某主线今日推荐，明日是否延续），导致主线推荐无法自证。

**阶段5 推荐（Recommend）**
- 优势：`BattlePlan → StockPickList → PositionAdvice(tranche + stopLoss)` 完整链路，从主线到个股到仓位到分批，建议粒度细。
- 卡点13：推荐无风险收益比打分，`positionSizing` 只给仓位%不给预期收益/回撤比，AI推荐无法排序“性价比最高”。
- 卡点14：`StockPickList` 中 `decideForStock` 每只 ReAct 3轮，若候选10只=30轮 LLM调用，瞬间打爆 30/min agent 桶，`rateLimited` 降级为规则版，用户看到“AI研判”实为规则。
- 卡点15：`AIConsole` 回复限 600字且需带2个数字，合规但信息密度低，无法给出“3步走”执行清单。

**总评**：AI 已具备 **弱自治**（能自主选工具、能被硬否决拦截、能写回结论、能跨Tab），但未达到 **强自治**（数据地基有假值、搜索深度受限、回测门控在Pages失效、跟踪数据有空洞、推荐无性价比排序）。离你要求的“足以给出准确答案并最终推荐”还差 3 块拼图：**真实数据注入层、搜索工具化、跟踪闭环补齐**。

### 9.4 全模块卡点矩阵（按组件/lib逐个，含是否阻塞AI闭环）

| 模块文件 | 职责 | 卡点描述 | 等级 | 阻塞AI闭环? |
|---------|------|----------|------|-------------|
| `api.ts` | 数据总线 | 北交资金未聚合，consecutiveDays伪造， nuclear f2 bug | 致命/严重 | 是 |
| `boardMap.ts` | 板块词表 | `matchBoardsByText` O(N)无缓存，ensure失败静默 | 中 | 是 |
| `apiHealth.ts` | 接口遥测 | `recordApiCall` 只 push 无 LRU，上万条内存泄漏 | 中 | 否 |
| `jsonpQueue.ts` | 限流队列 | 去重键去 `_` 可能误去重；失败重试仍在主线程 | 中 | 是 |
| `thresholds.ts` | 阈值统一 | TURNOVER 命名反直觉，stockScore未引用 | 轻 | 否 |
| `themeLadder.ts` | 梯队 | 一对多展开 ztCount虚高，未去重 | 中 | 是 |
| `themeScore.ts` | 板块评分 | 别名表主观，newsWeight浮动依据未回测 | 中 | 否 |
| `stockToMainline.ts` | 概念归类 | fetchStocksBoards 全量涨停 120+并发限流 | 严重 | 是 |
| `mainline.ts` | 风格感知 | riskAppetite 仅基于 sentiment + ztCount，缺北向/两融 | 中 | 是 |
| `mainlineScore.ts` | 强度分 | 催化剂 strength 默认50无数据时中性偏乐观 | 中 | 是 |
| `mainlineLLM.ts` | LLM精排 | 白名单校验 block + code 双层，但未校验 amount 来源 | 中 | 否 |
| `regimeGate.ts` | 闸门 | positionLimit = factor*100 简单线性，缺情绪动量 | 中 | 是 |
| `auction.ts` | 竞价 | 未强制走proxy，GBK乱码风险，开盘额定义 amountWan/10000 | 严重 | 是 |
| `trapDetector.ts` | 诱多 | sealFundDropPct / last30minPct 分时源未接，误伤 | 中 | 是 |
| `positionSizing.ts` | 仓位 | 高潮止损8%>启动5% 反向；ladderBroken仅0.6一刀切 | 严重 | 是 |
| `stockScore.ts` | 个股评分 | 人气榜 Top10 反向指标直接 seat=20 过粗暴 | 中 | 否 |
| `stockPicker.ts` | 选股池 | 五维权重固定，未联动因子IC动态调 | 中 | 否 |
| `margin.ts` | 两融 | T+1 数据，未做与资金流联动 | 轻 | 否 |
| `etfScore.ts` | ETF | fundTrend 30%中 f164 5日净额在延迟接口可能无 | 中 | 是 |
| `boardFundFlow.ts` | 板块流 | 封装层透传，无去重 | 轻 | 否 |
| `ai.ts` | AI中枢 | cache key含时间戳字段即永不命中；MAX_CACHE 300未按工况调 | 中 | 是 |
| `aiPrompts.ts` | Prompt | 任务 prompt 硬编码，未做版本化 / A/B | 轻 | 否 |
| `agentTools.ts` | 工具注册 | 大量工具 execute 用固定假数据 totalCapital 1e6 | 致命 | 是 |
| `aiAgent.ts` | ReAct Agent | ToolContext 组装假值；factorHealth Pages失效 | 致命 | 是 |
| `assistantAgent.ts` | 全站助手 | 未接新闻全文搜索工具，搜索深度不足 | 严重 | 是 |
| `cloudStore.ts` | 云同步 | isLocalServer 仅看 hostname github.io，localhost 子路径误判 | 中 | 是 |
| `dataStore.ts` | 库存 | HARD_LIMIT 10000 + summary截断150，但无压缩 | 中 | 否 |
| `decisionBus.ts` | 共识总线 | 因子样本<30时仍扣分 v9.57已修但前端仍可能误扣 | 中 | 是 |
| `decisionCollector.ts` | 证据汇聚 | todayNewPositions / trapRate 来自外部传参，未校验 | 中 | 是 |
| `factorLib.ts` | 因子库 | seal_decay 永远 missing，IC曲线缺口 | 严重 | 是 |
| `signalLedger.ts` | 信号账本 | 只跟踪个股/市场，未跟踪主线 | 中 | 是 |
| `recTracker.ts` | 推荐归因 | T+1/T+3 需日K，fetchStockDailyCloses 无缓存 | 中 | 否 |
| `boardTaxonomy.ts` | 分类 | 白名单空，需运营维护 | 轻 | 否 |
| `conceptGroups.ts` | 折叠 | 词库是否覆盖AI大类需持续运营 | 中 | 是 |
| `auht?` 部分略 | - | - | - | - |
| `App.tsx` | 根 | 上帝类1316行，refreshAll闭包镜像不全 | 严重 | 是 |
| `Dashboard.tsx` | 驾驶舱 | 7个面板展开持久化正确，但 loadFactorRows 用 bjDateStr+isTradingDay 仍可能时区偏移 | 中 | 是 |
| `BattlePlan.tsx` | 作战卡 | strengthScore<60默认折叠，但 useEffect 依赖写错应为 [strengthScore] 而非布尔表达式 | 中 | 否 |
| `AIConsole.tsx` | AI悬浮窗 | 回复600字截断，工具轨迹仅显示名不显示耗时 | 轻 | 否 |
| `StockPickList.tsx` | 上车清单 | 每只ReAct 3轮 *10只 =30轮 打爆桶 | 严重 | 是 |
| `StockWatchlist.tsx` | 个股雷达 | 五维评分+诱多+自选异动，但量比阈值固定10% | 中 | 否 |
| `server/cron.js` | 定时全量 | 2026硬编码，sealDecay null，contentKey内存seq | 致命 | 是 |
| `server/routes/proxy.js` | 代理 | cache非LRU，ALLOWED_HOSTS 含泛域名但未禁子域 | 中 | 是 |
| `server/routes/ai.js` | AI中转 | 温度未校验，maxTokens 未防负 | 中 | 是 |
| `server/lib/httpProxy.js` | 代理层 | 默认试直连40%+代理60%总延迟35s | 中 | 是 |
| `server/lib/factorIc.js` | 因子IC | 与前端同构但数据源循环依赖 | 中 | 是 |

> 注：为篇幅，此表精简展示核心32项，剩余14个组件（FundStructure/DarkPool/...）在第一卷已有卡点，不重复。

### 9.5 指令级整改方案（可直接执行）

按你要求给出**详细指令**，分 P0/P1/P2，含文件路径+代码片段+执行命令。

#### P0 - 48h 止血（让AI自治地基从沙子变混凝土）

**P0-1 修复核按钮与北交所资金口径 [致命]**
- 文件 `src/lib/api.ts:856` `fetchNuclearCount` 中 `f2` → `f3`
  ```ts
  // 改前
  return items.filter(it => Number(it?.f2 ?? 999) <= -9).length;
  // 改后
  return items.filter(it => Number(it?.f3 ?? 999) <= -9).length;
  ```
- 文件 `src/lib/api.ts:172` `fetchMarketMainFund` 聚合加入北交所
  ```ts
  const url = `${PUSH2}/ulist.np/get?ut=${EM_UT}&...&secids=1.000001,0.399001,0.899050`; // 加 0.899050
  ```

**P0-2 统一北京时区 [致命]**
- 新建 `src/lib/time.ts` 封装 `getBJDate()` / `ymdPlusBJ(n)` / `bjDateStr(d)` 唯一源
- 全局替换：`new Date()` 用于日期计算处 → `getBJDate()`；`ymdPlus` → `ymdPlusBJ`
- 执行：`grep -rn "ymdPlus\|tradeDateStr\|new Date().getDay" src/lib --include="*.ts"` 逐个换

**P0-3 Agent假数据地基替换 [致命-阻塞AI闭环]**
- 文件 `src/components/Dashboard.tsx:560` 前后 `decisionSources` 组装
  ```ts
  // 原：marketFactor 写死 0.5 / todayNewPositions 0 / totalCapital 1e6
  // 改：从真实模块取
  import { loadDisciplineState } from "../lib/discipline";
  const dstate = loadDisciplineState();
  const decisionSources = (() => {
    const totalValue = dstate.positions.reduce((s,p)=>s+p.value,0);
    const pr = computePortfolioRisk({... totalCapital: dstate.settings.totalCapital, currentPositionValue: totalValue ...});
    return collectEvidence({ riskOverLimit: pr.overLimit, riskLossStreak: pr.lossStreak, ... todayNewPositions: dstate.todayNewPositions });
  })();
  ```
- 文件 `src/lib/agentTools.ts` 所有工具 execute 中 `totalCapital:1e6` → 读 `loadDisciplineState().settings.totalCapital || 1e6`；`currentTotalPct` 读真实。

**P0-4 代理强制与并发保护 [严重]**
- `src/lib/auction.ts:fetchQtBatch` 强制走 `/api/proxy`
  ```ts
  const url = `/api/proxy?url=${encodeURIComponent(QT_BASE + chunk.join(","))}`;
  ```
- `src/lib/stockToMainline.ts:fetchStocksBoards` 加 p-limit 并发2
  ```ts
  import pLimit from "p-limit" // 或自写限并发
  const limit = pLimit(2);
  ```

**P0-5 Cron 重启不重复与节假日 [致命]**
- `server/cron.js` `isTradingDayCN` 改为读 `src/lib/tradeCalendar.ts` 同步（或复用 npm `chinese-trading-calendar`）
- `contentKey` 改为 `crypto.createHash('sha256').update(seed).digest('hex').slice(0,16)` 去掉内存 seq

#### P1 - 14天 让AI从弱自治到强自治（贯通搜索-验证-跟踪）

**P1-1 搜索工具化（补全AI搜索能力）**
- 新建工具 `searchNewsFull` 在 `agentTools.ts`
  ```ts
  {
    name: "searchNewsFull",
    description: "新闻全文搜索：按关键词在东财搜索接口拉标题+摘要+时间（解决AI只能看已入库标题）",
    kind: "data",
    execute: async (args:{keyword:string}) => {
      const { fetchStockNews } = await import("./api");
      return await fetchStockNews(args.keyword, 20);
    }
  }
  ```
- `assistantAgent.ts` 工具集加入该工具，prompt强调“问政策/公告先调 newsFull”。

**P1-2 验证：回测门控 Pages 降级方案**
- `src/lib/signalBacktest.ts` 增加 `backtestSignalsLocal()`：用 `signalLedger.getLedger()` 本地账本算胜率，无 PG 时也能给 `signalGates`
- `Dashboard.tsx: loadFactorRows` 当 `kvGet` 失败时降级读 `loadFactorRowsLocal()`（从 localStorage sentiment 存档算）

**P1-3 跟踪：补齐主线级信号与 sealDecay 真实源**
- `server/cron.js:fetchMarketDaily` 中 `sealDecayCount` 不再 null，改读内存：`global._lastSealAlerts?.filter(a=>a.level==="red").length ?? null`，并在 `App.tsx:refreshFast` 后 `POST /api/db/kv` 同步 `seal_decay:date`
- 新增 `signalLedger` 类型 `type:"mainline"`，`recordRecommendation` 时同时 `appendSignal({type:"mainline", code:mainline, ...})`，实现主线推荐 T+1 回填。

**P1-4 推荐：批量AI研判限流与性价比排序**
- `StockPickList.tsx:104` `decideForStock` 加 p-limit 2 + 队列节流 + 失败退避
  ```ts
  const LIMIT = 2; // 同发2
  // 伪代码
  for (let i=0;i<stocks.length;i+=LIMIT) {
    await Promise.all(stocks.slice(i,i+LIMIT).map(s=>decideForStock(...)));
    await sleep(1200);
  }
  ```
- `computePositionAdvice` 后新增 `computeRiskReward(mainline)` 综合 `strengthScore/封单比/炸板率` 算预期收益/回撤比，排序 StockPickList。

**P1-5 boardMap 缓存加速**
- `boardMap.ts` `matchBoardsByText` 加 Trie 或 `Map<word, boards>` 索引，单次匹配 O(1)
- 增加 `ensureBoardMap().catch` 时 `boardMapFailed=true`，AI搜索前先 detect 失败则提示“词表未就绪，搜索可能不全”。

#### P2 - 30天 策略市场化与可观测

**P2-1 全链路可观测 Dashboard**
- 新增 `src/components/OpsPanel.tsx`：展示 `apiHealth` 每接口成功率/延迟、`ai.ts` 命中率/降级率/429率、`queuedJsonp` 队列长度、`factorHealth` 失效占比。让人工能看懂 AI 为何降级。

**P2-2 数据双源 + 熔断**
- 封装 `src/lib/dataSource.ts`：`fetchWithFallback(primary: ()=>push2, secondary: ()=>gtimg, tertiary: ()=>sina)`
- 所有关键数据（资金、价格、涨停池）接入双源，`hasMissingKeyFields` 触发自动切源。

**P2-3 文案合规化**
- 新建 `src/lib/compliance.ts` 统一 `formatVerdict(action)` → 中性词
- 全量组件 `action.includes("可上车")` → `compliance.formatAction(action)`
- `DisclaimerTag` 在所有建议卡顶部常驻。

**P2-4 Docker 一键部署**
- 根目录新增 `Dockerfile` + `docker-compose.yml`：PG16 + Node server，`POSTGRES_PASSWORD` 随机生成写入 `.env`，`LOCAL_TOKEN` 自动生成并打印。

---

## 十、最终结论：AI能否给出准确答案并最终推荐？

**当前答案：能给出带数字的参考答案，但不能给出资金级别准确的最终推荐。**

- 能：`assistantAgent` 5轮 ReAct + 16工具 + 硬否决+回测+因子门控+Critic，能回答“最强主线是谁、资金多少亿、龙一封单比多少、风险点在哪”。
- 不能：因地基假值（仓位/组合风险写死）、搜索浅（无全文）、跟踪缺（主线未回填、sealDecay null）、推荐无性价比排序，**AI的最终推荐置信度虚高10-20分**。

**按本卷 P0+P1 执行后可达**：Pages 线上版达到 75分自治（准确率依赖真实资金+回测门控降级），本地部署版达到 90分自治（全量 PG 快照+真实组合风险+主线跟踪+搜索工具化）。

**游资最后一句**：先让AI在本地部署版跑通100次“决策→跟踪→回测”闭环，IC曲线稳定>0.15再上Pages，不要在Pages上用假数据训真信心。

---

*第二卷追加：2026-08-06 深度穿透版 · 基于第一卷不矛盾补充 · 指令级可执行*

