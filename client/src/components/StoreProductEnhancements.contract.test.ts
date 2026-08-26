import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("تحسينات صفحة المنتج", () => {
  it("تعرض إشعاراً مركزياً للون المضاف وتبقي خيارات السلة والتوصيل في مكان واحد", () => {
    const source = readFileSync(new URL("./StoreProductEnhancements.tsx", import.meta.url), "utf8");

    expect(source).toContain("تمت إضافة اللون إلى السلة");
    expect(source).toContain("شريط تقدم التوصيل المجاني في إشعار الإضافة");
    expect(source).toContain("{Math.round(progress ?? 0)}% من هدف التوصيل المجاني");
    expect(source).toContain("اللون المختار");
    expect(source).toContain("عرض السلة");
    expect(source).toContain("متابعة التسوق");
  });
});
