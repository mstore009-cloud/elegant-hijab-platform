import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { contentPostActivities, contentPosts, products, stores, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { archiveContentPost, createContentPostDraft, getContentPostDraft, requestContentPostReview, reviewContentPost, updateContentPost } from "./db";

describe("Content-A: مسودات المحتوى والمراجعة", () => {
  const cleanup: Array<{ storeId: number; postIds: number[]; productIds: number[] }> = [];

  afterEach(async () => {
    const db = await getDb();
    if (!db) return;
    for (const entry of cleanup.splice(0)) {
      for (const postId of entry.postIds) {
        await db.delete(contentPostActivities).where(eq(contentPostActivities.postId, postId));
        await db.delete(contentPosts).where(eq(contentPosts.id, postId));
      }
      for (const productId of entry.productIds) await db.delete(products).where(eq(products.id, productId));
      await db.delete(stores).where(eq(stores.id, entry.storeId));
    }
  });

  it("يعزل المسودات حسب المتجر ويعيد الاعتماد إلى مسودة عند تعديل المحتوى", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار Content-A.");
    const [owner] = await db.select().from(users).limit(1);
    if (!owner) throw new Error("لا يوجد مستخدم مخول لاختبار Content-A.");

    const firstStore = await db.insert(stores).values({ name: "متجر اختبار تقويم 1", slug: `content-calendar-${randomUUID().slice(0, 10)}`, primaryOwnerUserId: owner.id });
    const secondStore = await db.insert(stores).values({ name: "متجر اختبار تقويم 2", slug: `content-calendar-${randomUUID().slice(0, 10)}`, primaryOwnerUserId: owner.id });
    const firstStoreId = Number(firstStore[0].insertId);
    const secondStoreId = Number(secondStore[0].insertId);
    cleanup.push({ storeId: firstStoreId, postIds: [], productIds: [] }, { storeId: secondStoreId, postIds: [], productIds: [] });

    const firstProduct = await db.insert(products).values({ storeId: firstStoreId, productCode: `CAL-ONE-${randomUUID().slice(0, 8)}`, name: "منتج المتجر الأول", status: "draft", sellingPrice: "1.00", createdByUserId: owner.id });
    const secondProduct = await db.insert(products).values({ storeId: secondStoreId, productCode: `CAL-TWO-${randomUUID().slice(0, 8)}`, name: "منتج المتجر الثاني", status: "draft", sellingPrice: "1.00", createdByUserId: owner.id });
    const firstProductId = Number(firstProduct[0].insertId);
    const secondProductId = Number(secondProduct[0].insertId);
    cleanup[0].productIds.push(firstProductId);
    cleanup[1].productIds.push(secondProductId);

    await expect(createContentPostDraft({ storeId: firstStoreId, productId: secondProductId, createdByUserId: owner.id })).rejects.toThrow("لا ينتمي إلى المتجر التشغيلي الحالي");

    const postId = await createContentPostDraft({
      storeId: firstStoreId,
      productId: firstProductId,
      title: "إطلالة زيتية",
      channelPlan: "instagram",
      contentType: "reel",
      plannedFor: new Date("2026-09-03T10:00:00.000Z"),
      caption: "مسودة أولى",
      createdByUserId: owner.id,
    });
    cleanup[0].postIds.push(postId);

    expect(await getContentPostDraft(postId, secondStoreId)).toBeNull();
    await requestContentPostReview({ storeId: firstStoreId, postId, actorUserId: owner.id, note: "جاهزة للمراجعة" });
    await reviewContentPost({ storeId: firstStoreId, postId, actorUserId: owner.id, decision: "approved", note: "معتمدة داخلياً" });

    const approved = await getContentPostDraft(postId, firstStoreId);
    expect(approved?.post).toMatchObject({ status: "approved", reviewedByUserId: owner.id, channelPlan: "instagram", contentType: "reel" });

    await updateContentPost({ storeId: firstStoreId, postId, actorUserId: owner.id, caption: "نص مراجع يحتاج اعتماداً جديداً" });
    const reset = await getContentPostDraft(postId, firstStoreId);
    expect(reset?.post).toMatchObject({ status: "draft", reviewedByUserId: null, reviewedAt: null, reviewNote: null, caption: "نص مراجع يحتاج اعتماداً جديداً" });
    expect(reset?.activities.map(activity => activity.action)).toEqual(expect.arrayContaining(["created", "review_requested", "approved", "updated"]));

    await archiveContentPost({ storeId: firstStoreId, postId, actorUserId: owner.id, note: "إيقاف الفكرة" });
    const archived = await getContentPostDraft(postId, firstStoreId);
    expect(archived?.post.status).toBe("archived");
    expect(archived?.activities[0]).toMatchObject({ action: "archived", note: "إيقاف الفكرة" });
    expect(await db.select().from(contentPosts).where(and(eq(contentPosts.id, postId), eq(contentPosts.storeId, secondStoreId)))).toEqual([]);
  }, 15_000);
});
