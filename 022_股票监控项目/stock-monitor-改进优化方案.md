# 《stock-monitor》改进优化方案 v1.0

> 生成时间：2026-08-03 20:00（GMT+8）
> 审查对象：`benlau88832-collab/stock-monitor`，分支 `arena/019fb619-stock-monitor`，线上 v9.24.2（GitHub Pages）
> 审查依据：
> - 《PRD_游资决策大脑升级方案.md》（v1.0，P0/P1/P2 路线图）
> - 《游资实战视角深度审查报告》（37/100 分锐评，第1~3层改进建议）
> - 当前仓库代码 + CHANGELOG + git 历史 + 线上页面实测
> **用途：交付给编码 AI 执行，每条建议含【定位】【现状】【修改为】【实现要点】【验收标准】，可直接分段粘贴执行。**

---

## 一、当前版本快照（必读前置）

### 1.1 版本与部署
| 项目 | 值 |
|---|---|
| 当前线上版本 | **v9.24.2**（游资决策大脑 P0+P1 已完成，build 08-03 19:30） |
| 线上地址 | https://benlau88832-collab.github.io/stock-monitor/ |
| 本地开发目录 | `E:\CC-HAHA\workspace\022_股票监控项目\stock-monitor-v9.9\stock-monitor` |
| Git 根目录 | `E:\CC-HAHA\workspace`（整个工作区是单一大仓库） |
| 线上部署源 | **根目录** `src/` `docs/` `index.html`（非 `022_股票监控项目/.../` 子目录！） |
| 技术栈 | Vite 7 + React 19 + TypeScript 5.9 + Tailwind 4 + recharts |
| 构建模式 | `vite-plugin-singlefile` 单文件产物（`docs/index.html` ~1.1MB） |

### 1.2 工作区未提交改动（21 文件，+2742/-613 行）
**v9.24 已提交部署，但 v9.24.3+ 存在以下未提交改进**，应合并入下次发布：
- `BattlePlan.tsx`：强度分 <60 主线卡默认折叠
- `App.tsx`：昨日涨停池按主线分组接入离场信号
- `DragonTiger.tsx` / `MarginPanel.tsx` / `StockWatchlist.tsx`：配套改动
- `seatLedger.ts` / `seatProfiles.ts`：席位台账增强
- `sentimentStore.ts` / `signalLedger.ts`：情绪/信号账本
- `regimeGate.ts` / `recTracker.ts` / `etfScore.ts`：闸门/推荐归因/ETF 评分
- `api.ts` / `ai.ts` / `aiPrompts.ts`：接口与 AI 调用增强
- 其余组件：MarketOverview / FundStructure / NewsPanel / Playbook / SignalPanel
- **tsc 全绿 ✅**

### 1.3 代码规模
| 指标 | 值 |
|---|---|
| src/ 文件总数 | 84（lib 42 + components 38 + 入口） |
| 最大 5 个文件 | App.tsx(1099) / api.ts(1084) / StockWatchlist.tsx(702) / DragonTiger.tsx(781) / AnnouncementPanel.tsx(627) |
| 新增组件（PRD P0/P1 实现） | FiveQBar / MainlineDiagnosisCard / MainlineRanking / StockDecisionCard / AnomalyTier(anomalyTier.ts) / EmotionCycleCard / AuctionBoard / DisciplinePanel / ReviewPanel / DisclaimerTag / FreshnessTag |
| tsc 错误 | **0 个** |

---

## 二、PRD 指令项实现状态（逐项核实）

### 2.1 已完整实现（可打 ✓）

| PRD 项 | 组件/文件 | 实现状态 | 备注 |
|---|---|---|---|
| **P0-A1 五问条** | `FiveQBar.tsx` | ✓ 完成 | 5卡片横排，60s 刷新，四色操作徽章 |
| **P0-A2 主线卡强制排序** | `BattlePlan.tsx` + `mainlineScore.ts` | ✓ 完成 | 强度分徽章红/橙/灰，<60 折叠（v9.23.1-fix 未提交） |
| **P0 离场信号** | `exitSignal.ts` + BattlePlan | ✓ 完成 | 4 规则：炸板率+15pp/涨停数-30%/高度下降/主力转流出 |
| **P0 AI 结构化** | `MainlineDiagnosisCard.tsx` + mainlineDiagnosis 任务槽 | ✓ 完成 | LLM 优先 + 规则降级 |
| **P1-B1 强度排行榜** | `MainlineRanking.tsx` | ✓ 完成 | 首屏表格，按强度分排序，≥80 红底 |
| **P1-C1 个股决策卡** | `StockDecisionCard.tsx` | ✓ 完成 | 纯规则引擎，结论/归属/技术/资金/风险/止损止盈/置信度 |
| **P1-E1 消息主线联动** | `NewsPanel.tsx` | ✓ 完成 | "⚡命中主线"标签 + 定价状态 |
| **P1 异动分级** | `anomalyTier.ts` + `AnomalyStrip` | ✓ 完成 | S/A/B 三级 + 事件流 + 15min 冷却 |
| **审查-T1-T4 合规** | `DisclaimerTag.tsx` + 文案改动 | ✓ 完成 | 中性化 |
| **审查-U1-U3 时效标签** | `FreshnessTag.tsx` | ✓ 完成 | 实时/准实时/T+1 |
| **审查-F1-F3 竞价台** | `AuctionBoard.tsx` + `auction.ts` | ✓ 完成 | 竞价涨幅 + 首封时间近似方案 |
| **审查-F4-F5 情绪雷达** | `EmotionCycleCard.tsx` + `emotionCycle.ts` | ✓ 完成 | 五档周期 + 证据链 + 退潮预警 |
| **审查-F6-F8 仓位纪律** | `DisciplinePanel.tsx` + `discipline.ts` | ✓ 完成 | 违规提醒 + 止损计算器 |
| **审查-F9-F11 复盘日志** | `ReviewPanel.tsx` + `dailyReview.ts` | ✓ 完成 | 表单 + 检索 + 连续亏损冷静期 |

