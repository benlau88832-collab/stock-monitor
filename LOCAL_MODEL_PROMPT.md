# 给本地模型（claude+qwen）的执行指令

## 我的身份与环境
- 我是 A 股实时监控终端的使用者
- 使用仓库：benlau88832-collab/stock-monitor，分支 arena/019f9863-stock-monitor
- 工作目录：/home/user/stock-monitor
- 本地模型：claude+qwen 组合

## 我的核心需求（不要遗漏，不要重复确认循环）

1. 真实数据：所有行情、资金、新闻、暗池数据必须来自东方财富真实公开接口（push2.eastmoney.com、datacenter-web.eastmoney.com、np-anotice-stock.eastmoney.com、np-weblist.eastmoney.com），禁止任何模拟/伪造数据。

2. 所有修改必须可见：每次修改必须 add、commit、push 到远程分支 arena/019f9863-stock-monitor，不能只停留在本地 workspace。

3. 文件完整性：必须包含并推送以下内容 — .env.example、README.md（完整交接文档）、LLMFunnel.tsx（漏斗模型：市场环境→资金结构→主线板块→潜力股票→风险雷达→新闻→LLM→最终选股）、Pitfalls.tsx（6个散户坑：追涨杀跌、盲目跟风、忽视风险信号、过度交易>25%、重仓单板、忽略一票否决）、DarkPool.tsx、GlobalSignals.tsx、KeyIndicators.tsx、realLinks.ts（真实可跳转东方财富链接生成器）、所有 API 路由。

4. LLM 模块要求：LLMFunnel 必须要求用户填入自己的 API Key（支持 gpt-4o-mini、qwen-plus、deepseek-chat），无 API Key 则无法运行，不使用任何默认密钥。

5. .env 配置：必须存在 .env.example（DATABASE_URL + 可选 LLM Key 注释），.env 本身不提交到 Git。

6. 无循环确认：执行完直接停止，不要重复说“已完成”或无限询问确认。只在执行完后简洁报告结果（远程文件列表 + 推送状态 + 构建状态）。

7. 真实演示要求：如果无法在 Agent Mode 提供右侧实时交互预览，必须明确说明“当前 Agent Mode 无法提供右侧实时预览”，并提供本地运行的最简步骤（npm run dev + localhost:3000）。

8. 本地执行脚本：已提供 scripts/run_local_llm.sh，支持 bash 执行，连接真实数据 + 本地 LLM 分析。

## 当前状态（已完成）
- 远程分支 arena/019f9863-stock-monitor 存在，最新提交 c26a96b
- 构建通过（npm run build 状态码 0）
- 无模拟数据（代码中明确标注“无模拟数据”）
- 数据接口在沙盒内被外部阻止，真实页面可通过本地 npm run dev 访问
- 预览图 dashboard_preview.jpg 已生成并展示

## 如需继续操作
请直接执行，不要再次描述背景或重复确认。执行完后只回复：操作结果 + 远程状态（如有变化）。
