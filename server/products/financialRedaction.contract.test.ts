import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../routers/products.ts", import.meta.url), "utf8");

describe("طبقة حجب المالية في Router المنتجات", () => {
  it("يمرر list وbyId عبر presentProductForViewer", () => {
    expect(source).toContain("...presentProductForViewer(product, canViewFinancials)");
    expect(source).toContain("product: presentProductForViewer(item.product, canViewFinancials)");
  });

  it("يحافظ على أن publicList وpublicByCode يعيدان حقول العرض العامة فقط", () => {
    const publicSection = source.slice(source.indexOf("publicList:"), source.indexOf("list: protectedProcedure"));
    expect(publicSection).not.toContain("costPrice");
    expect(publicSection).not.toContain("targetMarginPercent");
    expect(publicSection).toContain("sellingPrice");
    expect(publicSection).toContain("publicByCode:");
  });

  it("لا يعيد create أو إجراءات التعديل حقول المالية في نتائجها التشغيلية", () => {
    const createSection = source.slice(source.indexOf("create: protectedProcedure"), source.indexOf("updateInventory: protectedProcedure"));
    expect(createSection).toContain("return { productId }");
    expect(createSection).not.toContain("return { ...input");
  });
});