### 2.2 部分实现（缺关键功能）

| PRD 项 | 现状 | 缺口 |
|---|---|---|
| **A3 周期进度条** | `EmotionCycleCard.tsx` 只有周期徽标 + 证据链 | ❌ 缺"5段横向进度条"可视化（冰点→启动→加速→分歧→退潮 色块高亮） |
| **A3 历史案例提示** | 无 | ❌ 缺"上次同阶段次日高度下降概率 XX%"等历史统计提示 |
| **A4 主线退潮预警条** | `checkExitSignal` 已调用，但在 `App.tsx` 注入到 `battlePlan.candidates` | ❌ 未单独生成红色通知条（AlertBanner 只有大盘级"重度背离"，缺主线级独立红条） |
| **A5 黄金窗口倒计时** | `anomalyTier.ts` 有 `firstSeen: number` 字段 | ⚠️ `AnomalyStrip` 用 30s 定时器刷新，但**未显示"距首次触发 X 分钟"**的倒计时标签 |
| **A5 S 级红闪+声音** | `animate-pulse` 已加，sCount 显示 | ⚠️ **声音播报未实现**（代码注释写"红色闪烁+声音"，但实际只闪烁） |
| **B2 资金流≠强度提示语** | `MainlineRanking` 底部有说明 | ⚠️ 缺**表格上方提示语**："资金流入金额大 ≠ 主线强度高，请以上方强度排行榜为准" |
| **B2 强度榜排名列** | 无 | ❌ "概念板块资金流排行"表**未新增"强度榜排名"列** |
| **B3 主线切换雷达** | 无 | ❌ 完全未实现 |
| **B4 明暗盘 AI 解读** | `DarkPool.tsx` 无 | ❌ 完全未实现 |
| **C2 自动触发决策卡** | `StockWatchlist.tsx` 无 | ❌ 自选股异动时**未自动重新生成决策卡 + 红点 + 置顶** |
| **C3 AI 信号标签** | 无 | ❌ 信息流每条**未加"利好/利空/中性 + 即时/次日/长期"标签** |
| **D2 资金一致性标签** | `seatBehavior.ts` 有"格局派对倒" | ⚠️ 仅针对单一席位；**未实现"多游资合力→抱团 / 买卖席位对倒→分歧"整体判断** |
| **D3 接力强度评分** | 无 | ❌ 完全未实现 |
| **E2 情报晨报/午报/收评** | `aiPrompts.ts` 有 `closeReview` 任务槽 | ⚠️ 仅收盘复盘；**缺晨报(9:30前)/午报(13:00)三时段自动生成** |
| **F1 悬浮 Agnes 追问球** | 无 | ❌ 完全未实现 |
| **F2 AI 三按钮(采纳/忽略/反馈)** | 无 `aiFeedbackLog` | ❌ 完全未实现 |
| **F3 复盘学习中心** | `ReviewPanel` 是手动录入 | ⚠️ 缺**收盘自动生成报告 + AI 反馈统计面板** |

### 2.3 未实现（审查报告第3层 + P2）

| 编号 | 模块 | 状态 |
|---|---|---|
| **D1-D4** | 云端持久化 + 定时快照抓取 | ❌ 全站 localStorage，无云端 |
| **F12-F13** | 外部推送（Server 酱/企微 Webhook） | ❌ |
| **P-1~P-4** | 代理层 + 备用数据源 + 接口健康页 | ❌ |
| **C1** | 导航按交易时间轴重构 | ❌ 现有 5 Tab 未改 |
| **C2** | 极简盯盘视图 | ❌ |
| **C3** | 移动响应式适配 | ❌ |
| **C4** | PWA（manifest + service worker） | ❌ |
| P2 | 分时图/K线可视化 | ❌ |
| P2 | 大宗交易折溢价监控 | ❌ |
| P2 | 股东户数/十大流通股东监控 | ❌ |
| P2 | 游资名录知识库（seatProfiles 仅 34 条硬编码） | ⚠️ 规模小 |

---

## 三、技术债现状

### 3.1 localStorage 键清单（全站数据主权缺失）
| 键 | 用途 | 跨日积累？ |
|---|---|---|
| `stock_watchlist` | 自选股列表 | ✓ 需云端 |
| `alert_muted_today` | 今日告警静音状态 | ✗ 每日重置 |
| `prev_sentiment` | 昨日情绪分（用于环比） | ✓ 需云端 |
| `ai:cache:*` | AI 调用缓存 | ✗ 可清除 |
| `ds_news` / `ds_ann` | 新闻/公告 30 天滚动 | ✓ 需云端 |
| `news_memo_*` / `intel_seg_*` | 情报记忆分段存储 | ✓ 需云端 |
| `ztpool:YYYYMMDD` | 涨停池快照 | ✓ 需云端 |
| `stock:activeTab` | 上次 Tab 记忆 | ✗ |
| `llm_api_key` | AI 密钥 | ✗ 敏感 |
| **缺失** | `aiFeedbackLog`（F2 未实现） | — |

### 3.2 接口风险（单一东财源）
- 全部 13 个端点均为 `eastmoney.com` 域名直连（push2 / push2ex / push2his / datacenter-web / np-anotice / np-weblist / emappdata / search-api）
- 无代理层、无备用源、无统一缓存
- 人气榜 POST 接口已有 CORS 限制（代码注释提及）
- `apiHealth.ts` 有遥测数据但**无 UI 可视化**

