// v9.86.0（P2-7）：统一出站客户端 outbound.js 测试
// 方案：mock hostGuard 白名单（放行 127.0.0.1）+ 真实本地 HTTP 服务器 —— 走完整 requestRaw 请求流，
//   不依赖 vitest 对 node 内置模块（https/http）的 mock（vi.mock 对 CJS require 内置模块不可靠）。
// 守卫语义（与 P1-17 一致）：
//   - 仅"网络失败"重试；HTTP 4xx/5xx / 坏 JSON 不重试（防重复计费）
//   - getJsonWithFallback 主源失败自动降级，source 记录实际命中的 provider
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import http from "http";

// 服务端 CJS 无类型声明（tsc 下用 @ts-ignore 抑制 TS7016；运行时不受影响）

// ---- 白名单旁路：单测用本地 HTTP 服务器（127.0.0.1 不在生产白名单）----
// outbound.js 检测 VITEST_ALLOW_ANY_HOST 环境变量跳过 hostGuard（生产环境该 env 不存在）
let server: http.Server;
let baseUrl = "";
const hitCounts: number[] = [];
let hangHit: Record<string, number> = {};
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? "/";
    hitCounts.push(hitCounts.length + 1);
    if (path.startsWith("/hang")) {
      // 只断第一次（模拟瞬时网络错）：重试时同一路径应正常返回
      hangHit[path] = (hangHit[path] ?? 0) + 1;
      if (hangHit[path] === 1) { req.socket.destroy(); return; }
    }
    if (path.startsWith("/404")) { res.statusCode = 404; res.end("not found"); return; }
    if (path.startsWith("/bad")) { res.statusCode = 200; res.end("not-json"); return; }
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end('{"ok":true,"path":"' + path + '"}');
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

// @ts-ignore 服务端 CJS 无 .d.ts
let outbound: typeof import("../../../server/lib/outbound.js");
beforeEach(async () => {
  vi.resetModules();
  process.env.VITEST_ALLOW_ANY_HOST = "1";
  hitCounts.length = 0;
  hangHit = {};
  // @ts-ignore 服务端 CJS 无 .d.ts
  outbound = await import("../../../server/lib/outbound.js");
});
afterEach(() => { delete process.env.VITEST_ALLOW_ANY_HOST; });
afterEach(() => { vi.clearAllMocks(); });

describe("v9.86.0 outbound.getJson", () => {
  it("成功：返回 {data, source, asOf, duration}", async () => {
    const r = await outbound.getJson(`${baseUrl}/ok`, { source: "push2" });
    expect(r.data).toMatchObject({ ok: true });
    expect(r.source).toBe("push2");
    expect(r.asOf).toBeTruthy();
    expect(typeof r.duration).toBe("number");
    expect(hitCounts.length).toBe(1);
  });

  it("HTTP 404 不重试（retries=2 也不重试）→ reject type http", async () => {
    await expect(outbound.getJson(`${baseUrl}/404`, { retries: 2 })).rejects.toMatchObject({ type: "http" });
    expect(hitCounts.length).toBe(1);
  });

  it("网络错误重试一次后成功（请求 2 次）", async () => {
    const r = await outbound.getJson(`${baseUrl}/hang`, { retries: 1, source: "push2" });
    expect(r.data).toMatchObject({ ok: true });
    expect(hitCounts.length).toBe(2);
  });

  it("坏 JSON 不重试 → reject type parse", async () => {
    await expect(outbound.getJson(`${baseUrl}/bad`, { retries: 2 })).rejects.toMatchObject({ type: "parse" });
    expect(hitCounts.length).toBe(1);
  });

  it("retries=0（默认）网络错误不重试 → reject type network", async () => {
    await expect(outbound.getJson(`${baseUrl}/hang`)).rejects.toMatchObject({ type: "network" });
    expect(hitCounts.length).toBe(1);
  });
});

describe("v9.86.0 outbound.getJsonWithFallback", () => {
  it("主源失败 → fallback 成功，source 记录 fallback provider + fallback:true", async () => {
    const r = await outbound.getJsonWithFallback(
      `${baseUrl}/404`,
      `${baseUrl}/ok`,
      { primarySource: "push2", fallbackSource: "push2delay" },
    );
    expect(r.data).toMatchObject({ ok: true });
    expect(r.source).toBe("push2delay");
    expect(r.fallback).toBe(true);
    expect(r.primaryError).toBe("http");
    expect(hitCounts.length).toBe(2);
  });

  it("主源成功 → 不请求 fallback", async () => {
    const r = await outbound.getJsonWithFallback(
      `${baseUrl}/ok`,
      `${baseUrl}/ok`,
      { primarySource: "push2", fallbackSource: "push2delay" },
    );
    expect(r.source).toBe("push2");
    expect(r.fallback).toBeUndefined();
    expect(hitCounts.length).toBe(1);
  });

  it("双源都失败 → 抛主源错误（调用方走既有降级路径）", async () => {
    await expect(outbound.getJsonWithFallback(`${baseUrl}/hang1`, `${baseUrl}/hang2`)).rejects.toMatchObject({ type: "network" });
    expect(hitCounts.length).toBe(2);
  });
});

describe("v9.86.0 白名单防线（hostGuard 语义）", () => {
  it("非白名单 host 直接拒绝；白名单域名放行", async () => {
    // @ts-ignore 服务端 CJS 无 .d.ts
    const { assertHostAllowed } = await import("../../../server/lib/hostGuard.js");
    expect(() => assertHostAllowed("https://evil.example.com/x")).toThrow(/白名单/);
    expect(() => assertHostAllowed("https://push2.eastmoney.com/x")).not.toThrow();
    expect(() => assertHostAllowed("https://web.ifzq.gtimg.cn/x")).not.toThrow();
  });
});
