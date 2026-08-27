import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { products, users } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import { getDb } from "../db";
import { appRouter } from "../routers";
import { getPublicStore } from "../stores/db";

describe("قائمة المنتجات بلا وسائط", () => {
  it("تعيد primaryImageUrl فارغًا لمنتج لا يملك أي مرجع أو نسخة تشغيلية", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار المنتج بلا وسائط.");
    const owner = await db.select().from(users).limit(1);
    if (!owner[0]) throw new Error("لا يوجد مستخدم مخول لاختبار المنتج بلا وسائط.");
    const store = await getPublicStore();
    if (!store) throw new Error("لا يوجد متجر افتراضي لاختبار المنتج بلا وسائط.");
    const productCode = `TST-NOMEDIA-${randomUUID().slice(0, 12)}`;
    let productId: number | null = null;

    try {
      const created = await db.insert(products).values({
        storeId: store.id,
        productCode,
        name: "منتج اختبار بلا وسائط",
        category: "اختبار",
        description: "هذا السجل مؤقت وينظف بعد الاختبار.",
        status: "draft",
        sellingPrice: "1.00",
        createdByUserId: owner[0].id,
      });
      productId = Number(created[0].insertId);

      const ctx: TrpcContext = {
        user: { ...owner[0], role: "admin" },
        operationalStore: store,
        req: { protocol: "https", headers: {} } as TrpcContext["req"],
        res: {} as TrpcContext["res"],
      };
      const results = await appRouter.createCaller(ctx).products.list();
      const testedProduct = results.find(product => product.productCode === productCode);

      expect(testedProduct).toBeDefined();
      expect(testedProduct?.primaryImageUrl).toBeNull();
      expect(testedProduct?.primaryImageAlt).toBeNull();
    } finally {
      if (productId) await db.delete(products).where(eq(products.id, productId));
    }
  }, 15_000);
});