### 3.3 未清理资源
- 旧分支：`arena/019fa1a9-stock-monitor`、`arena/019fa6b7-stock-monitor`
- README 描述已过时（未提 v9.16+ 重构内容）

### 3.4 代码质量
- tsc 全绿 ✅
- 最大文件 App.tsx(1099行)、api.ts(1084行) —— 可考虑拆分
- 部分组件硬编码较多（如 `seatProfiles.ts` 34 条游资席位）

---

## 四、改进优化方案（按优先级排序）

### 优先级说明
- **P0（本周）**：修复未提交改动 + 补全 P1 关键缺口，立即提升产品可用性
- **P1（2周内）**：补齐 PRD P1 全部要求，完成"决策主链路"闭环
- **P2（1个月内）**：实现审查报告第3层部分可落地项（云端/推送/代理层需外部资源）
- **P3（长期）**：数据主权全面迁移、架构升级

---

## 五、P0 改进：修复与补全（本周）

### 5.1 【立即】提交未提交的 v9.23.1-fix 与 v9.24.3+ 改动

**【定位】** 本地 21 文件改动未入 main，线上版本落后于开发分支

**【现状】** 工作区 `M` 状态 21 文件，包含 v9.23.1 主线卡折叠、离场信号增强、席位台账等；线上仍为 v9.24.2

**【修改为】** 合并提交并部署为 v9.24.3

**【实现要点】**
```bash
cd "E:\CC-HAHA\workspace\022_股票监控项目\stock-monitor-v9.9\stock-monitor"

# 1. 更新版本 stamp
# App.tsx footer: v9.24.2 → v9.24.3 · build MM-DD HH:mm
# CHANGELOG.md 顶部新增 v9.24.3 章节

# 2. 构建（先确认 node_modules 存在）
npm install  # 若 node_modules 不存在
npm run build

# 3. 复制到根部署目录（关键！git root 是 workspace，非 subdir）
cp -rf src/. ../src/
cp index.html ../index.html
cp CHANGELOG.md ../CHANGELOG.md
cp -rf docs/. ../docs/

# 4. 在 workspace 根提交
cd ../../..
git add src/ docs/ index.html CHANGELOG.md
git commit -m "v9.24.3: 主线卡折叠增强+离场信号+席位台账完善+tsc 清零

- BattlePlan: 强度分<60 主线卡默认折叠一行摘要，点击展开
- App.tsx: 昨日涨停池按主线分组接入离场信号环比
- seatLedger/seatProfiles: 席位台账与画像增强
- sentimentStore/signalLedger: 情绪与信号账本完善
- regimeGate/recTracker/etfScore: 闸门/归因/ETF 评分增强
- 其余组件配套改动

🤖 Generated with [Claude Code](https://claude.com/claude-code)
"
git push origin arena/019fb619-stock-monitor
git push --force origin arena/019fb619-stock-monitor:main

# 5. 等 3 分钟验证
curl -s https://benlau88832-collab.github.io/stock-monitor/ | grep -oE "v9\.[0-9.]+ · build [0-9: -]+"
```

**【验收标准】**
- `curl` 返回 `v9.24.3 · build 08-03 XX:XX`
- `npx tsc --noEmit` 全绿
- 线上页面驾驶舱"强度分<60 主线卡"默认折叠

---

### 5.2 【P0-补全】A4 主线级退潮预警条

**【定位】** 驾驶舱 AlertBanner 区域，情绪周期雷达下方

**【现状】** AlertBanner 仅有大盘级"重度背离"等通用警报，缺主线级退潮独立红条

**【修改为】** 每条触发离场信号的主线生成独立红色通知条："⚠️ [主线名] 退潮：炸板率环比+18pp，建议减仓/离场"，支持多条堆叠、可手动关闭

**【实现要点】**
1. `App.tsx` 中遍历 `battlePlan.candidates`，收集所有 `c.exitSignal === true` 的主线，生成 `exitAlerts[]` 数组
2. 传入 `Dashboard` 组件
3. Dashboard 中在 `EmotionCycleCard` 下方渲染 `ExitSignalBanner` 新组件
4. 新建 `src/components/ExitSignalBanner.tsx`：接收 `alerts: {mainline: string; reason: string; ts: number}[]`，渲染红色竖条 + 关闭按钮，关闭后写入 localStorage `exitAlertMuted_{mainline}`
5. `alertBus` 不修改（退潮信号直接由数据计算，不走事件流）

**【验收标准】**
- 任意主线触发离场信号时，驾驶舱显示红色通知条
- 关闭后刷新页面不重复显示（localStorage 记忆）
- 多条退潮信号可堆叠显示

---

### 5.3 【P0-补全】A5 黄金窗口倒计时

**【定位】** `AnomalyStrip` 组件每条异动胶囊

**【现状】** `AnomalyEvent` 已有 `firstSeen: number` 字段，30s 定时器刷新，但 UI 未显示"距首次触发 X 分钟"

**【修改为】** 每条异动右侧显示"⏱ X 分钟前"小标签（精确到分钟），S/A 级红闪/高亮不变

**【实现要点】**
1. `Dashboard.tsx` 中 `AnomalyStrip` 组件内，对每条 `event` 计算：
   ```ts
   const minutesAgo = Math.floor((Date.now() - event.firstSeen) / 60000);
   const windowLabel = minutesAgo <= 1 ? "刚刚" : `${minutesAgo}分钟前`;
   ```
2. 30s 定时器已存在，继续用于刷新显示
3. 在事件胶囊右上角叠加 `<span className="text-[9px] text-slate-500">⏱ {windowLabel}</span>`

**【验收标准】**
- S/A/B 级异动均显示"⏱ X 分钟前"
- 首次触发后即时显示"刚刚"，30 秒后刷新为"1分钟前"

---

### 5.4 【P0-补全】A5 声音播报

**【定位】** S 级异动触发时

