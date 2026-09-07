import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("مساحة عمل Meta Catalog", () => {
  it("تبدأ باختيار نطاق صريح وتعرض إجراءات الإكمال والتجهيز والمراجعة", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/components/MetaCatalogWorkspace.tsx"), "utf8");
    expect(source).toContain("trpc.metaCatalog.workspaceProducts.useQuery");
    expect(source).toContain('"كل المنتجات النشطة"');
    expect(source).toContain('"قسم من OneDrive"');
    expect(source).toContain('"اختيار يدوي"');
    expect(source).toContain("productIds: selectedIds");
    expect(source).toContain("فحص وتجهيز المنتجات المحددة");
    expect(source).toContain("إصلاح المنتج");
    expect(source).toContain("تصدير ${readyCount} منتج جاهز إلى Meta");
    expect(source).toContain("window.confirm");
    expect(source).toContain("تحديثات من OneDrive بانتظار المراجعة");
    expect(source).toContain("مراجعة هذا التحديث");
    expect(source).toContain("لن تُحذف أي صورة أو بيانات من Meta");
  });
});
