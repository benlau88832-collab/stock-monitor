// v9.148.0（任务06）：chainVariables 变量库单测 —— 配置完整性/唯一性/人物清单
import { describe, it, expect } from "vitest";
import { CHAIN_VARIABLES, KEY_PEOPLE, getChainVariables, allVariableTasks, getKeyPeople, addPeopleSuggestion, confirmPeopleSuggestion, getPeopleSuggestions, getConfirmedPeople } from "../chainVariables";

describe("CHAIN_VARIABLES 配置完整性", () => {
  it("6 条链 × 每链 2-3 个变量，变量 key 全局唯一", () => {
    const keys = new Set();
    expect(Object.keys(CHAIN_VARIABLES)).toHaveLength(6);
    for (const [id, cfg] of Object.entries(CHAIN_VARIABLES)) {
      expect(cfg.name).toBeTruthy();
      expect(cfg.variables.length).toBeGreaterThanOrEqual(2);
      expect(cfg.variables.length).toBeLessThanOrEqual(3);
      for (const v of cfg.variables) {
        expect(v.key).toBeTruthy();
        expect(v.name).toBeTruthy();
        expect(v.zh).toBeTruthy();
        expect(v.en).toBeTruthy();
        expect(keys.has(v.key)).toBe(false);
        keys.add(v.key);
      }
    }
    expect(keys.size).toBe(18); // 6 链 × 3 = 18 个变量
  });

  it("getChainVariables 未知链返回 null", () => {
    expect(getChainVariables("nope")).toBeNull();
    expect(getChainVariables("semiconductor")).not.toBeNull();
  });
});

describe("allVariableTasks / KEY_PEOPLE", () => {
  it("allVariableTasks 枚举全部 17 个变量任务", () => {
    const tasks = allVariableTasks();
    expect(tasks).toHaveLength(18);
    expect(tasks[0].chainId).toBeTruthy();
    expect(tasks[0].variable.key).toBeTruthy();
  });

  it("人物种子 8 个且字段完整、链关联合法", async () => {
    const people = await getKeyPeople();
    expect(people).toHaveLength(KEY_PEOPLE.length);
    for (const p of people) {
      expect(p.name).toBeTruthy();
      expect(p.zh).toBeTruthy();
      expect(Array.isArray(p.chains)).toBe(true);
      for (const c of p.chains) expect(CHAIN_VARIABLES[c]).toBeTruthy();
    }
  });
});

describe("人物自扩散（v9.148.1 T7）", () => {
  const kv = new Map();
  const db = {
    query: async (sql, params) => {
      if (sql.includes("INSERT INTO kv_store")) { kv.set(params[0], params[1]); return { rows: [] }; }
      if (sql.includes("WHERE key='chain_people_suggestions'")) return { rows: kv.has("chain_people_suggestions") ? [{ value: kv.get("chain_people_suggestions") }] : [] };
      if (sql.includes("WHERE key='chain_people_confirmed'")) return { rows: kv.has("chain_people_confirmed") ? [{ value: kv.get("chain_people_confirmed") }] : [] };
      return { rows: [] };
    },
  };
  it("建议按 name 去重追加", async () => {
    await addPeopleSuggestion(db, { name: "新人物A", chains: ["aiCompute"], why: "测试" });
    await addPeopleSuggestion(db, { name: "新人物A", chains: ["aiCompute"], why: "重复" });
    const list = await getPeopleSuggestions(db);
    expect(list.filter((x) => x.name === "新人物A")).toHaveLength(1);
  });
  it("采纳 → 移入 confirmed 并从建议池移除；getKeyPeople 合并可见", async () => {
    await addPeopleSuggestion(db, { name: "新人物B", chains: ["robotics"], why: "Optimus 相关" });
    const r = await confirmPeopleSuggestion(db, "新人物B");
    expect(r.ok).toBe(true);
    expect((await getPeopleSuggestions(db)).some((x) => x.name === "新人物B")).toBe(false);
    expect((await getConfirmedPeople(db)).some((x) => x.name === "新人物B")).toBe(true);
    const people = await getKeyPeople(db);
    expect(people.some((p) => p.name === "新人物B")).toBe(true);
  });
});
