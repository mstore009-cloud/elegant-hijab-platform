import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("مساحة عمل Meta Catalog", () => {
  it("تعرض المنتجات النشطة فقط باختيار مباشر وفحص وتجهيز ومراجعة واضحة", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/components/MetaCatalogWorkspace.tsx"), "utf8");
    expect(source).toContain("trpc.metaCatalog.workspaceProducts.useQuery");
    expect(source).toContain("المنتجات النشطة");
    expect(source).toContain("تحديد الكل");
    expect(source).not.toContain("قسم من OneDrive");
    expect(source).toContain("productIds: selectedIds");
    expect(source).toContain("جهّز الوسائط وراجع");
    expect(source).toContain("إصلاح المنتج");
    expect(source).toContain("تصدير ${readyCount} منتج جاهز إلى Meta");
    expect(source).toContain("window.confirm");
    expect(source).toContain("الاسم الرئيسي يبقى اسم المنتج");
    expect(source).toContain("سيُرسل {report?.imageCount ?? 0} صور");
    expect(source).toContain("report?.primaryImageUrl");
  });
});
