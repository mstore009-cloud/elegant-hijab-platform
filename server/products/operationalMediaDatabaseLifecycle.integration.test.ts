import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { catalogFolderImports, productImportJobs, productMedia, productMediaLifecycleEvents, productOperations, productVariants, products, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { detachProductMediaReference, permanentlyDeleteProduct } from "./db";

describe("التنفيذ التكاملـي لدورة حياة وسائط المنتج", () => {
  it("يفصل مرجع WebP ثم يحذف المنتج نهائيًا من قاعدة البيانات مع إبقاء سجل تدقيق مجرد", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار دورة حياة الوسائط.");
    const owner = await db.select({ id: users.id }).from(users).limit(1);
    if (!owner[0]) throw new Error("لا يوجد مستخدم مخول لاختبار دورة حياة الوسائط.");

    const productCode = `TST-WEBP-${randomUUID().slice(0, 12)}`;
    let productId: number | null = null;
    let variantId: number | null = null;
    let detachedMediaId: number | null = null;
    let purgedMediaId: number | null = null;
    let importJobId: number | null = null;

    try {
      const productResult = await db.insert(products).values({
        productCode,
        name: "منتج اختبار دورة الوسائط",
        category: "اختبار",
        description: "سجل مؤقت يُنظف داخل الاختبار.",
        status: "draft",
        sellingPrice: "1.00",
        createdByUserId: owner[0].id,
      });
      productId = Number(productResult[0].insertId);

      const variantResult = await db.insert(productVariants).values({
        productId,
        colorName: "اختبار",
        sizeLabel: "",
        inventoryQuantity: 1,
        availability: "available",
      });
      variantId = Number(variantResult[0].insertId);

      const firstMedia = await db.insert(productMedia).values({
        productId,
        variantId,
        source: "onedrive",
        mediaType: "image",
        originalUrl: "https://example.invalid/original-a.jpg",
        originalFileName: "original-a.jpg",
        storageKey: "products/test/operational/a.webp",
        operationalMetadata: JSON.stringify({ format: "webp" }),
        colorVerified: true,
      });
      detachedMediaId = Number(firstMedia[0].insertId);

      const detachResult = await detachProductMediaReference({ productId, mediaId: detachedMediaId, createdByUserId: owner[0].id });
      expect(detachResult).toEqual({ mediaId: detachedMediaId, releasedOperationalCopy: true });
      expect(await db.select().from(productMedia).where(eq(productMedia.id, detachedMediaId))).toEqual([]);

      const detachedEvents = await db.select().from(productMediaLifecycleEvents).where(and(
        eq(productMediaLifecycleEvents.productId, productId),
        eq(productMediaLifecycleEvents.mediaId, detachedMediaId),
      ));
      expect(detachedEvents).toHaveLength(1);
      expect(detachedEvents[0]).toMatchObject({ action: "reference_detached", result: "succeeded" });
      expect(Object.hasOwn(detachedEvents[0]!, "storageKey")).toBe(false);
      expect(Object.hasOwn(detachedEvents[0]!, "originalUrl")).toBe(false);

      const secondMedia = await db.insert(productMedia).values({
        productId,
        variantId,
        source: "onedrive",
        mediaType: "image",
        originalUrl: "https://example.invalid/original-b.jpg",
        originalFileName: "original-b.jpg",
        storageKey: "products/test/operational/b.webp",
        operationalMetadata: JSON.stringify({ format: "webp" }),
        colorVerified: true,
      });
      purgedMediaId = Number(secondMedia[0].insertId);

      const jobResult = await db.insert(productImportJobs).values({
        source: "onedrive",
        sourceReference: "test-lifecycle",
        status: "needs_review",
        linkedProductId: productId,
        createdByUserId: owner[0].id,
      });
      importJobId = Number(jobResult[0].insertId);
      await db.insert(productOperations).values({ productId, actorUserId: owner[0].id, source: "products_ui", action: "test_before_delete", changes: "{}" });
      await db.insert(catalogFolderImports).values({ ownerUserId: owner[0].id, productFolderId: `folder-${productCode}`, groupName: "اختبار", productCode, sourceReference: `Catalog/اختبار/${productCode}`, state: "draft_created", linkedProductId: productId, missingFields: "[]", imageCount: 2 });

      const deletion = await permanentlyDeleteProduct({ productId, expectedProductCode: productCode, createdByUserId: owner[0].id });
      expect(deletion).toEqual({ productId, releasedMediaReferences: 1, originalFilesModified: false });
      expect(await db.select().from(products).where(eq(products.id, productId))).toEqual([]);
      expect(await db.select().from(productVariants).where(eq(productVariants.productId, productId))).toEqual([]);
      expect(await db.select().from(productMedia).where(eq(productMedia.productId, productId))).toEqual([]);
      expect(await db.select().from(productOperations).where(eq(productOperations.productId, productId))).toEqual([]);

      const importJob = await db.select().from(productImportJobs).where(eq(productImportJobs.id, importJobId)).limit(1);
      expect(importJob[0]?.linkedProductId).toBeNull();
      const folder = await db.select().from(catalogFolderImports).where(eq(catalogFolderImports.productCode, productCode)).limit(1);
      expect(folder[0]).toMatchObject({ linkedProductId: null, state: "needs_review", lastError: "deleted_by_user" });

      const purgeEvents = await db.select().from(productMediaLifecycleEvents).where(and(
        eq(productMediaLifecycleEvents.productId, productId),
        eq(productMediaLifecycleEvents.mediaId, purgedMediaId),
      ));
      expect(purgeEvents[0]).toMatchObject({ action: "product_purged", result: "succeeded" });
    } finally {
      if (importJobId) await db.delete(productImportJobs).where(eq(productImportJobs.id, importJobId));
      if (productId) {
        await db.delete(productOperations).where(eq(productOperations.productId, productId));
        await db.delete(catalogFolderImports).where(eq(catalogFolderImports.productCode, productCode));
        await db.delete(productMedia).where(eq(productMedia.productId, productId));
        await db.delete(productVariants).where(eq(productVariants.productId, productId));
        await db.delete(products).where(eq(products.id, productId));
        await db.delete(productMediaLifecycleEvents).where(eq(productMediaLifecycleEvents.productId, productId));
      }
    }
  }, 20_000);

  it("يبقي مساري الفصل والحذف النهائي مستقلين تمامًا عن قارئ أو كاتب OneDrive", async () => {
    const source = await readFile(new URL("./db.ts", import.meta.url), "utf8");
    expect(source).not.toContain('integrations/onedrive/catalog');
    expect(source).not.toContain('integrations/onedrive/catalogAuth');
    expect(source).not.toContain("fetch(");
  });
});
