#!/bin/bash
# 本地模型执行脚本：连接真实数据 + 本地/远程 LLM 分析
# 用法：bash scripts/run_local_llm.sh [模型名称] [API_KEY]

MODEL=${1:-"qwen-plus"}
API_KEY=${2:-"$OPENAI_API_KEY"}

if [ -z "$API_KEY" ]; then
  echo "错误：未提供 API Key。请设置环境变量 OPENAI_API_KEY 或直接传入。"
  echo "示例：bash scripts/run_local_llm.sh gpt-4o-mini sk-..."
  exit 1
fi

echo "=== 1. 获取真实市场数据（东方财富接口，非模拟） ==="
curl -s -m 10 "http://localhost:3000/api/market/overview" > /tmp/market_data.json
curl -s -m 10 "http://localhost:3000/api/market/fund-structure" > /tmp/fund_data.json
curl -s -m 10 "http://localhost:3000/api/market/mainline" > /tmp/mainline_data.json
curl -s -m 10 "http://localhost:3000/api/news" > /tmp/news_data.json
echo "数据已抓取到 /tmp/*.json"

echo "=== 2. 构建漏斗分析提示词（真实数据，无模拟） ==="
PROMPT_FILE="/tmp/llm_funnel_prompt.txt"
cat > "$PROMPT_FILE" << 'INNER_EOF'
你是一名A股实盘辅助分析专家。以下所有数据均来自东方财富公开接口的真实抓取（无模拟数据、无AI幻觉）。
分析框架（漏斗模型）：
1. 市场环境（大盘指数、涨跌家数、成交额、情绪）
2. 资金结构（主力/散户/机构净流入、板块资金流向）
3. 主线板块（当前活跃板块、涨跌幅、资金集中度）
4. 潜力股票（结合资金、主线、风险信号筛选）
5. 风险雷达（质押、减持、监管、换手率>25%、一票否决信号）
6. 重要新闻（公告、监管动态、全球信号）
7. 最终输出：3-5只心仪股票代码 + 买入理由 + 风险警告（纯JSON格式）
数据文件路径：/tmp/market_data.json, /tmp/fund_data.json, /tmp/mainline_data.json, /tmp/news_data.json
输出要求：纯JSON，不要解释文字。
INNER_EOF

echo "提示词已写入 $PROMPT_FILE"

echo "=== 3. 调用本地/远程 LLM 执行分析 ==="
# 支持：gpt-4o-mini / qwen-plus / deepseek-chat
curl -s -X POST "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [
      {\"role\": \"system\", \"content\": \"你是A股实盘辅助分析专家，所有数据来自东方财富真实接口，无模拟数据。输出纯JSON。\"},
      {\"role\": \"user\", \"content\": \"基于以下真实市场数据（无模拟数据）进行漏斗式分析：市场概览数据-$(cat /tmp/market_data.json)；资金结构数据-$(cat /tmp/fund_data.json)；主线板块数据-$(cat /tmp/mainline_data.json)；新闻数据-$(cat /tmp/news_data.json)。请按漏斗模型输出最终选股建议（纯JSON）。\"}
    ],
    \"temperature\": 0.2
  }" > /tmp/llm_result.json

echo "分析结果已保存到 /tmp/llm_result.json"
echo "=== 执行完毕。查看结果：cat /tmp/llm_result.json ==="
