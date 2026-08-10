// v9.91.0（概念地基）：同花顺概念列表解析测试（GBK 页面 → (code, name)）
// fixture：真实抓取 q.10jqka.com.cn/gn/ 页面的 tbody 片段（GBK base64，含 7 个概念）
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
// @ts-ignore 服务端 CJS 无类型声明
import { parseConceptList } from "../../../server/lib/thsConcepts.js";

const fixturePath = path.join(__dirname, "fixtures", "ths_gn_snippet.b64");

describe("thsConcepts 同花顺概念列表解析（v9.91.0）", () => {
  it("GBK 页面解析出概念 (code, name) 对，中文名称正确", () => {
    const b64 = fs.readFileSync(fixturePath, "utf8").trim();
    const buf = Buffer.from(b64, "base64");
    const items = parseConceptList(buf);
    expect(items.length).toBeGreaterThanOrEqual(7);
    // 名称经 GBK→UTF8 转换后必须可读（乱码=解析失败）
    const byCode = new Map(items.map((i: { code: string; name: string }) => [i.code, i.name]));
    expect(byCode.get("309269")).toBe("MLCC概念");
    expect(byCode.get("309268")).toBe("玻璃基板");
    expect(byCode.get("309264")).toBe("AI应用");
  });

  it("去重：同 code 只保留首个", () => {
    const b64 = fs.readFileSync(fixturePath, "utf8").trim();
    const buf = Buffer.from(b64, "base64");
    const items = parseConceptList(buf);
    const codes = items.map((i: { code: string }) => i.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("空输入 → 空数组（不抛错）", () => {
    expect(parseConceptList(Buffer.from(""))).toEqual([]);
    expect(parseConceptList(Buffer.from("<html>无概念链接</html>", "utf8"))).toEqual([]);
  });
});
