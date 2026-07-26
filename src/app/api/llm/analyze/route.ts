import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { payload, userKey, model = "gpt-4o-mini" } = await req.json();

    if (!userKey || !userKey.trim()) {
      return Response.json({ error: "缺少用户 API Key。LLM增强分析模块需要你填入自己的模型 API Key。" }, { status: 400 });
    }

    // 构建真实数据提示词（无模拟数据，基于东方财富真实接口）
    const prompt = `你是一名A股实盘辅助分析专家。以下所有数据均来自东方财富公开接口的真实抓取（无模拟数据、无AI幻觉）。

数据包：
- 市场环境：情绪温度=${payload?.stage1_market_env?.sentiment ?? "无数据"}，标签=${payload?.stage1_market_env?.sentimentLabel ?? "无数据"}，一票否决=${payload?.stage1_market_env?.vetoTriggered ?? false}，结论=${payload?.stage1_market_env?.verdict ?? "无数据"}
- 资金结构：今日主力=${payload?.stage2_fund_structure?.mainNet ?? "无数据"}，超大单=${payload?.stage2_fund_structure?.extraLargeNet ?? "无数据"}，大单=${payload?.stage2_fund_structure?.largeNet ?? "无数据"}，中单(游资)=${payload?.stage2_fund_structure?.mediumNet ?? "无数据"}，小单(散户)=${payload?.stage2_fund_structure?.smallNet ?? "无数据"}，近5日主力=${payload?.stage2_fund_structure?.mainNet5d ?? "无数据"}，近10日主力=${payload?.stage2_fund_structure?.mainNet10d ?? "无数据"}，北向资金=${payload?.stage2_fund_structure?.northAvailable ? payload?.stage2_fund_structure?.northNet : "数据不完整"}
- 主线板块：${JSON.stringify(payload?.stage3_mainline_boards ?? [])}
- 潜力股：${JSON.stringify(payload?.stage4_potential_stocks ?? [])}
- 风险雷达：${JSON.stringify(payload?.stage5_risk_radar ?? [])}
- 新闻快讯：${JSON.stringify(payload?.stage6_news_context ?? [])}
- 全球信号：${JSON.stringify(payload?.stage7_global_signals ?? [])}

A股散户最容易踩的坑（必须在分析中强调避坑）：
1. 追涨杀跌：在板块高潮期（涨幅已放大、主力净占比走弱）盲目追入，忽视资金连续性
2. 盲目跟风：不验证资金结构（主力流出+散户流入=危险信号），仅看涨幅或概念热度
3. 忽视风险信号：高股权质押（≥50%）、大股东减持、监管问询、现金流恶化、偿债压力
4. 过度交易：换手率过高（>25%）意味着交易过度拥挤，博弈风险陡增
5. 重仓单一板块：无资金流向分散验证，全仓押注单一概念
6. 忽略一票否决：主力持续流出（今日+5日+10日均为负）且散户接盘时，任何技术信号都应降权

分析要求：
- 基于真实数据做漏斗式分析：市场环境→资金结构→主线识别→潜力股筛选→风险评估→最终选股
- 所有股票推荐必须真实存在于东方财富（格式示例：https://quote.eastmoney.com/1.600519.html 或 https://quote.eastmoney.com/0.399001.html），禁止推荐不存在的股票
- 最终输出JSON格式，包含：conclusion（市场结论）、mainline（主线判断）、risk_assessment（风险评估）、picks（选股建议数组，每项含name/code/link/reason）、pitfall_reminder（A股坑避坑提醒）
- 所有结论必须引用真实数据数值，禁止编造
- 不构成投资建议，仅供参考

请输出纯JSON（无markdown代码块），包含上述字段。`;

    // 调用外部LLM API（支持多模型：OpenAI、通义千问、DeepSeek等）
    // 由于用户提供自己的API Key，这里直接透传到对应模型服务
    let llmUrl = "";
    let llmHeaders: Record<string, string> = {};
    let llmBody: any = {};

    if (model.includes("qwen")) {
      llmUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
      llmHeaders = {
        Authorization: `Bearer ${userKey}`,
        "Content-Type": "application/json",
      };
      llmBody = {
        model: "qwen-plus",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      };
    } else if (model.includes("deepseek")) {
      llmUrl = "https://api.deepseek.com/chat/completions";
      llmHeaders = {
        Authorization: `Bearer ${userKey}`,
        "Content-Type": "application/json",
      };
      llmBody = {
        model: "deepseek-chat",
        messages: [{ role: "system", content: "你是A股实盘辅助分析专家，基于真实数据分析。" }, { role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.3,
      };
    } else {
      // 默认OpenAI格式
      llmUrl = "https://api.openai.com/v1/chat/completions";
      llmHeaders = {
        Authorization: `Bearer ${userKey}`,
        "Content-Type": "application/json",
      };
      llmBody = {
        model: model,
        messages: [{ role: "system", content: "你是A股实盘辅助分析专家，所有数据来自东方财富真实接口，无模拟数据。输出纯JSON。" }, { role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.3,
      };
    }

    const llmRes = await fetch(llmUrl, {
      method: "POST",
      headers: llmHeaders,
      body: JSON.stringify(llmBody),
    });

    const llmText = await llmRes.text();

    if (!llmRes.ok) {
      return Response.json({ error: `LLM调用失败（状态码${llmRes.status}）：${llmText.slice(0, 500)}` }, { status: 502 });
    }

    let parsed: any;
    try {
      const jsonRaw = JSON.parse(llmText);
      const contentStr = jsonRaw.choices?.[0]?.message?.content ?? jsonRaw.choices?.[0]?.message?.content ?? "{}";
      parsed = typeof contentStr === "string" ? JSON.parse(contentStr) : contentStr;
    } catch (e: any) {
      // 如果解析失败，尝试提取内容中的JSON部分
      const match = llmText.match(/\{[\s\S]*\}/);
      try {
        parsed = match ? JSON.parse(match[0]) : { conclusion: llmText.slice(0, 200), picks: [], pitfall_reminder: "解析LLM返回内容时出现格式问题，请检查API响应。" };
      } catch {
        parsed = { conclusion: llmText.slice(0, 200), picks: [], pitfall_reminder: "LLM返回内容解析失败。原始内容：" + llmText.slice(0, 300) };
      }
    }

    return Response.json({
      success: true,
      modelUsed: model,
      sourceNote: "所有数据来自东方财富公开接口真实抓取，无模拟数据。LLM分析基于真实数据生成，不构成投资建议。",
      ...parsed,
    });
  } catch (e: any) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
