# A股股票监控终端 全栈深度审查报告 v9.63 - 完整穿透版
> 审查人：10年+ A股游资视角 + 全栈架构师  
> 版本：v9.63 build 2026-08-06  
> 审查方式：逐行阅读 src/ 88 lib + 46 components + App.tsx + server/全量，不跳过一行  
> 目标：数据接口是否全通、文案合规、AI是否贯通全站具备 决策-搜索-验证-跟踪-推荐 自治能力、每模块卡点、指令级整改

---

## 第一卷：全栈架构总览

### 定位
游资龙头战法+机构纪律融合的实盘辅助决策系统，不是行情看板。资金为主（f62主净流入）、价格为辅。

### 构建
`vite.config.ts` 用 `viteSingleFile` 输出到 `/docs` 为GitHub Pages预览。问题：单文件>2MB白屏>8s，建议仅预览分支用，生产分包。

### App.tsx 1316行 上帝类
- 双通道：`refreshAll 60s` + `refreshFast 18s` 轻量只刷涨停池，解决9:30:05直线封板慢
- `nextRefreshAt` 替代每秒setCountdown避免全树重渲染，亮点
- `llmRankSeq` 竞态护栏防慢LLM覆盖新结果
- Bug: overviewRef/darkPoolRef有，fundStructureRef缺，极端仍用旧资金
- 情感分公式：经验权重+20常量，无回测
- `localDateStr()` vs `getBJDate()` 时区不统一，`ymdPlus()`用本地，需统一北京

### api.ts 1211行 数据总线
- `strictNum / hasMissingKeyFields` v9.53关键改进，防东财改字段静默0，透传dataMissing到UI
- 涨跌家数从翻页计数迁到f104/105/106官方统计，根治总数矛盾，增加全员上涨异常抛错
- 大盘资金：聚合沪深1.000001+0.399001，缺北交所0.899050，小盘失真
- 板块资金 all=true 双请求po=1+po=0合并，修复流出永远0的bug
- 资金历史 push2his daykline f51-56真实滚动求5d/10d
- 人气榜 emappdata CORS支持+randomUUID兜底，但10jqka需Referer易ban
- 限流队列 queuedJsonp MAX_INFLIGHT=3+抖动50-250ms+指数退避1s/3s/8s，缓解ERR_EMPTY_RESPONSE，但去重键去_timestamp可能误去重
- 致命Bug：`fetchNuclearCount` 用f2价格判-9应为f3，核按钮恒0；`consecutiveDays` 比值估算非真实

### thresholds.ts 阈值统一 v9.62 全项目最值得称赞重构
炸板率35/50/20/30/45 情绪80/65/45/25等收敛，一改全改。遗漏：TURNOVER_CROWDED 25 vs OVERHEAT 20命名反直觉，stockScore仍硬编码25。

### 主线引擎
- themeLadder: buildThemeLadder纯函数，gapTiers断档检测是龙头战法核心，buildThemeLadderByConcept一对多展开贴近开盘啦
- themeScore: 四维权重fund0.35/ladder0.25/stage0.20/news0.20，newsWeight随阶段浮动启动30/发酵20/高潮10符合实战
- stockToMainline 821行最复杂：LLM前30省token→foldConcepts折叠→一对多补全→资金匹配fundMissing/dataMissing，降级链LLM→datacenter RPT_F10概念→成分股50只反查→hybk兜底，完整但fetchStocksBoards全量120+并发易限流
- mainlineScore: 涨停占比25+高度20+晋级15+资金20+换手10+催化10，dataCompleteness防缺数据高置信
- regimeGate: 25:0.5/45:0.6/65:1.0/80:0.7/101:0.5重新设计极端不再空仓，熔断炸板>40/溢价负/晋级<10% *0.5最低0.2

### 竞价与风控
- auction.ts 抛弃东财f46/f60错映射改腾讯qt.gtimg.cn GBK，字段[5]今开[4]昨收[31]涨跌幅[38]成交额实测正确，强度分竞价涨幅*4+首封+开盘额，但未强制走proxy会乱码
- trapDetector: 假封板封单<5%+zbc>=2 诱多拉升主撤散进 尾盘抢筹，置信度70+blast*8有实战感，但sealFundDropPct分时源未接
- positionSizing: base*gate*strength折算仓位+梯队断档*0.6+剩余容量截断+5%门槛+分批止损，全市场唯一量化到按钮，但高潮止损8%>启动5%反向
- exitSignal/sealMonitor: checkExitSignal昨日数高度环比+炸板率判定退潮，detectSealDecay对比18s快照片封单衰减red60/yellow30，龙一开板前兆，但cron中sealDecayCount=null因子永远missing

