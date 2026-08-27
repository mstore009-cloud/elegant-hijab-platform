import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("../storage", () => ({
  storagePut: vi.fn(async (key: string) => ({ key, url: `/manus-storage/${key}` })),
}));

import { productMedia, productOperations, products, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { getPublicStore } from "../stores/db";
import { addManualProductImage } from "./db";

describe("رفع صورة منتج يدويًا", () => {
  it("يحفظ WebP تشغيلية ومرجعًا يدويًا وسجل عملية من دون أي اعتماد على OneDrive", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار رفع الصورة اليدوية.");
    const [owner] = await db.select({ id: users.id }).from(users).limit(1);
    if (!owner) throw new Error("لا يوجد مستخدم مخول لاختبار رفع الصورة اليدوية.");
    const store = await getPublicStore();
    if (!store) throw new Error("لا يوجد متجر افتراضي لاختبار رفع الصورة اليدوية.");

    const productCode = `TST-MANUAL-${randomUUID().slice(0, 10)}`;
    let productId: number | null = null;
    try {
      const created = await db.insert(products).values({
        storeId: store.id,
        productCode,
        name: "منتج اختبار رفع يدوي",
        category: "اختبار",
        status: "draft",
        sellingPrice: "1000",
        createdByUserId: owner.id,
      });
      productId = Number(created[0].insertId);
      const onePixelPng = await sharp({
        create: { width: 1, height: 1, channels: 3, background: { r: 128, g: 32, b: 64 } },
      }).png().toBuffer();

      const uploaded = await addManualProductImage({
        productId,
        fileName: "manual-source.png",
        bytes: onePixelPng,
        actorUserId: owner.id,
      });

      expect(uploaded.format).toBe("webp");
      expect(uploaded.storageKey).toContain(`products/${productId}/manual/`);
      const [media] = await db.select().from(productMedia).where(eq(productMedia.id, uploaded.mediaId)).limit(1);
      expect(media).toMatchObject({
        productId,
        source: "manual",
        mediaType: "image",
        originalUrl: null,
        originalFileName: "manual-source.png",
        storageKey: uploaded.storageKey,
      });
      expect(JSON.parse(media!.operationalMetadata ?? "{}")).toMatchObject({ source: "manual_product_upload" });
      const [operation] = await db.select().from(productOperations).where(and(eq(productOperations.productId, productId), eq(productOperations.action, "manual_image_added"))).limit(1);
      expect(operation).toMatchObject({ source: "products_ui", actorUserId: owner.id });
    } finally {
      if (productId) {
        await db.delete(productOperations).where(eq(productOperations.productId, productId));
        await db.delete(productMedia).where(eq(productMedia.productId, productId));
        await db.delete(products).where(eq(products.id, productId));
      }
    }
  }, 15_000);
});
