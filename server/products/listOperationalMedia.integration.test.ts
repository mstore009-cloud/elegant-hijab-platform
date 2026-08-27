import { describe, expect, it } from "vitest";
import { getPublicStore } from "../stores/db";
import { listProductsWithPrimaryOperationalMedia } from "./db";

describe("قائمة المنتجات مع المصغرة التشغيلية", () => {
  it("تعيد مرجع مصغرة تشغيلية لـ HJB-TEST-001", async () => {
    const store = await getPublicStore();
    if (!store) throw new Error("لا يوجد متجر افتراضي لاختبار المصغرة التشغيلية.");
    const products = await listProductsWithPrimaryOperationalMedia(store.id);
    const testedProduct = products.find(item => item.product.productCode === "HJB-TEST-001");

    expect(testedProduct).toBeDefined();
    expect(testedProduct?.primaryMedia?.storageKey).toBeTruthy();
  }, 15_000);
});
