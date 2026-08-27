import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { productFinancialChangeEvents, products, stores, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { getProductFinancialDetail, listFinancialProducts, updateProductFinancials } from "./db";

describe("Cost-Control-A", () => {
  it("يسجل تغيير التكلفة والهامش داخل متجر المنتج من دون تغيير سعر البيع أو كشفه في متجر آخر", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار التكلفة الحساسة.");

    const suffix = randomUUID().slice(0, 10);
    let userId: number | undefined;
    let primaryStoreId: number | undefined;
    let otherStoreId: number | undefined;
    let productId: number | undefined;
    let otherProductId: number | undefined;

    try {
      const userInsert = await db.insert(users).values({ openId: `financials-${suffix}`, name: "مدير اختبار التكلفة", role: "admin" });
      userId = Number(userInsert[0].insertId);
      const primaryStore = await db.insert(stores).values({ name: "متجر تكلفة أساسي", slug: `fin-a-${suffix}`, status: "active", primaryOwnerUserId: userId });
      primaryStoreId = Number(primaryStore[0].insertId);
      const otherStore = await db.insert(stores).values({ name: "متجر تكلفة ثانٍ", slug: `fin-b-${suffix}`, status: "active", primaryOwnerUserId: userId });
      otherStoreId = Number(otherStore[0].insertId);

      const primaryProduct = await db.insert(products).values({
        storeId: primaryStoreId,
        productCode: `FIN-A-${suffix}`,
        name: "منتج تكلفة أساسي",
        category: "اختبار",
        status: "draft",
        sellingPrice: "25000.00",
        costPrice: "12000.00",
        targetMarginPercent: "35.00",
        createdByUserId: userId,
      });
      productId = Number(primaryProduct[0].insertId);
      const otherProduct = await db.insert(products).values({
        storeId: otherStoreId,
        productCode: `FIN-B-${suffix}`,
        name: "منتج متجر ثانٍ",
        category: "اختبار",
        status: "draft",
        sellingPrice: "50000.00",
        costPrice: "22000.00",
        createdByUserId: userId,
      });
      otherProductId = Number(otherProduct[0].insertId);

      const changed = await updateProductFinancials({
        storeId: primaryStoreId,
        productId,
        actorUserId: userId,
        costPrice: "13500.00",
        targetMarginPercent: "42.50",
        reason: "تحديث تكلفة المورد المعتمدة",
      });
      expect(changed).toMatchObject({ productId, sellingPrice: "25000.00", costPrice: "13500.00", targetMarginPercent: "42.50" });

      const detail = await getProductFinancialDetail({ storeId: primaryStoreId, productId });
      expect(detail.product).toMatchObject({ sellingPrice: "25000.00", costPrice: "13500.00", targetMarginPercent: "42.50" });
      expect(detail.changes[0]).toMatchObject({ priorCostPrice: "12000.00", nextCostPrice: "13500.00", priorTargetMarginPercent: "35.00", nextTargetMarginPercent: "42.50", actorUserId: userId });

      const otherStoreList = await listFinancialProducts(otherStoreId);
      expect(otherStoreList.some(item => item.id === productId)).toBe(false);
      await expect(getProductFinancialDetail({ storeId: otherStoreId, productId })).rejects.toThrow("المنتج غير موجود في متجرك التشغيلي");
    } finally {
      if (productId && primaryStoreId) await db.delete(productFinancialChangeEvents).where(and(eq(productFinancialChangeEvents.productId, productId), eq(productFinancialChangeEvents.storeId, primaryStoreId)));
      if (otherProductId && otherStoreId) await db.delete(productFinancialChangeEvents).where(and(eq(productFinancialChangeEvents.productId, otherProductId), eq(productFinancialChangeEvents.storeId, otherStoreId)));
      if (productId) await db.delete(products).where(eq(products.id, productId));
      if (otherProductId) await db.delete(products).where(eq(products.id, otherProductId));
      if (primaryStoreId) await db.delete(stores).where(eq(stores.id, primaryStoreId));
      if (otherStoreId) await db.delete(stores).where(eq(stores.id, otherStoreId));
      if (userId) await db.delete(users).where(eq(users.id, userId));
    }
  }, 20_000);
});
