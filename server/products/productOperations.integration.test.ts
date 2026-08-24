import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { catalogFolderImports, productOperations, products, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { updateProductDetails } from "./db";

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
});
