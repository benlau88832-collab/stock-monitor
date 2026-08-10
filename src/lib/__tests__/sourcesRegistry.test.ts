// v9.86.0（P1-16）：数据源注册表一致性测试 —— 前端 sources.ts
// 单一事实来源的守卫：host 唯一、fallbackTo 存在、字段完备（防新增 provider 时漏配置导致查表返回 undefined）
import { describe, it, expect } from "vitest";
import { PROVIDERS, fallbackHostFor, hostOf } from "../sources";

describe("v9.86.0 前端数据源注册表 sources.ts", () => {
  it("host 全局唯一（Map 覆盖会导致静默丢条目）", () => {
    const hosts = PROVIDERS.map(p => p.host);
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it("id 全局唯一", () => {
    const ids = PROVIDERS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("fallbackTo 引用的 provider 必须存在", () => {
    const ids = new Set(PROVIDERS.map(p => p.id));
    for (const p of PROVIDERS) {
      if (p.fallbackTo) expect(ids.has(p.fallbackTo)).toBe(true);
    }
  });

  it("fallback 链不构成环（防 push2→push2delay→push2 死循环）", () => {
    for (const p of PROVIDERS) {
      const seen = new Set([p.id]);
      let cur = p.fallbackTo;
      while (cur) {
        expect(seen.has(cur)).toBe(false); // 走到已访问节点 = 环
        seen.add(cur);
        cur = PROVIDERS.find(x => x.id === cur)?.fallbackTo;
      }
    }
  });

  it("push2 的 fallback 是 push2delay（jsonpQueue 域名降级正确性）", () => {
    expect(fallbackHostFor("push2.eastmoney.com")).toBe("push2delay.eastmoney.com");
  });

  it("push2his 的 fallback 是腾讯 kline", () => {
    expect(fallbackHostFor("push2his.eastmoney.com")).toBe("web.ifzq.gtimg.cn");
  });

  it("无 fallback 的 provider 返回 undefined（不做无效降级）", () => {
    expect(fallbackHostFor("np-weblist.eastmoney.com")).toBeUndefined();
    expect(fallbackHostFor("不存在的域名")).toBeUndefined();
  });

  it("hostOf 按 id 取 host", () => {
    expect(hostOf("tencentQuote")).toBe("qt.gtimg.cn");
    expect(hostOf("不存在")).toBeUndefined();
  });
});
