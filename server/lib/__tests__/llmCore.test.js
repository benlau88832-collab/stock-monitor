// v9.109.0（L-2 根治 RC-A/B/C）：llmCore.chatComplete 单测 —— empty 重试/强制关 thinking/端点 failover
// 用 _post 依赖注入 mock 网络层（vi.mock 对 CJS require 拦截不稳定；hostGuard 白名单拦截假端点）
import { describe, it, expect, vi, beforeEach } from "vitest";
import { chatComplete } from "../llmCore";

function makePost() {
  return vi.fn();
}

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
    const r = await chatComplete({ system: "s", user: "u", maxTokens: 4000, thinking: true, _post: post });
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
    await chatComplete({ system: "s", user: "u", thinking: false, _post: post });
    const body = post.mock.calls[0][1];
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("failover：主端点网络错 → 备用端点成功（endpoint:1）", async () => {
    process.env.AI_FALLBACK = "https://backup.test/v1/chat/completions|m2|k2";
    const post = makePost();
    post.mockRejectedValueOnce(new Error("upstream timeout")); // 主端点网络错
    post.mockResolvedValueOnce({ choices: [{ message: { content: "backup ok" } }] }); // 备用成功
    const r = await chatComplete({ system: "s", user: "u", _post: post });
    expect(r.text).toBe("backup ok");
    expect(r.endpoint).toBe(1);
  });

  it("主端点 4xx → 直接抛（不切端点不计费）", async () => {
    process.env.AI_FALLBACK = "https://backup.test/v1/chat/completions|m2|k2";
    const post = makePost();
    post.mockRejectedValue(new Error("http 400"));
    await expect(chatComplete({ system: "s", user: "u", _post: post })).rejects.toThrow(/http 400/);
    expect(post).toHaveBeenCalledTimes(1); // 未尝试备用
  });

  it("empty 重试耗尽 → 抛 empty content", async () => {
    const post = makePost();
    post.mockResolvedValue({ choices: [{ message: {} }] }); // 恒空
    await expect(chatComplete({ system: "s", user: "u", _post: post })).rejects.toThrow(/empty content/);
    expect(post).toHaveBeenCalledTimes(3); // 1 次 + 2 次重试
  });
});
