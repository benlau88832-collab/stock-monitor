// v9.109.0（L-2 根治 RC-A/B/C）：llmCore.chatComplete 单测 —— empty 重试/强制关 thinking/端点 failover
// 用 _post 依赖注入 mock 网络层（vi.mock 对 CJS require 拦截不稳定；hostGuard 白名单拦截假端点）
import { describe, it, expect, vi, beforeEach } from "vitest";
import { chatComplete } from "../llmCore";

function makePost() {
  return vi.fn();
}

// 测试隔离：无熔断、无计数的 aiHealth stub（llmCore 支持 _aiHealth 注入；真实 aiHealth 在 ESM/CJS interop 下实例不共享）
const STUB_HEALTH = { recordResult: () => {}, isCircuitOpen: () => false };

beforeEach(() => {
  delete process.env.AI_FALLBACK;
  process.env.AI_BASE_URL = "https://main.test/v1/chat/completions";
  process.env.AI_MODEL = "m1";
  process.env.AI_API_KEY = "k1";
});

describe("v9.109.0 llmCore.chatComplete", () => {
  it("empty content 重试：首次空第二次有 → 返回非空且第二次 enable_thinking:false", async () => {
    const post = makePost();
    post.mockResolvedValueOnce({ choices: [{ message: {} }] }); // 首次空 content
    post.mockResolvedValueOnce({ choices: [{ message: { content: "ok" } }] });
    const r = await chatComplete({ system: "s", user: "u", maxTokens: 4000, thinking: true, _post: post, _aiHealth: STUB_HEALTH });
    expect(r.text).toBe("ok");
    expect(post).toHaveBeenCalledTimes(2);
    // 第二次请求体强制关 thinking
    const secondBody = post.mock.calls[1][1];
    expect(secondBody.chat_template_kwargs.enable_thinking).toBe(false);
    // 首次请求体 thinking=true 保留
    const firstBody = post.mock.calls[0][1];
    expect(firstBody.chat_template_kwargs.enable_thinking).toBe(true);
  });

  it("thinking 恒发 enable_thinking:false（根治 RC-A：不再依赖 AI_PROVIDER 门控）", async () => {
    const post = makePost();
    post.mockResolvedValue({ choices: [{ message: { content: "ok" } }] });
    await chatComplete({ system: "s", user: "u", thinking: false, _post: post, _aiHealth: STUB_HEALTH });
    const body = post.mock.calls[0][1];
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("failover：主端点网络错 → 备用端点成功（endpoint:1）", async () => {
    process.env.AI_FALLBACK = "https://backup.test/v1/chat/completions|m2|k2";
    const post = makePost();
    post.mockRejectedValueOnce(new Error("upstream timeout")); // 主端点网络错
    post.mockResolvedValueOnce({ choices: [{ message: { content: "backup ok" } }] }); // 备用成功
    const r = await chatComplete({ system: "s", user: "u", _post: post, _aiHealth: STUB_HEALTH });
    expect(r.text).toBe("backup ok");
    expect(r.endpoint).toBe(1);
  });

  it("主端点 4xx → 直接抛（不切端点不计费）", async () => {
    process.env.AI_FALLBACK = "https://backup.test/v1/chat/completions|m2|k2";
    const post = makePost();
    post.mockRejectedValue(new Error("http 400"));
    await expect(chatComplete({ system: "s", user: "u", _post: post, _aiHealth: STUB_HEALTH })).rejects.toThrow(/http 400/);
    expect(post).toHaveBeenCalledTimes(1); // 未尝试备用
  });

  it("empty 重试耗尽 → 抛 empty content", async () => {
    const post = makePost();
    post.mockResolvedValue({ choices: [{ message: {} }] }); // 恒空
    await expect(chatComplete({ system: "s", user: "u", _post: post, _aiHealth: STUB_HEALTH })).rejects.toThrow(/empty content/);
    expect(post).toHaveBeenCalledTimes(3); // 1 次 + 2 次重试
  });

  // v9.110.0（MOD-2 安全网）：content 空 + reasoning 有实质内容 → 用推理输出（防未来切 R1/reasoner）
  it("reasoning_content 兜底：content 空但 reasoning ≥20 字 → 返回推理文本 + fromReasoning:true", async () => {
    const post = makePost();
    post.mockResolvedValue({ choices: [{ message: { content: "", reasoning_content: "主线是芯片方向，AI算力持续走强，半导体设备领涨。" } }] });
    const r = await chatComplete({ system: "s", user: "u", _post: post, _aiHealth: STUB_HEALTH });
    expect(r.text).toContain("芯片");
    expect(r.fromReasoning).toBe(true);
  });

  it("reasoning 过短（<20 字）→ 不算兜底，走 empty 重试", async () => {
    const post = makePost();
    post.mockResolvedValue({ choices: [{ message: { content: "", reasoning_content: "短" } }] });
    await expect(chatComplete({ system: "s", user: "u", _post: post, _aiHealth: STUB_HEALTH })).rejects.toThrow(/empty content/);
    expect(post).toHaveBeenCalledTimes(3);
  });

  // v9.111.0（R-1）：finish_reason=length 截断 → 重试并上调 max_tokens（ReAct JSON 截断是降级真因）
  it("length 截断重试：首次 JSON 截断(length) → 重试且第二次 max_tokens≥6000 → 返回完整 text", async () => {
    const post = makePost();
    post.mockResolvedValueOnce({ choices: [{ message: { content: '{"calls":[{"tool":"getL' }, finish_reason: "length" }] });
    post.mockResolvedValueOnce({ choices: [{ message: { content: '{"final":{"reply":"完整结论"}}' }, finish_reason: "stop" }] });
    const r = await chatComplete({ system: "s", user: "u", maxTokens: 4000, _post: post, _aiHealth: STUB_HEALTH });
    expect(r.text).toContain("完整结论");
    expect(post).toHaveBeenCalledTimes(2);
    const secondBody = post.mock.calls[1][1];
    expect(secondBody.max_tokens).toBeGreaterThanOrEqual(6000); // 4000 + 2000 上调
  });

  it("length 重试耗尽 → 抛 length truncated（截断 JSON 对 ReAct 无用，立即降级）", async () => {
    const post = makePost();
    post.mockResolvedValue({ choices: [{ message: { content: "截断的" }, finish_reason: "length" }] });
    await expect(chatComplete({ system: "s", user: "u", maxTokens: 4000, _post: post, _aiHealth: STUB_HEALTH })).rejects.toThrow(/length truncated/);
    expect(post).toHaveBeenCalledTimes(3);
  });

  // v9.111.0（S-1/R-3）：正常返回带 reasoning/reasoningLen 字段（供 D-4 会话预算纳入恒思考消耗）
  it("正常返回带 reasoning/reasoningLen 字段", async () => {
    const post = makePost();
    post.mockResolvedValue({ choices: [{ message: { content: "正文", reasoning_content: "思考过程……" }, finish_reason: "stop" }] });
    const r = await chatComplete({ system: "s", user: "u", _post: post, _aiHealth: STUB_HEALTH });
    expect(r.text).toBe("正文");
    expect(r.reasoningLen).toBeGreaterThan(0);
    expect(r.reasoning).toContain("思考");
  });
});