**【现状】** 代码注释写"红色闪烁+声音播报"，实际只闪烁

**【修改为】** 新 S 级事件 emit 时触发浏览器 AudioContext 或 `<audio>` 元素播放短促"叮"声（复用现有铃铛图标逻辑）

**【实现要点】**
1. 在 `anomalyTier.ts` `emitAnomaly` 中，若 `level === "S"`，尝试调用 `new Audio('/alert.mp3').play()`
2. 或在 `Dashboard.tsx` 订阅 `subscribeAnomaly` 时检测 S 级新事件，调用声音
3. 声音文件：新建 `public/alert.mp3`（或使用 Web Audio API 合成短蜂鸣）
4. 尊重用户静音开关（现有 `alert_muted_today` 逻辑可扩展）

**【验收标准】**
- S 级异动触发时播放声音
- 静音状态下不播放（`localStorage.alert_muted_today === '1'`）
- A/B 级不播放

---

### 5.5 【P0-补全】A3 情绪周期 5 段进度条

**【定位】** `EmotionCycleCard.tsx` 组件

**【现状】** 只有周期徽标 + 证据链，缺横向 5 段进度条可视化

**【修改为】** 周期徽标下方新增 5 段横向色块条（冰点→启动→加速→分歧→退潮），当前周期高亮，其余灰底

**【实现要点】**
1. 在 `EmotionCycleCard.tsx` 周期徽标行下方新增：
   ```tsx
   <div className="flex h-2 rounded overflow-hidden bg-slate-700">
     {(['冰点', '启动', '加速', '主升分歧', '退潮'] as const).map(phase => (
       <div key={phase} className={`flex-1 ${result.phase === phase ? meta.color : 'bg-slate-600/30'}`} />
     ))}
   </div>
   ```
2. 色块宽度均分（flex-1），当前阶段填充强调色，其余灰色半透明

**【验收标准】**
- 情绪周期雷达卡片显示 5 段进度条
- 当前周期色块高亮，其余灰色
- 与现有徽标/证据链布局兼容

---

### 5.6 【P0-补全】B2 资金流≠强度提示语 + 排名列

**【定位】** 资金主线页 `FundStructure.tsx`（概念板块资金流排行表）

**【现状】** 表头无提示语，无"强度榜排名"列

**【修改为】**
1. 表格上方新增提示语："💡 资金流入金额大 ≠ 主线强度高，请以上方【主线强度排行榜】为准"
2. 表格新增列"强度榜排名"：若该板块在 `MainlineRanking` 前 5，显示"Top5⚡"；否则空

**【实现要点】**
1. `App.tsx` 中把 `battlePlan.candidates` 前 5 名主线名收集为 `top5Mainlines: string[]`
2. 传入 `FundStructure` 组件作为 `top5Mainlines` prop
3. `FundStructure.tsx` 表格上方渲染提示语（固定文本）
4. 表格新增列：遍历该行板块名，若 `top5Mainlines.includes(board.name)` 显示 `<span className="text-rose-400">Top5⚡</span>` 否则 `—`

**【验收标准】**
- 资金流排行表上方有提示语
- 强度榜 Top5 板块在资金流表中显示"Top5⚡"标记

---

## 六、P1 改进：补齐 PRD P1 全部要求（2 周内）

### 6.1 【P1】B3 主线切换雷达

**【定位】** 资金主线页 `DarkPool.tsx`（明暗盘）或 `FundStructure.tsx`（资金连续性模块）下方

**【现状】** 无

**【修改为】** 当近 3 日 Top5 板块中有 ≥2 个不同板块新进时，生成提示卡："资金正从 [旧板块] 转向 [新板块]，警惕主线切换"

**【实现要点】**
1. 在 `lib/fundFlow.ts`（新建）或 `FundStructure.tsx` 内增加 `detectMainlineSwitch(history: BoardFlowEntry[], days: number = 3): SwitchAlert | null`
   - 输入：过去 N 日每个板块的净流入数据（可从 `dataStore` 读 `ds_fundflow` 或新建）
   - 逻辑：比较"近 3 日 Top5"与"前 3 日 Top5"，计算差集
   - 若差集中 ≥2 个不同板块，返回 `SwitchAlert`
2. `App.tsx` 计算切换信号，传入 `FundStructure`
3. `FundStructure.tsx` 在资金连续性模块下方渲染切换提示卡

**【验收标准】**
- 当板块资金流向发生实质切换时，显示黄色提示卡
- 提示卡含"从 X 转向 Y"的具体板块名
- 无切换时不显示

---

### 6.2 【P1】B4 明暗盘 AI 解读

**【定位】** `DarkPool.tsx` 明暗盘 TOP10 表格下方

**【现状】** 仅展示明暗盘数字对比，无 AI 解读

**【修改为】** 表格下方新增一行 AI 解读（≤30 字），示例："明盘净流入但暗盘净流出，判断为尾盘对倒护盘，非真实进场"

**【实现要点】**
1. 在 `lib/darkPoolAI.ts`（新建）增加 `interpretDarkPool(topBoards: BoardFlow[]): string`
   - 规则逻辑：
     - 明盘净流入 > 暗盘净流出 → 真实进场
     - 明盘净流出 > 暗盘净流入 → 真实出货
     - 明盘净流入但暗盘净流出且金额接近 → "尾盘对倒护盘，非真实进场"
     - 明盘净流出但暗盘净流入 → "暗盘吸筹，主力对倒"
   - 取 `topBoards[0]`（最强板块）解读
2. `DarkPool.tsx` 底部渲染 `<div className="text-[11px] text-slate-400">{interpretation}</div>`

**【验收标准】**
- 明暗盘表格下方显示 AI 解读文字（≤30 字）
- 解读基于真实数据规则，无 LLM 调用（纯规则，零延迟）

