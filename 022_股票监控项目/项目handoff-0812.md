# 项目 Handoff — 2026-08-12（会话超长交接，交由新会话继续推进）

> **交接人**：实施会话（sess_bf7325ee，2026-08-12 深夜）+ 推进会话（2026-08-12 晚，v9.113.1/v9.114.0）+ 金融 AGI 会话（2026-08-12 深夜~08-13，v9.115.0~v9.119.0 四支柱+补全）
> **当前 HEAD**：`3806428`（v9.119.0，已推送远端 `arena/019fb619-stock-monitor`）
> **接手必读**：本文件 + AGENTS.md + `C:\Users\Administrator\.zcode\cli\memories\projects\022_-a062c4aeb65b9d98\memory\MEMORY.md`（含全部历史教训索引）

---

## 〇、环境速查

| 项 | 值 |
|---|---|
| 源码目录 | `E:\CC-HAHA\workspace\022_股票监控项目\stock-monitor-v9.9\stock-monitor`（构建/部署/测试都在此） |
| 仓库根 | `E:\CC-HAHA\workspace`（源码经 robocopy 同步到根再 git 提交；**robocopy 只 /E 禁 /MIR**，MSYS_NO_PATHCONV=1） |
| 远端 | `github.com:benlau88832-collab/stock-monitor.git`，分支 `arena/019fb619-stock-monitor` |
| 服务 | pm2 名 stock-monitor（localhost:8080）；`npx pm2 restart stock-monitor` 部署 |
| 版本三处 | `src/lib/version.ts`（APP_VERSION/BUILD_DATE）+ `index.html` <title> + `public/sw.js`（CACHE 名每次 +1） |
| 验收脚本 | `node server/scripts/verify-acceptance.js`（**必须源码目录跑**，预期 19-20 PASS；1 环境项"跌停池 0 只"=今日真实跌停，非代码问题） |
| token 读取 | kv_store `local_token` 值是 **`{token:"..."}` 对象**（非 __raw！）；解析：`v && typeof v==='object' && '__raw' in v ? v.__raw : (typeof v==='string' ? v : v?.token)` |
| AI 配置 | .env：AI_BASE_URL=https://opencode.ai/zen/go/v1/chat/completions，AI_MODEL=deepseek-v4-flash，AI_PROVIDER=openai；**恒产 reasoning_content 且 enable_thinking 关不掉**（OpenCode 中转忽略该参数） |

## 一、版本线（2026-08-12 全部交付，按序）

