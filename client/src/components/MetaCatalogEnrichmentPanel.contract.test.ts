import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("MetaCatalogEnrichmentPanel contract", () => {
  const source = readFileSync(new URL("./MetaCatalogEnrichmentPanel.tsx", import.meta.url), "utf8");

  it("يبقي الإعدادات المتقدمة والاستثناءات فقط، ويوكل اختيار وتجهيز الوسائط لمساحة العمل", () => {
    expect(source).toContain("الإعداد الافتراضي للمتجر");
    expect(source).toContain("الدينار العراقي (IQD)");
    expect(source).toContain("الدولار الأميركي (USD)");
    expect(source).toContain("Facebook Product Category");
    expect(source).toContain("Taxonomy الرسمية");
    expect(source).toContain("<MetaCatalogWorkspace");
    expect(source).toContain("إعدادات التصنيف المتقدمة");
    expect(source).toContain("تخصيص قسم من OneDrive");
    expect(source).toContain("الخامة المستخرجة من OneDrive");
    expect(source).toContain("رابط واجهة المتجر العامة");
    expect(source).toContain("استثناءات المنتج المحدد");
    expect(source).toContain("تجهيز وسائط المنتج");
    expect(source).not.toContain("prepareProductsMedia");
    expect(source).not.toContain("معاينة ما سيُرسل إلى Meta");
  });
});