---

### 6.3 【P1】C2 个股雷达自动触发决策卡

**【定位】** `StockWatchlist.tsx` 自选股列表

**【现状】** "AI批量扫描"按钮需手动点击，无自动触发

**【修改为】** 自选股列表中任意一只触发异动（涨幅>5% 且 5 分钟内、量比>3），自动重新生成该股决策卡，列表项显示红点 + 置顶排序

**【实现要点】**
1. 在 `StockWatchlist.tsx` 中监听 `subscribeAnomaly` 事件流
2. 每当新事件 `event.code === watchStock.code` 且 `event.level === "S" || "A"` 时：
   - 在 `watchStocks` 数组中该股票对象上设 `hasAnomaly: true`
   - 把该股票移到列表顶部（`sort((a,b) => b.hasAnomaly - a.hasAnomaly)`）
3. 列表项右侧新增红点徽标（`<span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />`）
4. 点击决策卡时标记已读，红点消失

**【验收标准】**
- 自选股中某只触发 S/A 级异动后，自动置顶 + 红点
- 点击该股票决策卡后红点消失

---

### 6.4 【P1】C3 信息流 AI 信号标签

**【定位】** `StockWatchlist.tsx` 资金面/消息面/公告信息流列表项

**【现状】** 仅有分类色块（资金面/消息面/公告），无 AI 信号标签

**【修改为】** 每条信息后新增"利好/利空/中性 + 即时/次日/长期影响"小徽章

**【实现要点】**
1. 在 `lib/stockSignals.ts`（新建）增加 `classifySignal(item: NewsItem | Announcement): {sentiment: '利好'|'利空'|'中性'; timing: '即时'|'次日'|'长期'}`
   - 关键词规则：
     - 利好：业绩预增/中标/订单/回购/增持/政策利好/业绩超预期
     - 利空：减持/立案/业绩预亏/业绩下滑/诉讼/处罚/解禁
     - 即时：公告/快讯/业绩（当日影响）
     - 次日：龙虎榜/机构调研（次日影响）
     - 长期：股东变更/战略转型（中长期影响）
2. `StockWatchlist.tsx` 信息流每条渲染时，调用 `classifySignal`，拼接徽章

**【验收标准】**
- 每条信息流右侧显示"利好/利空/中性 + 即时/次日/长期"双徽章
- 规则基于关键词，无 LLM 调用

---

### 6.5 【P1】D2 龙虎榜资金一致性标签

**【定位】** `DragonTiger.tsx` 龙虎榜个股展开区域

**【现状】** `seatBehavior.ts` 仅有"格局派对倒"单一条目，缺整体一致性判断

**【修改为】** 新增判断：若买入前5席位中有≥2个"知名游资"标签且买入金额均为正，标注"🟢 一致性买入（抱团）"；若买卖席位同时出现知名游资买入和卖出，标注"🔴 分歧对倒"

**【实现要点】**
1. 在 `lib/seatBehavior.ts` 增加 `analyzeConsistency(buyers: SeatRow[], sellers: SeatRow[], knownSeats: SeatTag[]): ConsistencyTag`
   - 逻辑：
     - 买入前5中有≥2个 `knownSeats` 标签 → 抱团加分
     - 买卖双方均有知名游资 → 分歧对倒
     - 买方金额远大于卖方 → 合力买入
     - 卖方金额远大于买方 → 合力出货
2. `DragonTiger.tsx` 在个股展开区域顶部渲染一致性标签

**【验收标准】**
- 龙虎榜个股展开后显示"🟢 抱团"/"🔴 分歧"/"⚪ 观望"标签
- 标签基于买入卖出席位数据计算

---

### 6.6 【P1】D3 接力强度评分

**【定位】** 涨停股龙虎榜列表顶部

**【现状】** 无

**【修改为】** 新增列"接力建议"：综合封单强度 + 历史次日溢价统计，输出"建议冰点/半路/追高/不建议"四档标签

**【实现要点】**
1. 在 `lib/themeLadder.ts` 或新建 `lib/boardRelay.ts` 增加 `computeRelayScore(board: LimitBoardEntry): RelaySuggestion`
   - 规则：
     - 封单/流通市值 > 5% → "冰点可接"
     - 封单/流通市值 2%~5% → "半路可试"
     - 封单/流通市值 < 2% 且高度 ≥ 3板 → "追高风险大"
     - 炸板历史高频 → "不建议"
   - 次日溢价数据：从 `dataStore` 读 `ztSnapshot` 历史回填（已有数据）
2. `ThemeLadder.tsx` 或 `LimitBoard.tsx` 表格新增"接力建议"列

**【验收标准】**
- 涨停梯队/龙虎榜列表显示"冰点/半路/追高/不建议"四档标签
- 标签基于封单强度与历史数据计算

---

### 6.7 【P1】E2 情报晨报/午报/收评

**【定位】** `NewsPanel.tsx` "AI要点"模块

**【现状】** 仅收盘复盘（`closeReview` 任务槽），缺晨报/午报

**【修改为】** 按时间自动生成三个版本的结构化报告（9:30 前晨报 / 13:00 午报 / 15:00 后收评）

**【实现要点】**
1. 在 `lib/aiPrompts.ts` 新增两个任务槽：
   - `morningBrief`（9:30 前）：system 为"游资早报分析师"，user 包含"昨日涨停池 + 今晚消息面"，输出"今日关注主线 + 潜在催化 + 风险事件"
   - `middayBrief`（13:00）：system 为"游资午报分析师"，user 包含"上午行情快照 + 早盘异动"，输出"上午主线验证 + 下午关注 + 风险事件"
2. 在 `App.tsx` 中根据 `getCurrentSession().phase` 决定触发哪个任务：
   - `pre` / `auction` → 调用 `morningBrief`
   - `trading` 且 12:00~13:00 → 调用 `middayBrief`
   - `post` → 调用 `closeReview`（已有）