### AI中枢
- aiPrompts SYSTEM_PREFIX约束只输出结论数字禁模糊词中性强度词防投顾
- ai.ts 统一中枢缓存TTL2h+单飞去重+滑动窗口token限流并发安全+服务端中转优先+失败释放，parseAIJSON剥围栏正则提取按requiredFields过滤坏元素鲁棒，但cache key含时间戳即永不命中
- agentTools/aiAgent/assistantAgent ReAct循环LLM自主选工具，真Agent，分桶后agentReason独占30/min，但LOCAL_TOKEN空不鉴权+白名单仅host有SSRF风险

### 后端server/
- index.js Express+PG+dotenv 0.0.0.0
- db.js DATABASE_URL必配防明文fallback，但news.code主键FNV哈希冲突
- routes/db.js kv bulk limit1000事务完整但__raw解包cron直接JSON.parse可能拿{b.w}
- routes/proxy.js GET/POST TTL5s防req_trace UA伪装SNI防双发，但cache size>200清前100非LRU
- routes/ai.js TASK_ALLOW白名单防滥调，分桶令牌桶429显式rateLimited，但temperature未校验
- cron.js 827行最大风险：15:40快照+*/20 9-16快讯公告政策黑天鹅+启动补全，zt_snapshot/market_daily/fund_streak/block_trade/lhb/policy/black_swan/market_intraday/llm_analysis/review/event_classify/factor_ic全落库，但isTradingDayCN硬编码2026、fundInflowStreak只看Top1、contentKey内存seq重启重复、httpsGet无重试、pool无timeout、push2delay f62是否稳定未验证
- httpProxy.js 默认127.0.0.1:7897直连40%+代理60%总延迟35s卡顿
- factorIc.js 与前端同构Spearman，nextMainlineWin从情绪>=今日改为涨停数>=今日80% v9.57更贴合

---

## 第二卷：数据接口全地图 22族

| # | 接口族 | 函数 | 域名 | 卡点 | AI可用 |
|---|---|---|---|---|---|
|1|指数概览|fetchIndexOverview|push2 ulist|UT硬编码过期风险|是|
|2|涨跌家数|fetchMarketBreadth f104-106|push2|北证secid 0.899050稳定否|是|
|3|全球商品|fetchGlobalIndices|push2|100.XX无报价返回0需missing|是|
|4|两市成交|fetchMarketTurnover f6|push2|未含北交|是|
|5|大盘资金|fetchMarketMainFund f62|push2|未含北交|是|
|6|板块资金|fetchBoardFundFlow|push2 clist|all=true双请求已修，t:3标签需taxonomy|是|
|7|板块排行|fetchBoardRankTopBottom|push2|consecutiveDays伪造|部分|
|8|成分股|fetchBoardConstituents|push2|小板块f62不返回|是|
|9|个股one|fetchStockOne|push2|f8/f10缺失标missing|是|
|10|资金历史|fetchMarketFundHistory f51-56|push2his|日期需北京对齐|是|
|11|快讯|fetchFastNews callback|np-weblist|需Referer已兼容|是|
|12|搜索新闻|fetchStockNews|search-api-web|keyword过长截断|是|
|13|个股公告|fetchStockAnnouncements|np-anotice-stock|2026数组结构已适配|是|
|14|全市场公告|fetchMarketAnnouncements|np-anotice|100失败降50|是|
|15|龙虎榜列表|fetchDragonTigerList|datacenter-web|同code同date去重Map|是|
|16|席位|fetchDragonTigerSeats|datacenter-web|filter encode正确|是|
|17|涨停三池|fetchLimitPoolSummary ZT/ZB/DT|push2ex|sort=fbt:asc修空ZB，qdate真实提取|是|
|18|成交额历史|fetchTurnoverHistory|push2his|ymdPlus非北京|是|
|19|解禁|fetchLiftBan|datacenter-web|pageSize5过少|部分|
|20|人气双榜|fetchPopularityRank emappdata / THS dq.10jqka|emappdata+10jqka|TLS指纹ban已用hostname/path修|是|
|21|批量行情|fetchStockBriefBatch|push2|100分批支持>100正确|是|
|22|竞价真实|fetchQtBatch qt.gtimg.cn|qt.gtimg.cn|GBK解码需强制proxy当前未强制|是|

