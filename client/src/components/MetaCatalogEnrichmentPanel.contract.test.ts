import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("MetaCatalogEnrichmentPanel contract", () => {
  const source = readFileSync(new URL("./MetaCatalogEnrichmentPanel.tsx", import.meta.url), "utf8");

  it("keeps store defaults, official taxonomy, high-quality media, groups, and product exceptions in the Catalog workflow", () => {
    expect(source).toContain("الإعداد الافتراضي للمتجر");
    expect(source).toContain("الدينار العراقي (IQD)");
    expect(source).toContain("الدولار الأميركي (USD)");
    expect(source).toContain("Facebook Product Category");
    expect(source).toContain("Taxonomy الرسمية");
    expect(source).toContain("قواعد مجموعة المنتجات");
    expect(source).toContain("الخامة المستخرجة من OneDrive");
    expect(source).toContain("رابط واجهة المتجر العامة");
    expect(source).toContain("وسائط عالية الجودة للكتالوج");
    expect(source).toContain("تجهيز وسائط");
    expect(source).toContain("استثناءات المنتج المحدد");
    expect(source).toContain("معاينة ما سيُرسل إلى Meta");
  });
});
