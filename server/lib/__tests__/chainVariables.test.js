// v9.148.0（任务06）：chainVariables 变量库单测 —— 配置完整性/唯一性/人物清单
import { describe, it, expect } from "vitest";
import { CHAIN_VARIABLES, KEY_PEOPLE, getChainVariables, allVariableTasks, getKeyPeople } from "../chainVariables";

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

  it("人物种子 8 个且字段完整、链关联合法", () => {
    const people = getKeyPeople();
    expect(people).toHaveLength(KEY_PEOPLE.length);
    for (const p of people) {
      expect(p.name).toBeTruthy();
      expect(p.zh).toBeTruthy();
      expect(Array.isArray(p.chains)).toBe(true);
      for (const c of p.chains) expect(CHAIN_VARIABLES[c]).toBeTruthy();
    }
  });
});
