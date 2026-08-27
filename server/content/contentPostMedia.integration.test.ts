import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../storage", () => ({
  storageGetSignedUrl: vi.fn(async () => "https://storage.example.test/original"),
  storagePut: vi.fn(async () => ({ key: "products/test/copied-image.webp", url: "/manus-storage/products/test/copied-image.webp" })),
}));
vi.mock("../integrations/onedrive/operationalMedia", () => ({
  createOperationalImageDerivative: vi.fn(async () => ({ bytes: Buffer.from("webp"), metadata: { format: "webp", outputBytes: 4 } })),
}));

import { contentPostMedia, contentPosts, productMedia, products, stores, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { attachContentPostMediaToProduct, createContentPostDraft, getContentPostDraft, saveContentPostMedia } from "./db";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.clearAllMocks();
});

describe("وسيط المنشور الاختياري للمنتج", () => {
  it("يبقى داخل المنشور افتراضيًا ولا يظهر في المنتج إلا بعد اختيار الإضافة الصريح", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار وسائط المنشور.");
    const [owner] = await db.select().from(users).limit(1);
    if (!owner) throw new Error("لا يوجد مستخدم مخول لاختبار وسائط المنشور.");
    const productCode = `TST-POST-${randomUUID().slice(0, 12)}`;
    let productId: number | null = null;
    let postId: number | null = null;
    let postMediaId: number | null = null;
    let linkedProductMediaId: number | null = null;
    let storeId: number | null = null;
    let otherStoreId: number | null = null;

    try {
      const store = await db.insert(stores).values({ name: "متجر اختبار المحتوى", slug: `content-${randomUUID().slice(0, 12)}`, primaryOwnerUserId: owner.id });
      storeId = Number(store[0].insertId);
      const otherStore = await db.insert(stores).values({ name: "متجر اختبار آخر", slug: `content-other-${randomUUID().slice(0, 12)}`, primaryOwnerUserId: owner.id });
      otherStoreId = Number(otherStore[0].insertId);
      const product = await db.insert(products).values({ storeId, productCode, name: "منتج اختبار المحتوى", status: "draft", sellingPrice: "1.00", createdByUserId: owner.id });
      productId = Number(product[0].insertId);
      postId = await createContentPostDraft({ storeId, productId, caption: "مسودة اختبار", createdByUserId: owner.id });
      postMediaId = await saveContentPostMedia({ storeId, postId, storageKey: "content/posts/test/original.jpg", originalFileName: "external-high-quality.jpg", mimeType: "image/jpeg", byteSize: 128 });

      const beforeAttach = await getContentPostDraft(postId, storeId);
      expect(beforeAttach?.media[0]).toMatchObject({ id: postMediaId, linkedProductMediaId: null, storageKey: "content/posts/test/original.jpg" });
      expect(await getContentPostDraft(postId, otherStoreId)).toBeNull();
      expect(await db.select().from(productMedia).where(eq(productMedia.productId, productId))).toEqual([]);

      global.fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as typeof fetch;
      const attached = await attachContentPostMediaToProduct({ storeId, postId, postMediaId, productId });
      linkedProductMediaId = attached.productMediaId;

      expect(attached).toMatchObject({ attached: true, postMediaRemainsIndependent: true });
      const afterAttach = await getContentPostDraft(postId, storeId);
      expect(afterAttach?.media[0]).toMatchObject({ id: postMediaId, linkedProductMediaId, storageKey: "content/posts/test/original.jpg" });
      const productCopy = await db.select().from(productMedia).where(eq(productMedia.id, linkedProductMediaId)).limit(1);
      expect(productCopy[0]).toMatchObject({ productId, source: "manual", mediaType: "image", storageKey: "products/test/copied-image.webp", colorVerified: false });
    } finally {
      if (postMediaId) await db.delete(contentPostMedia).where(eq(contentPostMedia.id, postMediaId));
      if (postId) await db.delete(contentPosts).where(eq(contentPosts.id, postId));
      if (linkedProductMediaId) await db.delete(productMedia).where(eq(productMedia.id, linkedProductMediaId));
      if (productId) await db.delete(products).where(eq(products.id, productId));
      if (otherStoreId) await db.delete(stores).where(eq(stores.id, otherStoreId));
      if (storeId) await db.delete(stores).where(eq(stores.id, storeId));
    }
  }, 15_000);
});