结论：18全通4半通。所有走trackedJsonp+queuedJsonp+apiHealth但缺熔断Dashboard，hasMissingKeyFields标missing无告警到AIConsole。

---

## 第三卷：文案合规逐屏审计

- BattlePlan 🚀仓位30%首仓15%止损7% 可上车/观望/禁止 直接给仓位操作建议接近投顾，需改参考档位+风险等级，加DisclaimerTag
- StockDecisionCard/StockPickList 可买/谨慎/回避同风险
- AIConsole 示例问句 今天最强主线能不能上车 引导交易，应改 最强主线的资金强度与风险点是什么 中性化
- TopNav footer 资金结构>涨跌幅·风险信号>机会信号 正确体现资金优先
- FundStructure vetoTriggered 一票否决用词过重已在v9.32修为重度背离历史统计风险偏高
- DailySummary stockJudge prompt 你是游资身份可保留输出需加免责
- 整改：全局ACTION_MAP {可上车:参考关注,禁止:风险提示建议规避,可买:参考偏多} 统一format.ts，加ComplianceGuard.ts封装

---

## 第四卷：AI自治闭环五阶 决策-搜索-验证-跟踪-推荐

### 架构现状
用户提问(任意Tab) → AIConsole/ Dashboard/ StockPickList/ StockWatchlist → assistantAgent / aiAgent / decideForStock → callAgentChat → /api/ai/call 分桶30/20/10 → LLM原生tool_calls/手动JSON → agentTools 16工具(10vote+6data) → collectEvidence → decisionBus.runConsensus(硬否决/回测门控/因子健康扣分/加权投票/分歧告警) → Critic+selfConsistency三温多数 → AgentVerdict{action,confidence,reason,evidence,rawEvidence,path,rounds,toolsCalled} → 写入aiConclusionStore/decisionCollector/signalLedger/recTracker/factorHistory → UI BattlePlan仓位卡+DecisionVerdictCard终裁+StockDecisionCard

### 五阶卡点

**决策**
- 优势：decideForMainline 5轮ReAct自主选工具硬否决早停sysRisk red/trap/sealDecay red先风控后进攻
- 卡点D1：ToolContext大量写死marketFactor0.5 todayNewPositions0 totalCapital1e6 concentrationPct undefined导致computePositionAdvice/computePortfolioRisk用假数据算真仓位地基沙子
- 卡点D2：factorHealth预注入读PG快照Pages纯前端永远null不知因子失效
- 卡点D3：final.reason强制带数字但工具全missing数字0 LLM会编造需数字来源校验

**搜索**
- 优势：assistantAgent全站问答含getStockFundDetail动态查个股
- 卡点S1：search-api-web全文搜索未工具化AI只能看已入库标题搜索深度不足
- 卡点S2：boardMap.matchBoardsByText O(N)遍历vocab无缓存卡主线程延迟高
- 卡点S3：fetchAnalysisDataFromCloud仅本地可用线上localStorage 6000条截断视野<30天

**验证**
- 优势：Critic换视角推翻+selfConsistency三温多数+decisionBus硬否决+回测胜率<45%降权0.3+因子失效占比>=50%扣15分三重验证
- 卡点V1：signalGates来源backtestSignals(14)仅本地有数据Pages下[]门控失效无法验证历史胜率
- 卡点V2：gateWeight样本<6降权0.3但computeFactorIC样本<3 IC=0仍计票虚假中性
- 卡点V3：normalize部分vote工具confidence直接Math.min95无衰减无法识别工具置信虚高

**跟踪**
- 优势：signalLedger T+1/T+5自动回填 recTracker推荐归因 factorHistory IC序列 ztSnapshot跨日快照 sentimentStore日内情绪轨迹全
- 卡点T1：跟踪写localStorage exportAllData全量导出无加密XSS窃取即明文持仓自选暴露
- 卡点T2：cron market_daily sealDecayCount=null因子跟踪永远缺一块AI跟踪断环
- 卡点T3：signalLedger只跟踪个股市场未跟踪主线级某主线今日推荐明日是否延续主线推荐无法自证