3. `NewsPanel.tsx` "AI要点"模块根据时段显示对应报告

**【验收标准】**
- 盘前自动显示"今日关注清单"
- 午盘自动显示"上午复盘 + 下午关注"
- 收盘后显示"收盘复盘报告"
- 报告为结构化要点，非大段文字

---

### 6.8 【P1】F1 全局悬浮 Agnes 追问球

**【定位】** 页面右下角悬浮球，全站任意页面可见

**【现状】** AI 能力分散在各页面按钮中，无统一入口

**【修改为】** 新增悬浮球图标（复用顶部导航"AI 智导"标识风格），点击展开对话框，可基于当前页面上下文（如当前查看的主线/个股）发起追问

**【实现要点】**
1. 在 `App.tsx` 顶层（`<main>` 之外）渲染 `<AgnesFloatingBall />` 组件
2. 新建 `src/components/AgnesFloatingBall.tsx`：
   - 默认显示悬浮球图标（💬）
   - 点击展开浮层（固定定位，右下角，max-height 60vh，overflow-y auto）
   - 浮层内嵌现有 `IntelligenceDrawer.tsx` 的对话逻辑
   - 上下文自动注入：`currentMainline`（FiveQBar 第一条）+ `selectedStock`（StockWatchlist 选中股）
3. 追问时携带当前页面上下文 JSON 作为 system prompt 追加

**【验收标准】**
- 右下角有悬浮球，点击展开对话浮层
- 浮层内可发起追问，携带当前主线/个股上下文
- 关闭后悬浮球仍存在

---

### 6.9 【P1】F2 AI 卡片三按钮（采纳/忽略/反馈错误）

**【定位】** 所有 AI 生成的结构化卡片底部（MainlineDiagnosisCard / StockDecisionCard / AnomalyStrip 弹窗等）

**【现状】** 无

**【修改为】** 每个 AI 卡片底部加三个小按钮，点击后写入 `localStorage.aiFeedbackLog`

**【实现要点】**
1. 新建 `src/lib/feedbackLog.ts`：
   ```ts
   export interface FeedbackEntry { id: string; type: 'mainline'|'stock'|'anomaly'; action: 'adopt'|'ignore'|'error'; ts: number; comment?: string }
   export function logFeedback(entry: Omit<FeedbackEntry, 'ts'>): void {
     const log: FeedbackEntry[] = JSON.parse(localStorage.getItem('aiFeedbackLog') ?? '[]');
     log.push({ ...entry, ts: Date.now() });
     localStorage.setItem('aiFeedbackLog', JSON.stringify(log));
   }
   export function getFeedbackLog(): FeedbackEntry[] {
     return JSON.parse(localStorage.getItem('aiFeedbackLog') ?? '[]');
   }
   ```
2. 在 `MainlineDiagnosisCard.tsx`、`StockDecisionCard.tsx`、`AnomalyStrip` 弹窗内加三个按钮：
   ```tsx
   <div className="flex gap-1 mt-2">
     <button onClick={() => logFeedback({id, type:'mainline', action:'adopt'})}>👍 采纳</button>
     <button onClick={() => logFeedback({id, type:'mainline', action:'ignore'})}>👎 忽略</button>
     <button onClick={() => { const comment = prompt('请说明错误原因'); logFeedback({id, type:'mainline', action:'error', comment}) }}>⚠ 反馈错误</button>
   </div>
   ```
3. `id` 用 `crypto.randomUUID()` 或 `Date.now().toString(36)` 生成

**【验收标准】**
- 每个 AI 卡片底部有三个按钮
- 点击后写入 `localStorage.aiFeedbackLog`
- 页面刷新后数据保留

---

### 6.10 【P1】A6 持仓×主线匹配健康度诊断

**【定位】** 驾驶舱"持仓×主线匹配"卡片（顺风 X 异动 Y 孤立 Z）

**【现状】** 仅标注"顺风/异动/孤立"三类

**【修改为】** 每只持仓股新增 AI 一句话诊断 + 操作建议，归类到"核心票/跟风票/孤立票/伪主线票"四分类

**【实现要点】**
1. 在 `lib/positionMatch.ts` 增加 `classifyPosition(stock: WatchStock, mainlines: MainlineGroup[]): PositionClass`
   - 规则：
     - 股票在主线内 + 是龙头/龙二 → "核心票"
     - 股票在主线内 + 非龙头 → "跟风票"
     - 股票不在任何主线 → "孤立票"
     - 股票在主线但基本面弱（无业绩/无资质）→ "伪主线票"
2. Dashboard 中 `PositionMatch` 组件扩展渲染每只股票的分类徽章 + 一句话诊断

**【验收标准】**
- 持仓×主线匹配卡片每只股票显示"核心/跟风/孤立/伪主线"四色徽章
- 每只股票下方有一句话 AI 诊断（规则生成，无 LLM）

---

## 七、P2 改进：审查报告第3层（1 个月内）

> 以下改进需外部资源（云端存储/推送密钥/代理部署），需用户提供后再推进。

### 7.1 【P2-D1】云端持久化方案选型与最小实现

**【定位】** 全站数据从 localStorage 迁移到云端

**【现状】** 所有跨日数据（涨停快照、席位台账、自选股、复盘日志）依赖浏览器 localStorage，换设备/清缓存=历史清零

**【修改为】** 引入 Cloudflare D1/KV 或 Supabase，`localStorage` 降级为离线缓存

**【实现要点】**
1. 评估方案：
   - **Cloudflare KV**：免费额度 10 亿次读/1000 万次写，适合小型项目
   - **Supabase**：免费 500MB 数据库 + 认证，PostgreSQL 灵活
   - **自建 Serverless**：成本可控但需运维
