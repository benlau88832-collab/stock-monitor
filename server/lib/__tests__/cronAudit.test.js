import { describe, it, expect } from "vitest";
import { auditCronExpressions } from "../cronAudit";

describe("cronAudit", () => {
  it("能扫描项目 cron.schedule 表达式并返回字段数", () => {
    const items = auditCronExpressions();
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.file).toBeTruthy();
      expect(item.expression).toBeTruthy();
      expect(item.fieldCount).toBeGreaterThanOrEqual(5);
    }
  });
});
