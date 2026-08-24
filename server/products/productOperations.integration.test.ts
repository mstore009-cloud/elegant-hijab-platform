import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { catalogFolderImports, productMedia, productOperations, productVariants, products, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { addProductColor, applyAutomaticColorSuggestionReview, assignProductMediaColor, excludeProductMediaFromColorReview, generateAutomaticColorSuggestion, getProductReviewReadiness, getProductWithVariants, recordAutomaticColorSuggestionDecision, saveProductColorInventory, updateProductDetails } from "./db";

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
      await db.insert(productOperations).values({ productId, actorUserId: owner.id, source: "catalog_scan", action: "color_suggestions_generated", changes: JSON.stringify({ suggestion: { colorGroups: [{ colorNameArabic: "عنابي", confidence: 0.7, mediaIds: [1], reviewNote: "اقتراح سابق" }], uncertainMediaIds: [], overallReviewNote: "راجع الاقتراح السابق" } }) });
      const operation = await db.insert(productOperations).values({ productId, actorUserId: owner.id, source: "catalog_scan", action: "color_suggestions_generated", changes: JSON.stringify({ suggestion: { colorGroups: [{ colorNameArabic: "بيج", confidence: 0.9, mediaIds: [2], reviewNote: "اقتراح أحدث" }], uncertainMediaIds: [], overallReviewNote: "راجع الاقتراح الأحدث" } }) });
      const operationId = Number(operation[0].insertId);
      const pending = await getProductWithVariants(productId);
      expect(pending?.pendingColorSuggestion).toMatchObject({ operationId, suggestion: { colorGroups: [{ colorNameArabic: "بيج" }] } });
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

  it("يعتمد اسمًا وصورًا معدلة للاقتراح في عملية واحدة من دون نشر المنتج", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار تحرير اقتراح اللون.");
    const [owner] = await db.select({ id: users.id }).from(users).limit(1);
    if (!owner) throw new Error("لا يوجد مستخدم مخول لاختبار تحرير اقتراح اللون.");
    const productCode = `TST-EDIT-COLOR-${randomUUID().slice(0, 10)}`;
    let productId: number | null = null;
    try {
      const created = await db.insert(products).values({ productCode, name: "منتج اقتراح قابل للتحرير", category: "اختبار", sizeLabels: null, status: "draft", sellingPrice: "1.00", createdByUserId: owner.id });
      productId = Number(created[0].insertId);
      const first = await db.insert(productMedia).values({ productId, source: "manual", mediaType: "image", storageKey: "products/test/edit-a.webp", originalFileName: "a.webp", colorVerified: false });
      const second = await db.insert(productMedia).values({ productId, source: "manual", mediaType: "image", storageKey: "products/test/edit-b.webp", originalFileName: "b.webp", colorVerified: false });
      const mediaIds = [Number(first[0].insertId), Number(second[0].insertId)];
      const operation = await db.insert(productOperations).values({ productId, actorUserId: owner.id, source: "catalog_scan", action: "color_suggestions_generated", changes: JSON.stringify({ suggestion: { colorGroups: [{ colorNameArabic: "بني", confidence: 0.8, mediaIds: [mediaIds[0]], reviewNote: "" }, { colorNameArabic: "بيج", confidence: 0.8, mediaIds: [mediaIds[1]], reviewNote: "" }], uncertainMediaIds: [], overallReviewNote: "" } }) });
      const operationId = Number(operation[0].insertId);

      const applied = await applyAutomaticColorSuggestionReview({ productId, suggestionOperationId: operationId, groups: [{ colorName: "كراميل", mediaIds }], actorUserId: owner.id });
      expect(applied).toEqual({ success: true, colorCount: 1, mediaCount: 2 });
      const variants = await db.select().from(productVariants).where(eq(productVariants.productId, productId));
      expect(variants).toHaveLength(1);
      expect(variants[0]?.colorName).toBe("كراميل");
      const linkedMedia = await db.select().from(productMedia).where(eq(productMedia.productId, productId));
      expect(linkedMedia.every(item => item.variantId === variants[0]?.id && item.colorVerified)).toBe(true);
      const reviewed = await getProductWithVariants(productId);
      expect(reviewed?.pendingColorSuggestion).toBeNull();
      expect(reviewed?.product.status).toBe("draft");
    } finally {
      if (productId) {
        await db.delete(productOperations).where(eq(productOperations.productId, productId));
        await db.delete(productMedia).where(eq(productMedia.productId, productId));
        await db.delete(productVariants).where(eq(productVariants.productId, productId));
        await db.delete(products).where(eq(products.id, productId));
      }
    }
  }, 15_000);

  it("لا يعيد تحليل الصور المرتبطة بلون معتمد عند أي فحص لاحق", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار ثبات اللون المعتمد.");
    const [owner] = await db.select({ id: users.id }).from(users).limit(1);
    if (!owner) throw new Error("لا يوجد مستخدم مخول لاختبار ثبات اللون المعتمد.");
    const productCode = `TST-LOCKED-COLOR-${randomUUID().slice(0, 10)}`;
    let productId: number | null = null;
    try {
      const created = await db.insert(products).values({ productCode, name: "منتج لون معتمد", category: "اختبار", sizeLabels: null, status: "draft", sellingPrice: "1.00", createdByUserId: owner.id });
      productId = Number(created[0].insertId);
      const media = await db.insert(productMedia).values({ productId, source: "manual", mediaType: "image", storageKey: "products/test/locked.webp", originalFileName: "locked.webp", colorVerified: false });
      const mediaId = Number(media[0].insertId);
      await addProductColor({ productId, colorName: "كحلي", actorUserId: owner.id, source: "products_ui" });
      await assignProductMediaColor({ productId, mediaId, colorName: "كحلي", actorUserId: owner.id });

      expect(await generateAutomaticColorSuggestion({ productId, actorUserId: owner.id })).toBeNull();
      const generated = await db.select().from(productOperations).where(and(eq(productOperations.productId, productId), eq(productOperations.action, "color_suggestions_generated")));
      expect(generated).toEqual([]);
    } finally {
      if (productId) {
        await db.delete(productOperations).where(eq(productOperations.productId, productId));
        await db.delete(productMedia).where(eq(productMedia.productId, productId));
        await db.delete(productVariants).where(eq(productVariants.productId, productId));
        await db.delete(products).where(eq(products.id, productId));
      }
    }
  }, 15_000);

  it("لا يصبح المنتج جاهزًا للمراجعة قبل حسم كل الصور وحفظ كمية كل لون، ويعود للمراجعة عند إضافة صورة", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار جاهزية المنتج.");
    const [owner] = await db.select({ id: users.id }).from(users).limit(1);
    if (!owner) throw new Error("لا يوجد مستخدم مخول لاختبار جاهزية المنتج.");
    const productCode = `TST-READY-${randomUUID().slice(0, 10)}`;
    let productId: number | null = null;
    try {
      const created = await db.insert(products).values({ productCode, name: "منتج جاهز للمراجعة", category: "اختبار", description: "وصف", sizeLabels: null, status: "draft", sellingPrice: "10000.00", createdByUserId: owner.id });
      productId = Number(created[0].insertId);
      const media = await db.insert(productMedia).values({ productId, source: "manual", mediaType: "image", storageKey: `products/test/${productCode}.webp`, originalFileName: "ready.webp", colorVerified: false });
      const mediaId = Number(media[0].insertId);
      expect((await getProductReviewReadiness(productId)).ready).toBe(false);
      await addProductColor({ productId, colorName: "عنابي", actorUserId: owner.id });
      await assignProductMediaColor({ productId, mediaId, colorName: "عنابي", actorUserId: owner.id });
      expect((await getProductReviewReadiness(productId)).reasons).toContain("لم تحفظ كمية اللون: عنابي");
      await saveProductColorInventory({ productId, colorName: "عنابي", inventoryQuantity: 5, actorUserId: owner.id });
      expect(await getProductReviewReadiness(productId)).toEqual({ ready: true, reasons: [] });
      const [readyProduct] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
      expect(readyProduct?.status).toBe("ready");
      await db.insert(productMedia).values({ productId, source: "manual", mediaType: "image", storageKey: `products/test/${productCode}-new.webp`, originalFileName: "new.webp", colorVerified: false });
      await assignProductMediaColor({ productId, mediaId, colorName: "عنابي", actorUserId: owner.id });
      const [needsReview] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
      expect(needsReview?.status).toBe("needs_review");
    } finally {
      if (productId) {
        await db.delete(productOperations).where(eq(productOperations.productId, productId));
        await db.delete(productMedia).where(eq(productMedia.productId, productId));
        await db.delete(productVariants).where(eq(productVariants.productId, productId));
        await db.delete(products).where(eq(products.id, productId));
      }
    }
  }, 20_000);
});