| 版本 | commit | 内容 | 关键验收 |
|---|---|---|---|
| v9.106.1 | 3c619f8 | 验收遗留 2 项（StatusBar 环比漏修路径/boardTrap 死代码接线） | 浏览器无 -100% |
| v9.106.2 | abb2958 | **用户定调：boardTrap 宿主=同概念批量涨停（板块级），自选股级接线回滚**；精灵浮层断源根因 `data.data.pool` 双层修复 | 盘中实测：板块标签+精灵事件 |
| v9.107.0 | 214d339 | 全站助手架构：快照全量注入（主线Top3含龙头+时间戳）/删 5 处正则直出/fallbackAnswer 规则兜底/max_tokens 4000 | 问什么都有回答 |
| v9.107.1 | 3f71317 | empty 配置层根治：callAgentChat 4000 + TASK_CONFIG 双端 28 处提档 | golden 一致性过 |
| v9.108.0-3 | 9ce1f90/f7b35dd/af89707/a683b36 | GLM 审查批次：流式兜底/个股路由/预算作用域/精灵粒度文案/假摔收紧/多源 asOf/预取/测试套件/aiHealth | vitest 413→425 |
| v9.109.0-4 | 3a92015→3b033a3 | LLM 根治（llmCore 统一重试+failover+恒发 enable_thinking）+ A-1 龙头跟风区分 + aiHealth/健康指示 + Q-2 腾讯实时报价 + Q-1 PG 优先 | **连问 10 次降级率 0%** |
| v9.110.0 | (MOD-3 diag 并入 v9.111.0 前) | diag 实测：**hasContent:true ×2 + hasReasoning:true** → MOD-1/MOD-4 跳过；MOD-2 reasoning 兜底；agnes 默认值清理 | diag 裁决 |
| v9.111.0 | e177a82 | **R-1 length 截断重试**（curMaxTokens 上调 12000 前为 8000）+ R-2 agentReason→8000 + R-3 预算纳 reasoningLen + S-1 | **复杂 ReAct ×10 降级率 0%** |
| v9.111.1 | d1c8407 | S-3 流式转发 reasoning + S-4 AIConsole 🤔 思考区/🧠 开关 | curl 双事件 |
| v9.113.0 | 0e3e5da | **终审交付层重构**：T0 dataLayer（PG 优先）/ T2 intentRouter 五档路由 + data 档直读 PG / T3 LLM 收尾（工具子集瘦身/length cap 12000/降级分真因/reactProbe）/ T4 decisionDirect+DecisionCard 决策直达 / T1-2 横幅三态 | 浏览器实测：决策卡秒级 + 横幅不弹 |
| v9.113.1 | c6b1e2d | **T1-1 主面板管道 PG-first（D-01 收尾）**：refreshAll 第 9 路拉 PG 快照；涨停池三优先（实时 push2 直连 > PG 派生池 > push2delay 兜底，recentDelayHit 判定）；情绪/溢价/晋级率 PG 兜底；brainContext 加 boardCounts；MarketOverview PG 角标；stale 语义盘后修正 | block push2 实测：涨停 92/炸板 12%/连板梯队全显示 + 角标"涨停/情绪·PG 21:48"，不走 push2delay |
| v9.114.0 | dbf8454 | **T5/T6 可靠性收敛+面板精简**：T5-1 boardTrap 文案核对（grep=0 不接线，板块级宿主维持）；T5-2 统一 /api/health（数据源+AI 端点+PG+SW+版本聚合，OpsPanel 统一 SLA）；T5-3 SW 强制版本更新（FORCE_RELOAD 无硬刷新即生效）；T6 主线/资金面/盘前准备三分区 | curl /api/health 全字段返回；SW v30 自动 reload 实测（sw_reloading=1+navType=reload） |
| v9.115.0 | 137f884→7be7625 | **金融 AGI 四支柱① 单一认知层**：S1-1 buildCognition 纯函数（情绪6阶段/资金/风险闸门/龙头，每字段 Provenance 溯源+hash 双端校验）/ S1-2 cognition_snapshots 落库+cron 接入+version 自增 / S1-3 助手注入认知（快照长度降 ≥15%，AI 回答与认知一致）/ S1-4 CognitionBanner 认知横幅（驾驶舱顶部，5 维+hash/asOf）+ 情绪数据源优先级修正（sentiment_snapshot 权威） | /api/cognition 真实 PG 数据；AI 问"情绪如何"引用认知 16 冰点/696.5亿/百花医药7板，与横幅一致 |
| v9.116.0 | f36299e | **四支柱② 决策直达层**：composeDecision 五支柱（准入/仓位/离场/风控/诱多，纯函数 <1ms 永不降级）+ DecisionCard 一键裁决面板（候选龙头自动亮 + 9:25/13:00 决策窗口 P0）+ /api/decisions（服务端 CJS 双端同构） | curl POST 600519→观望/61分/6ms；浏览器点候选龙头→五支柱卡+诱多一票否决 |
| v9.117.0 | 99355c4 | **四支柱③ 主动智能调度**：resolveSession 时段引擎（8 阶段+2 决策窗口）+ 规则谓词四件套 + runProactiveTick（规则前置 0 token，LLM 受时段预算 400/1800/2500）+ /api/proactive + cron 落库 + ProactiveFeed（盘前准备区，时段切换+预算条） | curl ?phase=09:25→decisionWindow:true+P0；浏览器预算条 2000/2500·剩余500 |
| v9.118.0 | b8ecd30 | **四支柱④ 操作习惯场景融合**：四场景纯函数（stageToAction 情绪周期买卖点/assessAuctionVolatility 竞价/composeIntradayAction 异动处置/buildCloseList 尾盘减仓，0 token）+ ScenarioPanel 4 tab（读认知动态，结论触达决策直达） | 浏览器：冰点→低吸·仓位15%（与认知横幅/AI 三方一致）；竞价匹配度 100→打板 |
| v9.119.0 | 3806428 | **补全收尾**：主动流 LLM 润色实际接线（refineInsightsWithLLM 受时段预算，失败回退规则原文永不降级；预算语义修正——llmUsedTokens 只计实际消耗）+ cron 时段调度六入口（盘前/竞价/早盘/午后/尾盘/盘后 → kv proactive:latest）+ policy-brief 补真实政策快讯 + /api/proactive 优先读润色版 + /api/health checks 数组（对齐 ③ 全局验收命令） | 真实 LLM 润色实测（政策简报 600 tok，事实全保留语言自然化）；curl /api/health checks 五源全 ok |

