import { describe, expect, it } from "vitest";
import { listProductsWithPrimaryOperationalMedia } from "./db";

describe("قائمة المنتجات مع المصغرة التشغيلية", () => {
  it("تعيد مرجع مصغرة تشغيلية لـ HJB-TEST-001", async () => {
    const products = await listProductsWithPrimaryOperationalMedia();
    const testedProduct = products.find(item => item.product.productCode === "HJB-TEST-001");

    expect(testedProduct).toBeDefined();
    expect(testedProduct?.primaryMedia?.storageKey).toBeTruthy();
  }, 15_000);
});
