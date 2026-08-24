import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { catalogFolderImports, productMedia, productOperations, products, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { excludeProductMediaFromColorReview, getProductWithVariants, recordAutomaticColorSuggestionDecision, updateProductDetails } from "./db";

describe("عمليات المنتج الموحدة", () => {
  it("يكمل حقول المسودة ويسجل التعديل بصيغة يمكن لواجهة المنتجات وWhatsApp مشاركتها", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار عمليات المنتج.");
    const [owner] = await db.select({ id: users.id }).from(users).limit(1);
    if (!owner) throw new Error("لا يوجد مستخدم مخول لاختبار عمليات المنتج.");
    const productCode = `TST-OPS-${randomUUID().slice(0, 10)}`;
    let productId: number | null = null;
    try {
      const created = await db.insert(products).values({ productCode, name: "منتج يحتاج بيانات", category: "اختبار", description: null, sizeLabels: null, status: "draft", sellingPrice: "0.00", createdByUserId: owner.id });
      productId = Number(created[0].insertId);
      await db.insert(catalogFolderImports).values({ ownerUserId: owner.id, productFolderId: `folder-${productCode}`, groupName: "اختبار", productCode, sourceReference: `Catalog/اختبار/${productCode}`, state: "draft_created", linkedProductId: productId, missingFields: JSON.stringify(["description", "sellingPrice", "sizes"]), imageCount: 0 });
      const result = await updateProductDetails({ productId, description: "وصف مكتمل", sellingPrice: "12000", sizeLabels: ["Medium", "Large"], actorUserId: owner.id, source: "products_ui" });
      expect(result.missingFields).toEqual([]);
      expect(result.product).toMatchObject({ description: "وصف مكتمل", sellingPrice: "12000.00", sizeLabels: JSON.stringify(["Medium", "Large"]) });
      const [audit] = await db.select().from(productOperations).where(and(eq(productOperations.productId, productId), eq(productOperations.action, "details_updated"))).limit(1);
      expect(audit).toMatchObject({ source: "products_ui", actorUserId: owner.id });
      const [folder] = await db.select().from(catalogFolderImports).where(eq(catalogFolderImports.linkedProductId, productId)).limit(1);
      expect(folder?.missingFields).toBe("[]");
    } finally {
      if (productId) {
        await db.delete(productOperations).where(eq(productOperations.productId, productId));
        await db.delete(catalogFolderImports).where(eq(catalogFolderImports.linkedProductId, productId));
        await db.delete(products).where(eq(products.id, productId));
      }
    }
  }, 15_000);

  it("يستبعد الصورة من مراجعة اللون بلا حذف أو ربط لون أو نشر", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار استبعاد مراجعة اللون.");
    const [owner] = await db.select({ id: users.id }).from(users).limit(1);
    if (!owner) throw new Error("لا يوجد مستخدم مخول لاختبار استبعاد مراجعة اللون.");
    const productCode = `TST-EXCLUDE-${randomUUID().slice(0, 10)}`;
    let productId: number | null = null;
    let mediaId: number | null = null;
    try {
      const created = await db.insert(products).values({ productCode, name: "منتج صورة غير مؤكدة", category: "اختبار", description: null, sizeLabels: null, status: "draft", sellingPrice: "0.00", createdByUserId: owner.id });
      productId = Number(created[0].insertId);
      const media = await db.insert(productMedia).values({ productId, source: "manual", mediaType: "image", originalUrl: null, storageKey: `test/${productCode}.webp`, originalFileName: "test.webp", colorVerified: false, sortOrder: 0 });
      mediaId = Number(media[0].insertId);
      const result = await excludeProductMediaFromColorReview({ productId, mediaIds: [mediaId], actorUserId: owner.id });
      expect(result.excludedMediaIds).toEqual([mediaId]);
      const [storedMedia] = await db.select().from(productMedia).where(eq(productMedia.id, mediaId)).limit(1);
      expect(storedMedia).toMatchObject({ id: mediaId, productId, variantId: null, colorVerified: true });
      const [storedProduct] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
      expect(storedProduct?.status).toBe("draft");
      const [audit] = await db.select().from(productOperations).where(and(eq(productOperations.productId, productId), eq(productOperations.action, "media_color_review_excluded"))).limit(1);
      expect(audit).toMatchObject({ actorUserId: owner.id, source: "products_ui" });
    } finally {
      if (productId) {
        await db.delete(productOperations).where(eq(productOperations.productId, productId));
        if (mediaId) await db.delete(productMedia).where(eq(productMedia.id, mediaId));
        await db.delete(products).where(eq(products.id, productId));
      }
    }
  }, 15_000);

  it("يعرض اقتراح اللون التلقائي للمراجعة ثم يخفيه بعد رفض الموظف من دون إنشاء لون", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار اقتراح اللون التلقائي.");
    const [owner] = await db.select({ id: users.id }).from(users).limit(1);
    if (!owner) throw new Error("لا يوجد مستخدم مخول لاختبار اقتراح اللون التلقائي.");
    const productCode = `TST-AUTO-COLOR-${randomUUID().slice(0, 10)}`;
    let productId: number | null = null;
    try {
      const created = await db.insert(products).values({ productCode, name: "منتج اقتراح تلقائي", category: "اختبار", description: null, sizeLabels: null, status: "draft", sellingPrice: "0.00", createdByUserId: owner.id });
      productId = Number(created[0].insertId);
      const operation = await db.insert(productOperations).values({ productId, actorUserId: owner.id, source: "catalog_scan", action: "color_suggestions_generated", changes: JSON.stringify({ suggestion: { colorGroups: [{ colorNameArabic: "عنابي", confidence: 0.7, mediaIds: [1], reviewNote: "اقتراح تلقائي" }], uncertainMediaIds: [], overallReviewNote: "راجع الاقتراح" } }) });
      const operationId = Number(operation[0].insertId);
      const pending = await getProductWithVariants(productId);
      expect(pending?.pendingColorSuggestion).toMatchObject({ operationId, suggestion: { colorGroups: [{ colorNameArabic: "عنابي" }] } });
      expect(pending?.variants).toHaveLength(0);
      await recordAutomaticColorSuggestionDecision({ productId, suggestionOperationId: operationId, decision: "rejected", actorUserId: owner.id });
      const reviewed = await getProductWithVariants(productId);
      expect(reviewed?.pendingColorSuggestion).toBeNull();
      expect(reviewed?.variants).toHaveLength(0);
      expect(reviewed?.product.status).toBe("draft");
    } finally {
      if (productId) {
        await db.delete(productOperations).where(eq(productOperations.productId, productId));
        await db.delete(products).where(eq(products.id, productId));
      }
    }
  }, 15_000);
});
