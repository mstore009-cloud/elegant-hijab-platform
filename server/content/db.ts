import { and, desc, eq } from "drizzle-orm";
import { contentPostMedia, contentPosts, productMedia, products } from "../../drizzle/schema";
import { getDb } from "../db";
import { createOperationalImageDerivative } from "../integrations/onedrive/operationalMedia";
import { storageGetSignedUrl, storagePut } from "../storage";

export async function listContentPostDrafts(storeId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(contentPosts).where(eq(contentPosts.storeId, storeId)).orderBy(desc(contentPosts.updatedAt));
}

export async function createContentPostDraft(input: { storeId: number; productId?: number; caption?: string; createdByUserId: number }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  if (input.productId) {
    const product = await db.select({ id: products.id }).from(products).where(eq(products.id, input.productId)).limit(1);
    if (!product[0]) throw new Error("المنتج المرتبط بالمنشور غير موجود.");
  }
  const result = await db.insert(contentPosts).values({
    storeId: input.storeId,
    productId: input.productId ?? null,
    caption: input.caption?.trim() || null,
    createdByUserId: input.createdByUserId,
  });
  return Number(result[0].insertId);
}

export async function getContentPostDraft(postId: number, storeId: number) {
  const db = await getDb();
  if (!db) return null;
  const post = await db.select().from(contentPosts).where(and(eq(contentPosts.id, postId), eq(contentPosts.storeId, storeId))).limit(1);
  if (!post[0]) return null;
  const media = await db.select().from(contentPostMedia).where(eq(contentPostMedia.postId, postId)).orderBy(contentPostMedia.id);
  return { post: post[0], media };
}

export async function saveContentPostMedia(input: {
  storeId: number;
  postId: number;
  storageKey: string;
  originalFileName: string;
  mimeType: string;
  byteSize: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const post = await db.select({ id: contentPosts.id }).from(contentPosts).where(and(eq(contentPosts.id, input.postId), eq(contentPosts.storeId, input.storeId))).limit(1);
  if (!post[0]) throw new Error("مسودة المنشور غير موجودة.");
  const result = await db.insert(contentPostMedia).values({
    postId: input.postId,
    storageKey: input.storageKey,
    originalFileName: input.originalFileName,
    mimeType: input.mimeType,
    byteSize: input.byteSize,
  });
  return Number(result[0].insertId);
}

/**
 * Explicitly converts a post-only image into a separate product WebP. The
 * original post media remains attached to the post and is never changed.
 */
export async function attachContentPostMediaToProduct(input: { storeId: number; postId: number; postMediaId: number; productId: number }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [post] = await db.select({ id: contentPosts.id }).from(contentPosts).where(and(eq(contentPosts.id, input.postId), eq(contentPosts.storeId, input.storeId))).limit(1);
  if (!post) throw new Error("مسودة المنشور غير موجودة ضمن المتجر الحالي.");
  const [media] = await db.select().from(contentPostMedia).where(and(eq(contentPostMedia.id, input.postMediaId), eq(contentPostMedia.postId, input.postId))).limit(1);
  if (!media) throw new Error("وسيط المنشور غير موجود ضمن هذه المسودة.");
  if (media.linkedProductMediaId) return { productMediaId: media.linkedProductMediaId, attached: false, postMediaRemainsIndependent: true as const };
  const [product] = await db.select({ id: products.id }).from(products).where(eq(products.id, input.productId)).limit(1);
  if (!product) throw new Error("المنتج المحدد غير موجود.");

  const sourceResponse = await fetch(await storageGetSignedUrl(media.storageKey));
  if (!sourceResponse.ok) throw new Error("تعذر قراءة وسيط المنشور لتحويله إلى صورة منتج.");
  const derivative = await createOperationalImageDerivative(Buffer.from(await sourceResponse.arrayBuffer()));
  const uploaded = await storagePut(`products/${input.productId}/manual-post-media/${media.id}.webp`, derivative.bytes, "image/webp");
  const nextOrder = (await db.select({ id: productMedia.id }).from(productMedia).where(eq(productMedia.productId, input.productId))).length;
  const inserted = await db.transaction(async tx => {
    const result = await tx.insert(productMedia).values({
      productId: input.productId,
      source: "manual",
      mediaType: "image",
      originalUrl: null,
      storageKey: uploaded.key,
      operationalMetadata: JSON.stringify({ ...derivative.metadata, source: "content_post_media", postMediaId: media.id }),
      originalFileName: media.originalFileName,
      colorVerified: false,
      sortOrder: nextOrder,
    });
    const productMediaId = Number(result[0].insertId);
    await tx.update(contentPostMedia).set({ linkedProductMediaId: productMediaId }).where(eq(contentPostMedia.id, media.id));
    return productMediaId;
  });
  return { productMediaId: inserted, attached: true, postMediaRemainsIndependent: true as const };
}
