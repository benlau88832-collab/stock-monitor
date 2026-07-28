# 发给 Claude 的审查 Prompt

直接复制以下内容发给 Claude（Direct模式，不要用Code模式）：

---

不要写任何代码，不要创建任何文件。我只需要你做代码审查，给出文字形式的修改建议。

这是我的 A股实时监控终端 项目，当前版本 v4.7。请逐一读取以下源码文件，然后给出审查意见。

**项目概况文档**（先读这个了解整体架构）：
https://raw.githubusercontent.com/benlau88832-collab/stock-monitor/main/CODE_REVIEW_CONTEXT.md

**核心文件**：
https://raw.githubusercontent.com/benlau88832-collab/stock-monitor/main/src/lib/api.ts
https://raw.githubusercontent.com/benlau88832-collab/stock-monitor/main/src/App.tsx

**组件文件**（按重要性排序，如果上下文不够就只看前几个）：
https://raw.githubusercontent.com/benlau88832-collab/stock-monitor/main/src/components/StockWatchlist.tsx
https://raw.githubusercontent.com/benlau88832-collab/stock-monitor/main/src/components/FundStructure.tsx
https://raw.githubusercontent.com/benlau88832-collab/stock-monitor/main/src/components/DarkPool.tsx
https://raw.githubusercontent.com/benlau88832-collab/stock-monitor/main/src/components/NewsPanel.tsx
https://raw.githubusercontent.com/benlau88832-collab/stock-monitor/main/src/components/MarketOverview.tsx
https://raw.githubusercontent.com/benlau88832-collab/stock-monitor/main/src/components/GlobalSignals.tsx

请从以下维度审查，给出具体的修改建议：
1. API接口URL和参数是否正确、是否有遗漏的错误处理
2. 数据计算逻辑是否有bug（特别是涨跌停统计、资金结构、明暗盘判断）
3. 明暗盘的同花顺6种组合判断逻辑是否准确
4. 板块名称黑名单是否需要补充
5. 个股监控模块的信息聚合是否完善，还缺少哪些数据源
6. 快讯国内/国外分类的关键词是否需要补充
7. UI/UX方面有哪些可以改进的地方
8. 性能优化建议（减少请求数、避免重复渲染等）