## 二、当前状态（v9.119.0）

**已上线**：部署 v9.119.0（SW CACHE v35）；vitest 498；build 1,679.72kB；验收 19 PASS。

**金融 AGI 四支柱全部落地 + 补全收尾**（GLM审查/解决智能化/ ①②③④ 四文档，③ 执行状态已回填）：
- ① 单一认知层：/api/cognition（cron 落库 cognition_snapshots + version/hash）+ 认知横幅 + AI 注入认知（快照降 ≥15%）
- ② 决策直达：五支柱一键裁决（<1ms 纯函数 + 9:25/13:00 决策窗口 + 候选龙头自动亮）
- ③ 主动智能：时段引擎 + 规则前置 + **LLM 润色已实际接线**（refineInsightsWithLLM 受预算，cron 时段调度六入口，policy-brief 补真实政策快讯）+ ProactiveFeed
- ④ 场景融合：情绪周期买卖点/竞价/异动处置/尾盘减仓（0 token）
- **验收对齐**：/api/health checks 数组（③ 全局验收命令 curl /api/health | jq '.checks' 直接可用）
- **全站口径统一实测**：认知横幅（冰点16）→ AI 回答 → 决策五支柱 → 场景融合 四方一致

**已实测通过（历史）**：
- 主面板 PG-first：block push2 → PG 快照值 + 角标，不走 push2delay（v9.113.1）
- 统一 /api/health + SW 强制版本更新（v9.114.0）
- 决策卡 600519 秒级裁决；data 档 PG 秒回；复杂 ReAct ×10 降级率 0%

## 三、剩余待办

> 2026-08-13 更新：v9.113.1/v9.114.0（T0-T6）与 v9.115.0~v9.119.0（金融 AGI 四支柱+补全收尾）已全部交付（c6b1e2d→3806428），③ 执行状态总表已回填，验收命令全部对齐。

### 后续优化（非阻塞，🟡 后置项）
- 认知历史回放（cognition_snapshots 按 version 时序）
- 竞价委托簿撮合模拟（数据源受限，先用量价代理——S4 已含）
- 多模型并行投票裁决（配额有限）
- 线上观测调优（length cap 12000 配额监控；路由正则按实测微调；cron 频率按需调整）
- 观察项：盘中链（runIntradayBrain）PG 连接超时历史失败——今日盘中时段起观察 cron 日志确认恢复（sentiment_snapshot 恢复后情绪源自动用权威采样）

## 四、关键约定（改代码前必读）

1. **提交信息极长带完整变更清单**；注释带版本标记 `// vX.Y.Z（问题ID）：说明`
2. **标准验证链**：tsc → vitest → build → verify-acceptance（源码目录）→ pm2 restart → 浏览器硬刷新（SW 缓存坑：验证前清 cache 或 ?ignoreCache=N）→ 提交推送
3. **每项三选一证据**（单测/curl/浏览器），不交半成品（用户明确要求"修复时注意做验证"）
4. **版本三处同步**（version.ts/index.html/sw.js CACHE 名）
5. **robocopy 同步**：`MSYS_NO_PATHCONV=1 robocopy 源码 仓库根 /E /XD node_modules server/node_modules .git .playwright-mcp`；**禁 /MIR**（历史误删事故）
6. **删除红线**：删文件/非空目录/破坏性命令前先问用户
7. **日期格式**：DB 日期带横杠（2026-08-12）；查询参数必须带横杠
8. **LLM 铁律**：推理模型 max_tokens≥2000 否则 content 空；恒思考模型（deepseek-v4-flash）下 enable_thinking 无效 → 用 R-1 length 重试 + R-2 提档给空间，**不要试图"关思考"（用户定调：会变笨）**
9. **前端 TS 模块 server 无法 require**（CJS/ESM 边界）；shared 文件保持纯 ESM
10. **测试教训**：vitest 禁 `require("vitest")`；vi.mock 对 CJS require 拦截不稳定 → 用依赖注入（`_post`/`_aiHealth`）；python patch 行尾注释吞 `}`/逗号 → 改后 `node --check` 服务端全部 js

