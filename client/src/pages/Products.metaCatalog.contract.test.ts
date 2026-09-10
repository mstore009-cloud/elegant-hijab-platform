import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Products Meta Catalog export contract", () => {
  const source = readFileSync(resolve(process.cwd(), "client/src/pages/Products.tsx"), "utf8");

  it("embeds the unified Meta workspace instead of a second export flow on the products page", () => {
    expect(source).toContain("MetaCatalogEnrichmentPanel");
    expect(source).toContain("مساحة تجهيز ومزامنة المنتجات مع Meta");
    expect(source).toContain("onOpenProduct={productId");
    expect(source).toContain("اختر المنتجات النشطة أولًا");
    expect(source).toContain("مزامنة Meta");
  });

  it("يحوّل تصدير Meta إلى مساحة عمل مستقلة قابلة للفتح من أدوات المنتجات", () => {
    expect(source).toContain("setMetaCatalogPanelOpen");
    expect(source).toContain("مساحة تجهيز ومزامنة المنتجات مع Meta");
    expect(source).not.toContain("exportMetaCatalog.mutate");
  });

  it("يعرض فلاتر حالة المزامنة مع عدّادات واضحة", () => {
    expect(source).toContain("MetaSyncFilter");
    expect(source).toContain("حالة مزامنة Meta:");
    expect(source).toContain('"لم تتم"');
    expect(source).toContain('"متأخرة"');
    expect(source).toContain("isMetaSyncStale");
  });

  it("يوفر مزامنة فورية من تفاصيل المنتج", () => {
    expect(source).toContain("syncProductNow");
    expect(source).toContain("مزامنة الآن");
    expect(source).toContain("جارٍ المزامنة...");
  });
});
