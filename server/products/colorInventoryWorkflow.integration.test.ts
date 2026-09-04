import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { catalogFolderImports, productMedia, productOperations, productVariants, products, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { getPublicStore } from "../stores/db";
import { addProductColor, assignProductMediaColor, deleteProductColor, getProductMedia, getProductWithVariants, renameProductColor, saveProductColorInventory, saveProductInventory } from "./db";

describe("تدفق اللون والمخزون", () => {
  it("يعتمد لونًا ويربط صورته ويحفظ مخزون القياسات فيجعل المنتج جاهزًا للمراجعة من دون نشره", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار اللون والمخزون.");
    const [owner] = await db.select({ id: users.id }).from(users).limit(1);
    if (!owner) throw new Error("لا يوجد مستخدم مخول للاختبار.");
    const store = await getPublicStore();
    if (!store) throw new Error("لا يوجد متجر افتراضي للاختبار.");
    const productCode = `TST-COLOR-${randomUUID().slice(0, 10)}`;
    let productId: number | null = null;
    try {
      const created = await db.insert(products).values({ storeId: store.id, productCode, name: "منتج لون تجريبي", category: "اختبار", sizeLabels: JSON.stringify(["Medium", "Large"]), status: "draft", sellingPrice: "8500.00", createdByUserId: owner.id });
      productId = Number(created[0].insertId);
      await db.insert(catalogFolderImports).values({ storeId: store.id, ownerUserId: owner.id, productFolderId: `folder-${productCode}`, groupName: "اختبار", productCode, sourceReference: `Catalog/اختبار/${productCode}`, state: "draft_created", linkedProductId: productId, missingFields: JSON.stringify(["colors", "inventory"]), imageCount: 1 });
      const mediaResult = await db.insert(productMedia).values({ productId, source: "manual", mediaType: "image", storageKey: "products/test/color.webp", originalFileName: "color.webp", colorVerified: false });
      const mediaId = Number(mediaResult[0].insertId);

      const color = await addProductColor({ productId, colorName: "عنابي", actorUserId: owner.id });
      expect(color.created).toBe(true);
      expect(color.variants.map(variant => variant.sizeLabel).sort()).toEqual(["Large", "Medium"]);
      await assignProductMediaColor({ productId, mediaId, colorName: "عنابي", actorUserId: owner.id });
      await saveProductInventory({ productId, actorUserId: owner.id, quantities: color.variants.map((variant, index) => ({ variantId: variant.id, inventoryQuantity: index === 0 ? 4 : 2 })) });

      await saveProductColorInventory({ productId, colorName: "عنابي", inventoryQuantity: 6, actorUserId: owner.id });
      await renameProductColor({ productId, previousColorName: "عنابي", colorName: "نبيذي", actorUserId: owner.id });

      const variants = await db.select().from(productVariants).where(eq(productVariants.productId, productId));
      expect(variants.map(variant => variant.inventoryQuantity).sort()).toEqual([6, 6]);
      expect(variants.map(variant => variant.colorName)).toEqual(["نبيذي", "نبيذي"]);
      const [media] = await db.select().from(productMedia).where(eq(productMedia.id, mediaId)).limit(1);
      expect(media?.colorVerified).toBe(true);
      expect(color.variants.map(variant => variant.id)).toContain(media?.variantId);
      const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
      expect(product?.status).toBe("ready");
      const [folder] = await db.select().from(catalogFolderImports).where(eq(catalogFolderImports.linkedProductId, productId)).limit(1);
      expect(JSON.parse(folder?.missingFields ?? "[]")).not.toContain("colors");
      expect(JSON.parse(folder?.missingFields ?? "[]")).not.toContain("inventory");
      const actions = await db.select({ action: productOperations.action }).from(productOperations).where(eq(productOperations.productId, productId));
      expect(actions.map(row => row.action)).toEqual(expect.arrayContaining(["color_added", "media_color_assigned", "inventory_saved", "color_inventory_saved", "color_renamed"]));

      const deleted = await deleteProductColor({ productId, colorName: "نبيذي", actorUserId: owner.id });
      expect(deleted).toEqual({ colorName: "نبيذي", deletedVariantCount: 2, deletedMediaCount: 1, originalFilesModified: false });
      expect(await db.select().from(productVariants).where(eq(productVariants.productId, productId))).toEqual([]);
      expect(await db.select().from(productMedia).where(eq(productMedia.productId, productId))).toEqual([]);
      const actionsAfterDelete = await db.select({ action: productOperations.action }).from(productOperations).where(eq(productOperations.productId, productId));
      expect(actionsAfterDelete.map(row => row.action)).toContain("color_deleted");
    } finally {
      if (productId) {
        await db.delete(productOperations).where(eq(productOperations.productId, productId));
        await db.delete(productMedia).where(eq(productMedia.productId, productId));
        await db.delete(productVariants).where(eq(productVariants.productId, productId));
        await db.delete(catalogFolderImports).where(eq(catalogFolderImports.linkedProductId, productId));
        await db.delete(products).where(eq(products.id, productId));
      }
    }
  }, 15_000);

  it("يحفظ ويرجع ترتيب الوسائط لكل متغير مع فصل اللون والقياس والمخزون", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار ترتيب الوسائط.");
    const [owner] = await db.select({ id: users.id }).from(users).limit(1);
    const store = await getPublicStore();
    if (!owner || !store) throw new Error("لا يوجد سياق متجر للاختبار.");
    const productCode = `TST-MEDIA-ORDER-${randomUUID().slice(0, 10)}`;
    let productId: number | null = null;
    try {
      const created = await db.insert(products).values({ storeId: store.id, productCode, name: "منتج متغيرات مرتبة", category: "اختبار", sizeLabels: JSON.stringify(["Medium", "Large"]), status: "draft", sellingPrice: "12000.00", createdByUserId: owner.id });
      productId = Number(created[0].insertId);
      const variantInsert = await db.insert(productVariants).values([
        { productId, colorName: "عنابي", sizeLabel: "Medium", inventoryQuantity: 3, availability: "available", sortOrder: 0 },
        { productId, colorName: "عنابي", sizeLabel: "Large", inventoryQuantity: 7, availability: "available", sortOrder: 1 },
        { productId, colorName: "زيتي", sizeLabel: "Medium", inventoryQuantity: 2, availability: "available", sortOrder: 2 },
      ]);
      const firstVariantId = Number(variantInsert[0].insertId);
      const secondVariantId = firstVariantId + 1;
      const thirdVariantId = firstVariantId + 2;
      await db.insert(productMedia).values([
        { productId, variantId: firstVariantId, source: "manual", mediaType: "image", storageKey: "products/order-2.webp", originalFileName: "order-2.webp", colorVerified: true, sortOrder: 2 },
        { productId, variantId: firstVariantId, source: "manual", mediaType: "image", storageKey: "products/order-1.webp", originalFileName: "order-1.webp", colorVerified: true, sortOrder: 1 },
        { productId, variantId: secondVariantId, source: "manual", mediaType: "image", storageKey: "products/large.webp", originalFileName: "large.webp", colorVerified: true, sortOrder: 0 },
        { productId, variantId: thirdVariantId, source: "manual", mediaType: "image", storageKey: "products/olive.webp", originalFileName: "olive.webp", colorVerified: true, sortOrder: 0 },
      ]);
      const variants = await getProductWithVariants(productId);
      expect(variants?.variants.map(item => `${item.colorName}:${item.sizeLabel}:${item.inventoryQuantity}`)).toEqual(["عنابي:Medium:3", "عنابي:Large:7", "زيتي:Medium:2"]);
      const media = await getProductMedia(productId);
      expect(media.filter(item => item.variantId === firstVariantId).map(item => `${item.originalFileName}:${item.sortOrder}`)).toEqual(["order-1.webp:1", "order-2.webp:2"]);
      expect(media.filter(item => item.variantId === secondVariantId).map(item => item.originalFileName)).toEqual(["large.webp"]);
      expect(media.filter(item => item.variantId === thirdVariantId).map(item => item.originalFileName)).toEqual(["olive.webp"]);
    } finally {
      if (productId) {
        await db.delete(productMedia).where(eq(productMedia.productId, productId));
        await db.delete(productVariants).where(eq(productVariants.productId, productId));
        await db.delete(products).where(eq(products.id, productId));
      }
    }
  }, 15_000);
});
