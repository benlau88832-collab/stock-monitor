# A股实时监控终端 - 代码审查上下文

## 项目概况
- 技术栈：Vite 7 + React 19 + Tailwind CSS 4 + TypeScript 5.9 + Recharts
- 部署：GitHub Pages，`/docs` 目录，单文件模式 (vite-plugin-singlefile)
- 预览：https://benlau88832-collab.github.io/stock-monitor/
- 仓库：https://github.com/benlau88832-collab/stock-monitor

## 当前版本 v4.7 功能模块

### 1. 市场监控 (MarketOverview.tsx)
- 5大A股指数实时行情（上证/深证/创业板/科创50/沪深300）
- 全市场涨跌家数统计（f104/f105/f106官方字段）
- 涨跌停统计（串行请求每个板块的涨幅最高/最低各50条）
- 情绪温度计（upRatio×40 + limitScore + avgPctScore + indexScore + 15）

### 2. 资金结构 (FundStructure.tsx)
- 主力/散户资金对比 + 一票否决机制
- 超大单/大单/中单/小单分档柱状图
- 近5日/近10日连续性判断
- 30天历史资金快照（图表+表格切换，数据来自push2his分别请求沪深合并）
- 概念板块资金流排行 净流入/净流出 Top10（含连续天数推算，有黑名单过滤假概念）

### 3. 明暗盘 (DarkPool.tsx)
- 采用同花顺6种组合判断模型：
  - 明盘=超大单+大单（公开大资金）
  - 暗盘=中单+小单（含主力拆单隐蔽资金）
  - 6种主力动向：看多/看空/洗盘低吸/拉升做T/吸筹/诱多出货
- 概念板块 TOP10 + 成分股展开（有黑名单过滤）
- 5列汇总卡片（资金总体/明盘/暗盘/5日/10日）

### 4. 全球信号 (GlobalSignals.tsx)
- 10大海外指数：纳指/道指/标普500/恒指/日经/韩国KOSPI/台湾加权/DAX/富时100/澳洲标普200
- 沪深两市成交额

### 5. 个股监控 (StockWatchlist.tsx) — 新模块
- 左栏：监控个股列表（localStorage持久化，可添加/删除）
- 右栏：选中个股实时信息流（资金面+新闻利好利空标注+公告）
- AI研判：接入Agnes AI (agnes-2.5-flash)，需配置API Key

### 6. 快讯双栏 (NewsPanel.tsx) — 重写
- 🇨🇳 国内重要消息 + 🌍 外围国际消息
- 50+关键词自动分类
- 各栏独立滚动、悬停暂停

### 7. 主线识别 (Mainline.tsx)
- 行业+概念+地域板块综合排名
- 阶段判断：启动期/发酵期/高潮期/退潮期/观察中
- 潜力个股筛选 + 一票否决

### 8. 个股查询 (StockMonitor.tsx)
- 输入6位代码查看资金流

## 核心文件列表
```
src/
├── App.tsx                    # 主应用（Tab导航+模块路由+数据获取逻辑）
├── main.tsx                   # React入口
├── index.css                  # 基础样式
├── lib/
│   ├── api.ts                 # 所有API调用（JSONP封装+重试+东方财富接口）
│   ├── format.ts              # 金额/百分比格式化
│   └── realLinks.ts           # 东方财富真实链接生成
├── components/
│   ├── TopNav.tsx             # 导航栏
│   ├── MarketOverview.tsx     # 市场概览+情绪温度计
│   ├── FundStructure.tsx      # 资金结构+30天快照+板块排行
│   ├── DarkPool.tsx           # 明暗盘（同花顺6种组合）
│   ├── GlobalSignals.tsx      # 全球信号
│   ├── StockWatchlist.tsx     # 个股监控+AI研判（新）
│   ├── NewsPanel.tsx          # 快讯双栏（重写）
│   ├── Mainline.tsx           # 主线识别
│   ├── StockMonitor.tsx       # 个股查询
│   └── Pitfalls.tsx           # 避坑指南
└── utils/cn.ts                # 中文映射
```

## 涨跌停规则（2026年7月6日起）
| 板块 | 普通股 | ST/*ST |
|------|--------|--------|
| 主板(60/00) | ±10% | ±10% |
| 创业板(30) | ±20% | ±20% |
| 科创板(68) | ±20% | ±20% |
| 北交所(8/4/92) | ±30% | ±30% |

## 已知问题/待改进
1. 快讯JSONP需要no-referrer才能从github.io访问np-weblist.eastmoney.com
2. push2接口pz>100时容易502，已改为小分页+串行
3. 板块排行的连续天数是推算值（基于5日/10日方向），非精确逐日统计
4. LLM研判需要用户手动配置API Key，暂不支持自动触发