2. 建议选 Supabase（有现成 React SDK，免费额度够用）
3. 设计数据表：
   - `zt_snapshots`（涨停快照）：date, data(json)
   - `seat_records`（席位台账）：date, code, dept_name, buy_amt, sell_amt
   - `watchlist`（自选股）：user_id, codes(json)
   - `reviews`（复盘日志）：date, content(json)
   - `ai_feedback`（AI 反馈）：id, type, action, ts
4. 改造 `dataStore.ts`：优先读写云端，失败时 fallback localStorage
5. 新增设备/用户标识（邀请码或本地生成 UUID）

**【验收标准】**
- 同一账号换设备登录后，自选股/复盘日志/席位台账同步
- 断网时仍可用 localStorage 兜底数据
- 联网后自动同步最新数据

---

### 7.2 【P2-F12】外部推送通道接入

**【定位】** 站外强提醒（手机推送）

**【现状】** 仅站内声音 + 浏览器 Notification

**【修改为】** 接入 Server 酱/企业微信机器人 Webhook，critical 级别事件同步推送

**【实现要点】**
1. 在 `SettingsModal.tsx` 新增"推送配置"区块：
   - Server 酱 key（可选）
   - 企业微信 Webhook 地址（可选）
   - 推送级别开关（critical/warning）
2. 新建 `src/lib/pushGateway.ts`：
   ```ts
   export async function sendPush(message: string, level: 'critical'|'warning'): Promise<void> {
     const config = JSON.parse(localStorage.getItem('push_config') ?? '{}');
     if (config.serverchan_key) {
       await fetch(`https://sctapi.ftqq.com/${config.serverchan_key}.send?title=stock-monitor&desp=${encodeURIComponent(message)}`);
     }
     if (config.feishu_webhook) {
       await fetch(config.feishu_webhook, { method: 'POST', body: JSON.stringify({ msg: 'text', text: message }) });
     }
   }
   ```
3. 在 `alertBus.ts` emit 时，若 `event.severity === 'critical'` 调用 `sendPush`

**【验收标准】**
- 配置 Server 酱 key 后，critical 级别事件推送到手机
- 未配置时静默失败

---

### 7.3 【P2-P-1】代理层与备用数据源

**【定位】** 接口稳定性与 CORS 限制解决

**【现状】** 直连东财，无代理、无备用源

**【修改为】** 边缘代理 + 备用源自动降级

**【实现要点】**
1. 部署 Cloudflare Worker 代理（独立项目，不在此仓库内）：
   ```js
   // worker.js
   const UPSTREAM = 'https://push2.eastmoney.com';
   export default { async fetch(request) {
     const url = new URL(request.url);
     url.hostname = 'push2.eastmoney.com';
     const response = await fetch(url.toString(), { cache: 'public, max-age=10' });
     return response;
   }};
   ```
2. `api.ts` 中新增 `API_BASE` 常量，默认指向代理地址（可配置）
3. 备用源：在 `api.ts` 中为"指数/涨跌家数/个股实时价"三类核心数据增加新浪/腾讯接口 fallback
4. 代理层短 TTL 缓存（10 秒），降低源站压力

**【验收标准】**
- 东财接口限流时自动降级到备用源
- UI 显示"当前使用备用数据源"标签（FreshnessTag 扩展）

---

### 7.4 【P2-P-4】接口健康度可视化页面

**【定位】** 新增导航项"系统状态"

**【现状】** `apiHealth.ts` 有遥测数据但无 UI

**【修改为】** 新增页面展示各接口成功率/延迟/最近失败时间

**【实现要点】**
1. 新建 `src/components/HealthDashboard.tsx`
2. 读取 `apiHealth` 存储的成功/失败计数，渲染表格
3. 在 `TopNav.tsx` 新增"系统状态"Tab（或放在设置面板内）

**【验收标准】**
- 可查看各接口近期成功率与平均延迟
- 页面数据来自 `apiHealth.ts` 已有遥测

---

### 7.5 【P2-C1】导航按交易时间轴重构

**【定位】** `TopNav.tsx` 的 TABS 结构

**【现状】** 5 个平铺 Tab：驾驶舱/资金主线/个股雷达/龙虎榜复盘/消息面

**【修改为】** 按交易时间轴分组：盘前竞价 / 盘中作战 / 盘后复盘 / 资金体检 / 消息情报

**【实现要点】**
1. `TopNav.tsx` 中 `TABS` 数组重组：
   ```ts
   const TABS = [
     { key: 'dashboard', label: '🌅 盘中作战', icon: '🌅' },
     { key: 'fundline', label: '💰 资金体检', icon: '💰' },
     { key: 'radar', label: '🎯 个股雷达', icon: '🎯' },
     { key: 'dragon', label: '📊 盘后复盘', icon: '📊' },
     { key: 'news', label: '📰 消息情报', icon: '📰' },
   ];
   ```
2. 根据 `getCurrentSession().phase` 自动高亮推荐 Tab（盘前推荐"盘中作战"，盘后推荐"盘后复盘"）
3. 新增"盘前竞价"快捷入口（AuctionBoard 组件）

**【验收标准】**
- 导航按时间轴分组，语义清晰
- 当前时段 Tab 高亮提示

---

### 7.6 【P2-C2】极简盯盘视图

**【定位】** 盘中时段默认首屏

**【现状】** 驾驶舱信息密度高，不适合盘中 3 秒扫一眼

**【修改为】** 盘中默认展示精简视图：情绪周期结论 + 自选股预警红点 + 主线龙头 Top3

**【实现要点】**
1. 新建 `src/components/MinimalDashboard.tsx`
2. 内容：
   - 情绪周期结论（EmotionCycleCard 精简版）
   - 自选股预警红点摘要
   - 当前主线龙头 Top3（FiveQBar 精简版）
   - "查看完整分析"按钮跳转完整驾驶舱
3. 根据 `getCurrentSession().phase === 'trading'` 自动推荐切换

**【验收标准】**
- 盘中时段驾驶舱显示精简视图
- 可一键切换回完整视图

---

### 7.7 【P2-C3/C4】移动响应式 + PWA

**【定位】** 窄屏适配 + 离线可用

**【现状】** 大量密集表格在手机上体验差，无 PWA 配置

**【修改为】** 窄屏下表格改卡片流/可滑动，新增 manifest + service worker

**【实现要点】**
1. `index.html` 添加 PWA meta 标签
2. 新建 `public/manifest.json`
3. 新建 `src/pwa.ts`（service worker 注册）
4. 各组件中用 Tailwind 响应式类（`md:`, `lg:`）改造密集表格

**【验收标准】**
- 手机上表格可横向滑动或转为卡片流
- 支持"添加到主屏幕"
- 离线时显示缓存数据

---

### 7.8 【P2】游资席位名录扩展

**【定位】** `seatProfiles.ts` 席位特征库

**【现状】** 硬编码 34 条，覆盖主要知名游资

**【修改为】** 扩展为 100+ 条，支持用户自定义添加

**【实现要点】**
1. 在 `seatProfiles.ts` 中把硬编码数组改为可配置结构
2. 新增 `SettingsModal.tsx` 中"席位管理"区块，允许用户增删席位关键词
3. 席位数据存入 `localStorage.seat_profiles_custom`

**【验收标准】**
- 用户可在设置中自定义席位关键词
- 自定义席位与内置席位合并显示

---

## 八、P3 长期优化

| 编号 | 模块 | 建议 |
|---|---|---|
| P3-1 | 策略历史胜率仪表盘 | BattlePlan/AI 推荐的长期回测公开展示，建立信任 |
| P3-2 | 备用数据源全面接入 | 东财/新浪/腾讯三线冗余 |
| P3-3 | 分时图/K 线可视化 | 引入 TradingView lightweight charts |
| P3-4 | 大宗交易折溢价监控 | 新增接口 + 组件 |
| P3-5 | 股东户数/十大流通股东 | 数据积累型功能，长期价值高 |

---

## 九、建议执行顺序

```
第 1 周：
  - [立即] 5.1 提交未提交改动（v9.24.3）
  - [P0] 5.2 A4 主线退潮预警条
  - [P0] 5.3 A5 黄金窗口倒计时
  - [P0] 5.4 A5 声音播报
  - [P0] 5.5 A3 情绪周期 5 段进度条
  - [P0] 5.6 B2 资金流≠强度提示语

