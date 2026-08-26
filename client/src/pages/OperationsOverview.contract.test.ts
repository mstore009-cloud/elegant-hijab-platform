import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./OperationsOverview.tsx", import.meta.url), "utf8");

describe("لوحة التشغيل وسياق المتجر", () => {
  it("تعرض هوية المتجر التشغيلي من عقد الصلاحيات", () => {
    expect(source).toContain("المتجر التشغيلي");
    expect(source).toContain("profile.data?.store?.store.name");
    expect(source).toContain("نطاق المتجر الحالي");
  });
});