**推荐**
- 优势：BattlePlan→StockPickList→PositionAdvice tranche+stopLoss主线到个股到仓位分批粒度细
- 卡点R1：无风险收益比打分只给仓位%不给预期收益回撤比无法排序性价比最高
- 卡点R2：StockPickList每只ReAct3轮10只=30轮瞬间打爆30/min桶rateLimited降级规则版用户看到AI研判实为规则
- 卡点R3：AIConsole回复限600字需带2个数字合规但信息密度低无法给3步执行清单

**总评**：已具备弱自治（自主选工具、硬否决拦截、写回结论、跨Tab），未达强自治（地基假值、搜索浅、回测Pages失效、跟踪有空洞、推荐无性价比）。离准确答案最终推荐差3拼图：真实数据注入层、搜索工具化、跟踪闭环补齐

---

## 第五卷：全模块卡点矩阵 32核心

|模块|职责|卡点|等级|阻塞AI闭环|
|---|---|---|---|---|
|api.ts|数据总线|北交未聚合 consecutiveDays伪造 nuclear f2 bug|致命|是|
|boardMap.ts|词表|match O(N)无缓存 ensure失败静默|中|是|
|apiHealth.ts|遥测|record只push无LRU泄漏|中|否|
|jsonpQueue.ts|限流|去重键去_timestamp误去重|中|是|
|thresholds.ts|阈值|命名反直觉 stockScore未引用|轻|否|
|themeLadder.ts|梯队|一对多ztCount虚高未去重|中|是|
|themeScore.ts|评分|别名表主观 newsWeight未回测|中|否|
|stockToMainline.ts|归类|全量120+并发限流|严重|是|
|mainline.ts|风格|riskAppetite仅sentiment+ztCount缺北向两融|中|是|
|mainlineScore.ts|强度|催化剂默认50中性乐观|中|是|
|mainlineLLM.ts|精排|白名单block+code但未校验amount|中|否|
|regimeGate.ts|闸门|positionLimit线性缺动量|中|是|
|auction.ts|竞价|未强制proxy GBK乱码|严重|是|
|trapDetector.ts|诱多|sealFundDropPct分时未接|中|是|
|positionSizing.ts|仓位|高潮止损8%>启动5%反向 ladderBroken0.6一刀切|严重|是|
|stockScore.ts|个股评分|人气Top10反向seat=20过粗暴|中|否|
|margin.ts|两融|T+1未联动|轻|否|
|etfScore.ts|ETF|f164 5日可能无|中|是|
|ai.ts|中枢|cache key含时间戳永不命中 MAX300未调|中|是|
|agentTools.ts|工具|大量假数据1e6|致命|是|
|aiAgent.ts|ReAct|假值 factorHealth Pages失效|致命|是|
|assistantAgent.ts|助手|无全文搜索|严重|是|
|cloudStore.ts|云同步|isLocalServer仅看github.io误判|中|是|
|dataStore.ts|库存|HARD10000截断150无压缩|中|否|
|decisionBus.ts|共识|样本<30仍扣分已修但前端可能误扣|中|是|
|factorLib.ts|因子|seal_decay永远missing|严重|是|
|signalLedger.ts|账本|只跟踪个股市场未跟踪主线|中|是|
|App.tsx|根|上帝1316行闭包镜像不全|严重|是|
|Dashboard.tsx|驾驶舱|loadFactorRows时区偏移|中|是|
|BattlePlan.tsx|作战卡|strengthScore<60折叠useEffect依赖写错|中|否|
|StockPickList.tsx|清单|每只3轮*10=30打爆桶|严重|是|
|server/cron.js|定时|2026硬编码 sealDecay null contentKey内存seq|致命|是|
|proxy.js|代理|cache非LRU|中|是|
|ai.js|中转|温度未校验|中|是|
|httpProxy.js|代理层|直连40%+代理60%延迟35s|中|是|

---

## 第六卷：指令级整改 P0/P1/P2

### P0 48h止血 让AI地基混凝土