第 2 周：
  - [P1] 6.1 B3 主线切换雷达
  - [P1] 6.2 B4 明暗盘 AI 解读
  - [P1] 6.3 C2 个股雷达自动触发
  - [P1] 6.4 C3 信息流 AI 信号标签
  - [P1] 6.5 D2 资金一致性标签
  - [P1] 6.6 D3 接力强度评分

第 3 周：
  - [P1] 6.7 E2 情报晨报/午报/收评
  - [P1] 6.8 F1 悬浮 Agnes 追问球
  - [P1] 6.9 F2 AI 三按钮反馈
  - [P1] 6.10 A6 持仓健康度诊断

第 4 周+：
  - [P2] 7.1 云端持久化（需选方案 + 用户提供密钥）
  - [P2] 7.2 外部推送（需用户提供 Server 酱 key）
  - [P2] 7.3 代理层（需部署 Cloudflare Worker）
  - [P2] 7.4 接口健康页
  - [P2] 7.5 导航重构
  - [P2] 7.6 极简盯盘视图
  - [P2] 7.7 PWA + 响应式
  - [P2] 7.8 席位名录扩展
```

---

## 十、关键代码约定（供编码 AI 遵守）

1. **NEVER modify**：`vite.config.ts`、`package.json` build config、`vite-plugin-singlefile` 设置、`base` 路径 —— 除非用户明确允许
2. **所有显示数据 MUST 来自真实接口**；NO 假数据、`Math.random`、mock
3. **不加重依赖**；保持暗色主题；中文代码注释解释"为什么"
4. **新增算法函数**（强度分/阶段判定/离场信号等）必须封装成独立可复用 JS 函数，并在注释中标明对应 PRD 第六章公式编号
5. **所有 AI 输出必须是结构化 JSON**，严禁自由大段文字
6. **合规话术**：所有操作建议类文案使用中性表达（"历史统计中...概率 X%"），禁用"建议买入/卖出"
7. **Hooks 顺序**：所有 `if(earlyReturn)` 必须放在所有 hooks 之后（React #310 教训）
8. **部署流程**：
   ```bash
   npm run build
   cp -rf src/. ../src/ && cp index.html ../index.html && cp CHANGELOG.md ../CHANGELOG.md && cp -rf docs/. ../docs/
   cd ../../.. && git add src/ docs/ index.html CHANGELOG.md && git commit -m "..." && git push
   ```

---

## 十一、待用户确认事项

1. **v9.24.3 未提交改动**：是否立即提交部署？
2. **tsc 状态**：当前已清零 ✅
3. **云端持久化方案**：倾向 Cloudflare KV 还是 Supabase？
4. **外部推送密钥**：是否有 Server 酱/企业微信 Webhook？
5. **代理层部署**：是否有 Cloudflare Worker 账户？
6. **旧分支清理**：`arena/019fa1a9`、`arena/019fa6b7` 是否删除？

---

*本文档基于对源码、CHANGELOG、git 历史、线上页面的深度审查生成；未改动任何文件。所有改进建议均可直接分段粘贴给 AI 编码工具执行。*
