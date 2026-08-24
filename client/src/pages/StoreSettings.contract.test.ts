import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("إعدادات المتجر الموحدة", () => {
  it("تعرض أجرة توصيل واحدة ولا تعرض إدخال أجور المحافظات", () => {
    const source = readFileSync(new URL("./StoreSettings.tsx", import.meta.url), "utf8");
    expect(source).toContain("أجرة التوصيل الموحدة");
    expect(source).toContain("defaultDeliveryFee");
    expect(source).toContain("قيمة واحدة لجميع المحافظات");
    expect(source).toContain("freeDeliveryEnabled");
    expect(source).toContain("freeDeliveryThreshold");
    expect(source).toContain("فعّل التوصيل المجاني للطلبات الكبيرة");
    expect(source).toContain("عند بلوغ إجمالي المنتجات");
    expect(source).not.toContain("governorates.map");
  });
});
