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

  it("يعرض تنبيهات حالة المزامنة مع عدّادات واضحة", () => {
    expect(source).toContain("WorkView");
    expect(source).toContain("مركز العمل");
    expect(source).toContain("مزامنة Meta متأخرة");
    expect(source).toContain("workViewCounts.metaSync");
    expect(source).toContain("workViewCounts.metaStale");
    expect(source).toContain("isMetaSyncStale");
    expect(source).toContain("metaSyncNeedsRefresh");
    expect(source).toContain("تحتاج مزامنة Meta");
  });

  it("يوفر مزامنة فورية من تفاصيل المنتج", () => {
    expect(source).toContain("syncProductNow");
    expect(source).toContain("مزامنة الآن");
    expect(source).toContain("جارٍ المزامنة...");
  });

  it("يدعم تحديد عدة منتجات من فلاتر لم تتم ومتأخرة", () => {
    expect(source).toContain("selectedMetaProductIds");
    expect(source).toContain("تحديد الكل");
    expect(source).toContain("مزامنة المحدد");
    expect(source).toContain("aria-label={`تحديد ${product.name} للمزامنة`}");
  });
});
