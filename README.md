# A股实时交易辅助终端（stock-monitor）

基于 A 股深度复盘体系的**个人实盘交易辅助监控终端**，已从"市场监控面板"演进为**全栈投研系统**：前端（React+Vite+TS）+ 后端（Express+PostgreSQL+node-cron）+ **AI 决策大脑（DeepSeek V4 Flash，ReAct Agent）** + **产业链主动投研引擎（每晚自动挖掘外网情报 → LLM 研判 → 盘前简报）**。

> ⚠️ **robocopy 铁律**：本仓库禁止任何 `robocopy /MIR`、`/PURGE`、`rm -rf` 类镜像/递归删除命令（曾两次误删工作区目录）。git 是唯一同步通道，删除动作先人工确认。详见 `AGENTS.md` 与 `ROBOCOPY-GUARD.txt`。

## 🚀 快速开始

```bash
# 克隆仓库（默认分支 main 已同步最新）
git clone https://github.com/benlau88832-collab/stock-monitor.git
cd stock-monitor

# 后端（需 PostgreSQL + server/.env 配置 DATABASE_URL / AI_API_KEY）
cd server && npm install && cd ..
# 前端开发
npm install
npm run dev        # 前端开发服务器
node server/index.js  # 后端（生产：npx pm2 start server/index.js --name stock-monitor）
```

浏览器打开 `http://localhost:8080`（生产）或 `http://localhost:5173`（dev）。

## 📊 核心功能（v9.148.1）

### 🧭 五主 Tab（驾驶舱 / 个股雷达 / 资金主线 / 龙虎榜复盘 / 消息面）
| 模块 | 功能 |
|------|------|
| **🔗 产业链简报**（驾驶舱顶部，第一眼入口） | 每晚 21:00 自动挖掘 6 条链（半导体/AI算力/AI电力设备/有色金属/小金属/机器人）——站内信号 + **外网公开信息交叉验证**（Google News 英文原发，≥2 独立来源且 ≥1 权威 → "多源验证"）→ LLM 研判（阶段/受益标的/逻辑变化/风险）；手机扫码 `/#briefing` 直达；早盘 8:35 微信推送摘要 |
| **⚡ 盘中异动补挖** | 链内标的批量涨停/大涨（≥3 只）、商品价格 ±3%、链内重大公告 → 立即补挖并推送（30 分钟节流） |
| **波段作战系统** | 波段方向榜、持仓逻辑台账、波段决策卡、多周期共振（日/周/月） |
| **AI 认知层 + 决策直达** | 单一 AI 认知对象（情绪/主线/资金/风险闸门/龙头）+ 决策卡（准入/仓位/离场/风控，规则兜底永不降级） |
| **个股雷达** | 自选股 AI 研判、个股聚合深度页（K线/技术指标/舆情/研报/基本面体检/同行对比）、盯价监控 |
| **资金主线** | 主线强度榜、题材梯队、行业资金流、明暗盘信号 |
| **龙虎榜复盘** | 游资席位画像（格局/波段/砸盘/接力派）、连续动作追踪、T+1 回填 |
| **消息面** | 快讯流（噪音过滤默认开）、公告淘金、热点主题作战、产业链追溯 |
| **决策闭环** | 拍板留痕 → T+5/T+20/T+60 真实盈亏回填 → 周度风格画像 → 纪律熔断 |

### 🤖 产业链主动投研引擎（v9.148 核心新增）
- **每晚 21:00**：6 链 × 18 个关键变量（中英搜索词交叉召回）+ 8 位关键人物（马斯克/黄仁勋/…，支持 AI 自扩散建议）→ 验证规则（多源验证/单源权威/待验证三档）→ LLM 简报落库
- **命中率闭环**：简报阶段判断 vs T+5 链内标的真实涨跌对照 → 下期简报引用（AI 越用越准）
- **微信推送**：Server酱扫码绑定（设置页配置 SendKey）→ 每日 8:35 简报摘要 + 盘中异动

## ✅ 验证命令（必须在仓库根跑）

```bash
npx vitest run server/lib/__tests__/   # 服务端单测（247+，在 server 目录跑会漏 14 个文件）
npx vitest run src/lib/__tests__/      # 前端单测（1164+）
npx tsc --noEmit                       # 类型检查
npm run build                          # 构建（产物 docs/index.html，提交前必须重建）
npx pm2 restart stock-monitor          # 重启服务
curl http://127.0.0.1:8080/api/health  # 健康检查（含数据源/AI/PG/版本）
```

**提交前验证链**：单测 → tsc → build → pm2 重启 → curl 实测 → 版本三件套（`src/lib/version.ts` + docs title + CHANGELOG）同步。

## 🧩 分支说明

| 分支 | 状态 | 描述 |
|------|------|------|
| `main` | ✅ 默认分支 | 已快进同步至最新（v9.148.1） |
| `arena/019fb619-stock-monitor` | 🔄 开发分支 | 与 main 同树（历史保留） |

## 📁 项目结构

```
├── src/                # 前端（React 19 + Vite + TS + Tailwind）
│   ├── components/     # 五 Tab 组件 + ChainBriefingPanel（简报卡）
│   ├── lib/            # ai.ts / emotionStage / transmission-chain 等
│   └── shared/         # 前后端共享（概念分类 / 链知识库）
├── server/             # 后端（Express + PG + node-cron + MCP）
│   ├── lib/            # 核心引擎：webSearch / chainIntel / chainBriefing /
│   │                   #   chainStocks / chainVariables / chainAnomaly /
│   │                   #   chainPush / chainLearning / llmCore / cognition
│   ├── routes/         # chain.js（stocks/prices/briefings/qr）/ ai.js / push.js 等
│   └── cron.js         # 定时任务（21:00 挖掘简报 / 8:35 推送 / 盘中异动 / 16:05 命中回填）
├── docs/               # 构建产物（GitHub Pages 部署，build 生成）
└── CHANGELOG.md        # 版本历史
```

## ⚠️ 已知边界

- 概念分类为按需采集（约 414 只），6 链标的集合靠"概念+行业+种子名单"（336 只）兜底
- 价格历史与命中率自 2026-08-15 起积累，需 1-2 周数据后趋势/命中显示完整
- 服务默认监听 0.0.0.0（同局域网手机可访问 `http://<局域网IP>:8080`）；烧钱写操作需 `x-local-token`
- 本终端仅用于实盘交易辅助监控，所有数据来自公开接口实时抓取，不构成投资建议
