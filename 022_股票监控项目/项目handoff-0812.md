# 项目 Handoff — 2026-08-12（会话超长交接，交由新会话继续推进）

> **交接人**：实施会话（sess_bf7325ee，2026-08-12 深夜）
> **当前 HEAD**：`0e3e5da`（v9.113.0，已推送远端 `arena/019fb619-stock-monitor`）
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

## 二、当前状态（v9.113.0）

**已上线**：部署 v9.113.0（SW CACHE v28）；vitest 448；build 1,652.01kB；验收 19 PASS。

**已实测通过**：
- 决策卡：驾驶舱"🎯 决策直达"输入 600519 → 观望/仓位0%/止损5%/PG 证据链（秒级，不经过 LLM）
- 横幅三态：PG 可用时"15分钟延迟"不弹
- data 档："今天涨停多少只"→ PG 秒回数字
- 复杂 ReAct ×10 降级率 0%（v9.111.0 基线）

## 三、剩余待办（按《修改优化指令-v9.113.0.md》+《终审报告-v9.113.0.md》）

### v9.113.1：T1-1 主面板管道 PG-first（终审 D-01 收尾）
- **文件**：`src/App.tsx` refreshMain（约 289-450 行 allSettled 管道）
- **改法**：结构化字段（涨跌家数/成交额/情绪/主力资金/涨停梯队）优先 `fetchMarketSnapshot()`（dataLayer），实时指数/现价走 `fetchLiveQuote()`；仅 PG 空才回退 push2delay；各面板角标 asOf+来源
- **涉及面板**：MarketOverview（数据来自 App 管道，:3 realLinks 是跳转链接非取数）、FundStructure、KeyIndicators、DarkPool
- **验收**：block push2 + PG 可用 → 主面板显示 PG 新鲜值 + asOf 角标，不走 push2delay
- **回归风险**：refreshMain 是核心管道，改前先读全（60s 主刷新 + 18s 快刷 + lastWatchFetchAt 节流）

### v9.114.0：T5/T6 可靠性收敛 + 面板精简
- **T5-1 boardTrap**：⚠ **用户 v9.106.2 定调：保持板块级宿主（LimitBoard 徽章），不接 anomalyTier**——终审 D-06 与定调冲突，只清"已接线"过时文案（grep 确认 = 0 已达成），不接线
- **T5-2 统一 /api/health**：聚合 /api/proxy/health（源）+ /api/ai/health（端点）+ PG 连通 + SW 版本
- **T5-3 SW 强制版本更新**：public/sw.js 增加 version 检查，消除"需硬刷新"约定
- **T6 面板收敛**：DarkPool+FundStructure→"资金面"Tab；MainlineRanking+ThemeLadder→"主线"Tab；GlobalSignals/CommodityChain 折叠到"盘前准备"

### v9.115.0：线上观测调优
- length cap 12000 配额监控（OpenCode Go 5h$12/周$30/月$60）
- 路由正则按实测微调；cron 频率按需调整

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
