import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { productImportJobs, productMedia, productVariants, products, stores, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { createCatalogDraftProduct } from "./db";

describe("إنشاء مسودة Catalog", () => {
  it("ينشئ مسودة فقط بلا ألوان أو مخزون أو وسائط ويمنع التكرار", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار مسودة Catalog.");
    const owner = await db.select({ id: users.id }).from(users).limit(1);
    if (!owner[0]) throw new Error("لا يوجد مستخدم مخول لاختبار مسودة Catalog.");
    const store = await db.select({ id: stores.id }).from(stores).where(eq(stores.slug, "elegant-hijab")).limit(1);
    if (!store[0]) throw new Error("لا يوجد متجر افتراضي لاختبار مسودة Catalog.");
    const productCode = `TST-CAT-${randomUUID().slice(0, 12)}`;
    let productId: number | null = null;

    try {
      const first = await createCatalogDraftProduct({
        storeId: store[0].id,
        productCode,
        name: "مسودة اختبار Catalog",
        category: "اختبار",
        description: "تتحقق هذه المسودة من الحواجز فقط.",
        sellingPrice: "8000",
        previousPrice: "10000",
        sourceReference: `Catalog/اختبار/${productCode}`,
        createdByUserId: owner[0].id,
      });
      productId = first.productId;
      expect(first.created).toBe(true);

      const createdProduct = await db.select().from(products).where(eq(products.id, productId)).limit(1);
      expect(createdProduct[0]).toMatchObject({ storeId: store[0].id, productCode, status: "draft", category: "اختبار", sellingPrice: "8000.00", previousPrice: "10000.00" });
      expect(await db.select().from(productVariants).where(eq(productVariants.productId, productId))).toEqual([]);
      expect(await db.select().from(productMedia).where(eq(productMedia.productId, productId))).toEqual([]);
      const importJob = await db.select().from(productImportJobs).where(eq(productImportJobs.linkedProductId, productId)).limit(1);
      expect(importJob[0]).toMatchObject({ source: "onedrive", status: "needs_review" });

      const duplicate = await createCatalogDraftProduct({
        storeId: store[0].id,
        productCode,
        name: "اسم لا يجب حفظه",
        category: "اختبار",
        description: "لا يجب تعديل المسودة الأصلية.",
        sellingPrice: "1",
        sourceReference: `Catalog/اختبار/${productCode}`,
        createdByUserId: owner[0].id,
      });
      expect(duplicate).toEqual({ productId, jobId: null, created: false });
    } finally {
      if (productId) {
        await db.delete(productImportJobs).where(eq(productImportJobs.linkedProductId, productId));
        await db.delete(productMedia).where(eq(productMedia.productId, productId));
        await db.delete(productVariants).where(eq(productVariants.productId, productId));
        await db.delete(products).where(eq(products.id, productId));
      }
    }
  }, 15_000);
});
