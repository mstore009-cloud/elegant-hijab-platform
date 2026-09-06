import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("MetaCatalogEnrichmentPanel contract", () => {
  const source = readFileSync(new URL("./MetaCatalogEnrichmentPanel.tsx", import.meta.url), "utf8");

  it("keeps store defaults, high-quality media preparation, and product exceptions in the Catalog workflow", () => {
    expect(source).toContain("إعدادات إثراء Meta Catalog");
    expect(source).toContain("Facebook Product Category");
    expect(source).toContain("الخامة Material");
    expect(source).toContain("رابط واجهة المتجر العامة");
    expect(source).toContain("وسائط عالية الجودة للكتالوج");
    expect(source).toContain("تجهيز وسائط");
    expect(source).toContain("استثناءات المنتج المحدد");
  });
});