**P0-1 核按钮与北交所**
```ts
// src/lib/api.ts:856
return items.filter(it => Number(it?.f3 ?? 999) <= -9).length;
// src/lib/api.ts:172
const url = `${PUSH2}/ulist.np/get?ut=${EM_UT}&...&secids=1.000001,0.399001,0.899050`;
```

**P0-2 北京时区统一**
新建 src/lib/time.ts 封装 getBJDate/ymdPlusBJ/bjDateStr唯一源，全局grep替换 new Date()日期计算

**P0-3 Agent假数据地基替换**
```ts
// Dashboard.tsx decisionSources
import { loadDisciplineState } from "../lib/discipline";
const dstate = loadDisciplineState();
const totalValue = dstate.positions.reduce((s,p)=>s+p.value,0);
const pr = computePortfolioRisk({totalCapital: dstate.settings.totalCapital, currentPositionValue: totalValue});
collectEvidence({riskOverLimit: pr.overLimit, riskLossStreak: pr.lossStreak, todayNewPositions: dstate.todayNewPositions});
// agentTools.ts 所有totalCapital:1e6改为loadDisciplineState().settings.totalCapital
```

**P0-4 代理强制与并发**
```ts
// auction.ts fetchQtBatch
const url = `/api/proxy?url=${encodeURIComponent(QT_BASE + chunk.join(","))}`;
// stockToMainline fetchStocksBoards加p-limit2
```

**P0-5 Cron节假日与重复**
- isTradingDayCN改为读tradeCalendar同步或npm chinese-trading-calendar
- contentKey改为crypto.createHash('sha256').update(seed).digest('hex').slice(0,16)去seq

### P1 14天 强自治贯通搜索验证跟踪

**P1-1 搜索工具化**
```ts
{
  name: "searchNewsFull",
  description: "新闻全文搜索按关键词拉标题摘要时间",
  kind: "data",
  execute: async (args:{keyword:string}) => {
    const { fetchStockNews } = await import("./api");
    return await fetchStockNews(args.keyword,20);
  }
}
```
加入assistantAgent prompt强调问政策公告先调newsFull

**P1-2 回测门控Pages降级**
- signalBacktest增加backtestSignalsLocal()用signalLedger.getLedger()本地算胜率
- Dashboard loadFactorRows kvGet失败降级读localStorage sentiment存档

**P1-3 跟踪补齐**
- cron fetchMarketDaily sealDecayCount读内存global._lastSealAlerts red length，App refreshFast后POST /api/db/kv同步seal_decay:date
- signalLedger新增type:"mainline"，recordRecommendation时appendSignal({type:"mainline",code:mainline})

**P1-4 推荐限流与性价比**
```ts
const LIMIT=2;
for(let i=0;i<stocks.length;i+=LIMIT){
  await Promise.all(stocks.slice(i,i+LIMIT).map(s=>decideForStock(...)));
  await sleep(1200);
}
```
新增computeRiskReward综合strengthScore/封单比/炸板率算收益回撤比排序

**P1-5 boardMap缓存加速**
matchBoardsByText加Trie或Map索引O(1)，ensureBoardMap失败标boardMapFailed=true AI搜索前提示词表未就绪

### P2 30天 市场化可观测

- 新增OpsPanel展示apiHealth成功率延迟 ai.ts命中率降级率429率 queuedJsonp队列长度 factorHealth失效占比
- 封装dataSource.ts fetchWithFallback(primary push2 secondary gtimg tertiary sina)双源熔断
- 新建compliance.ts统一formatVerdict中性词 DisclaimerTag常驻所有建议卡
- Dockerfile+docker-compose PG16+Node server随机生成LOCAL_TOKEN打印

---

## 第七卷：最终结论 AI能否准确最终推荐？

当前：能给出带数字参考答案，不能给出资金级别准确最终推荐。能回答最强主线是谁资金多少亿龙一封单比风险点在哪。不能因地基假值搜索浅跟踪缺推荐无性价比置信度虚高10-20分

按P0+P1后：Pages线上75分自治，本地部署90分自治（全量PG快照+真实组合风险+主线跟踪+搜索工具化）

游资最后：先让AI在本地部署版跑100次决策-跟踪-回测闭环IC>0.15再上Pages，不要在Pages用假数据训真信心

---

*第一卷 2026-08-06 基础全栈 第二卷同日深度穿透 两卷不矛盾 指令级可执行*
