import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { catalogFolderImports, productMedia, productOperations, productVariants, products, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { addProductColor, assignProductMediaColor, renameProductColor, saveProductColorInventory, saveProductInventory } from "./db";

describe("تدفق اللون والمخزون", () => {
  it("يعتمد لونًا ويربط صورته ويحفظ مخزون القياسات من دون نشر المسودة", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار اللون والمخزون.");
    const [owner] = await db.select({ id: users.id }).from(users).limit(1);
    if (!owner) throw new Error("لا يوجد مستخدم مخول للاختبار.");
    const productCode = `TST-COLOR-${randomUUID().slice(0, 10)}`;
    let productId: number | null = null;
    try {
      const created = await db.insert(products).values({ productCode, name: "منتج لون تجريبي", category: "اختبار", sizeLabels: JSON.stringify(["Medium", "Large"]), status: "draft", sellingPrice: "8500.00", createdByUserId: owner.id });
      productId = Number(created[0].insertId);
      await db.insert(catalogFolderImports).values({ ownerUserId: owner.id, productFolderId: `folder-${productCode}`, groupName: "اختبار", productCode, sourceReference: `Catalog/اختبار/${productCode}`, state: "draft_created", linkedProductId: productId, missingFields: JSON.stringify(["colors", "inventory"]), imageCount: 1 });
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
      expect(product?.status).toBe("draft");
      const [folder] = await db.select().from(catalogFolderImports).where(eq(catalogFolderImports.linkedProductId, productId)).limit(1);
      expect(JSON.parse(folder?.missingFields ?? "[]")).not.toContain("colors");
      expect(JSON.parse(folder?.missingFields ?? "[]")).not.toContain("inventory");
      const actions = await db.select({ action: productOperations.action }).from(productOperations).where(eq(productOperations.productId, productId));
      expect(actions.map(row => row.action)).toEqual(expect.arrayContaining(["color_added", "media_color_assigned", "inventory_saved", "color_inventory_saved", "color_renamed"]));
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
});