## 五、历史教训速查（memory 全文见 MEMORY.md）

- **push2ex 双层 data.data.pool**（v9.102.0 遗留：j.data.pool 恒空→精灵浮层永无事件）——验收必须实测触发路径
- **SW ETag 304 回退 HTTP 缓存旧 build**——硬刷新才生效
- **html2canvas 不支持 oklab**→html-to-image
- **快照多行段落提取用 grabSection**（单行 grab 丢政策内容）
- **ref 不触发横幅重算→用 state**（v9.113.0 T1-2 教训）
- **上游 empty 时段浏览器看不到思考区是正确行为**（无 reasoning 事件），验收用 curl 协议层证据
- **aiHealth 熔断跨测试污染**（ESM import 与 CJS require 实例不共享）→ 依赖注入 STUB_HEALTH
- **token 解析**：kv local_token 是 {token:...} 对象非 __raw

## 六、常用命令

```bash
# 部署 + 验证链（源码目录）
cd "E:\CC-HAHA\workspace\022_股票监控项目\stock-monitor-v9.9\stock-monitor"
npx tsc --noEmit && npx vitest run && npm run build
node server/scripts/verify-acceptance.js
npx pm2 restart stock-monitor

# 读 token（curl 用）
cd server && node -e "require('./db').pool.query(\"SELECT value FROM kv_store WHERE key='local_token'\").then(r=>{const v=r.rows[0]?.value;console.log(v&&typeof v==='object'&&'__raw' in v?v.__raw:(typeof v==='string'?v:v?.token))})"

# diag（AI 端点诊断）
curl -s http://localhost:8080/api/ai/diag -H "x-local-token: $TOKEN"

# 同步 + 提交（仓库根 E:\CC-HAHA\workspace）
MSYS_NO_PATHCONV=1 robocopy "源码" "E:\CC-HAHA\workspace" /E /XD node_modules server/node_modules .git .playwright-mcp /NFL /NDL /NJH /NJS
git add <文件> && git commit -m "极长清单" && git push origin arena/019fb619-stock-monitor
```

## 七、GLM 审查文档（新会话可读）

目录 `E:\CC-HAHA\workspace\022_股票监控项目\GLM审查\`：
- 终审报告-v9.113.0.md（战略终审：交付层脆弱 vs 内核优秀）
- 修改优化指令-v9.113.0.md（可执行任务书：T0-T6 分版本）
- 审查意见书.txt / 审核结论与修正说明.md（v9.108 批次）
- 深化后的实施指令.txt（v9.108 任务书，已回填状态）
- 彻底修复方案.txt（v9.109 根因分析）
- v9.110.0 LLM 部分修订版 / 《v9.111.0 最终指令》（思考模型可靠性）
- 复验报告.txt（v9.108 复验结论）

项目根另有：`验收结论-2026-08-12.md`、`实施交接指令-2026-08-11.md`、`修复交接指令-2026-08-11.md`、`产品级升级报告与实施指令-2026-08-11.md`、`审查报告-2026-08-11.md`。

## 八、下一步建议

1. **T1-1（v9.113.1）**：App refreshMain 管道 PG-first——读 `src/App.tsx:289-450` 全段后改，注意 60s/18s 双刷新与 lastWatchFetchAt 节流
2. 完成 v9.113.1 后按 v9.114.0（T5/T6）推进
3. 全程遵守第四、五节约定；每批提交带实测输出（审查官"自验命令+实际输出"要求）
