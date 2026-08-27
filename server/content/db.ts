import { and, desc, eq, gte, lte } from "drizzle-orm";
import { contentPostActivities, contentPostMedia, contentPosts, productMedia, products } from "../../drizzle/schema";
import { getDb } from "../db";
import { createOperationalImageDerivative } from "../integrations/onedrive/operationalMedia";
import { notifyPermissionHolders } from "../notifications/db";
import { storageGetSignedUrl, storagePut } from "../storage";

type ContentStatus = "draft" | "needs_review" | "approved" | "changes_requested" | "archived";
type ContentType = "feed_post" | "story" | "reel" | "catalog" | "other";
type ChannelPlan = "general" | "facebook" | "instagram" | "tiktok" | "whatsapp";
type ContentActivityAction = "created" | "updated" | "review_requested" | "approved" | "changes_requested" | "archived";

function trimmedOrNull(value: string | null | undefined) {
  if (value === undefined || value === null) return null;
  return value.trim() || null;
}

function datesMatch(left: Date | null, right: Date | null) {
  return (left?.getTime() ?? null) === (right?.getTime() ?? null);
}

async function assertProductBelongsToStore(storeId: number, productId: number | null | undefined) {
  if (!productId) return;
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.storeId, storeId)))
    .limit(1);
  if (!product) throw new Error("المنتج المرتبط لا ينتمي إلى المتجر التشغيلي الحالي.");
}

async function recordContentActivity(input: {
  storeId: number;
  postId: number;
  actorUserId?: number | null;
  action: ContentActivityAction;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await db.insert(contentPostActivities).values({
    storeId: input.storeId,
    postId: input.postId,
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    note: input.note?.trim() || null,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
  });
}

export async function listContentPostDrafts(input: {
  storeId: number;
  status?: ContentStatus;
  channelPlan?: ChannelPlan;
  from?: Date;
  to?: Date;
}) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(contentPosts)
    .where(
      and(
        eq(contentPosts.storeId, input.storeId),
        input.status ? eq(contentPosts.status, input.status) : undefined,
        input.channelPlan ? eq(contentPosts.channelPlan, input.channelPlan) : undefined,
        input.from ? gte(contentPosts.plannedFor, input.from) : undefined,
        input.to ? lte(contentPosts.plannedFor, input.to) : undefined,
      ),
    )
    .orderBy(desc(contentPosts.plannedFor), desc(contentPosts.updatedAt));
}

export async function createContentPostDraft(input: {
  storeId: number;
  productId?: number | null;
  title?: string | null;
  contentType?: ContentType;
  channelPlan?: ChannelPlan;
  plannedFor?: Date | null;
  caption?: string | null;
  createdByUserId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await assertProductBelongsToStore(input.storeId, input.productId);
  const result = await db.insert(contentPosts).values({
    storeId: input.storeId,
    productId: input.productId ?? null,
    title: trimmedOrNull(input.title),
    contentType: input.contentType ?? "feed_post",
    channelPlan: input.channelPlan ?? "general",
    plannedFor: input.plannedFor ?? null,
    caption: trimmedOrNull(input.caption),
    createdByUserId: input.createdByUserId,
  });
  const postId = Number(result[0].insertId);
  await recordContentActivity({
    storeId: input.storeId,
    postId,
    actorUserId: input.createdByUserId,
    action: "created",
    note: "أُنشئت مسودة المحتوى.",
  });
  return postId;
}

export async function getContentPostDraft(postId: number, storeId: number) {
  const db = await getDb();
  if (!db) return null;
  const post = await db.select().from(contentPosts).where(and(eq(contentPosts.id, postId), eq(contentPosts.storeId, storeId))).limit(1);
  if (!post[0]) return null;
  const [media, activities] = await Promise.all([
    db.select().from(contentPostMedia).where(eq(contentPostMedia.postId, postId)).orderBy(contentPostMedia.id),
    db.select().from(contentPostActivities).where(and(eq(contentPostActivities.postId, postId), eq(contentPostActivities.storeId, storeId))).orderBy(desc(contentPostActivities.createdAt), desc(contentPostActivities.id)),
  ]);
  return { post: post[0], media, activities };
}

export async function updateContentPost(input: {
  storeId: number;
  postId: number;
  actorUserId: number;
  productId?: number | null;
  title?: string | null;
  contentType?: ContentType;
  channelPlan?: ChannelPlan;
  plannedFor?: Date | null;
  caption?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [post] = await db.select().from(contentPosts).where(and(eq(contentPosts.id, input.postId), eq(contentPosts.storeId, input.storeId))).limit(1);
  if (!post) throw new Error("مسودة المحتوى غير موجودة ضمن المتجر الحالي.");

  const productId = input.productId === undefined ? post.productId : input.productId;
  await assertProductBelongsToStore(input.storeId, productId);
  const title = input.title === undefined ? post.title : trimmedOrNull(input.title);
  const caption = input.caption === undefined ? post.caption : trimmedOrNull(input.caption);
  const contentType = input.contentType ?? post.contentType;
  const channelPlan = input.channelPlan ?? post.channelPlan;
  const plannedFor = input.plannedFor === undefined ? post.plannedFor : input.plannedFor;
  const changed = post.productId !== productId || post.title !== title || post.caption !== caption || post.contentType !== contentType || post.channelPlan !== channelPlan || !datesMatch(post.plannedFor, plannedFor);
  if (!changed) return post;

  const reviewReset = post.status === "needs_review" || post.status === "approved";
  await db
    .update(contentPosts)
    .set({
      productId,
      title,
      caption,
      contentType,
      channelPlan,
      plannedFor,
      ...(reviewReset ? { status: "draft" as const, reviewedByUserId: null, reviewedAt: null, reviewNote: null } : {}),
    })
    .where(and(eq(contentPosts.id, input.postId), eq(contentPosts.storeId, input.storeId)));
  await recordContentActivity({
    storeId: input.storeId,
    postId: input.postId,
    actorUserId: input.actorUserId,
    action: "updated",
    note: reviewReset ? "عُدلت المسودة وأعيدت إلى مسودة لأن القرار السابق لم يعد ينطبق." : "عُدلت مسودة المحتوى.",
    metadata: { reviewReset },
  });
  return getContentPostDraft(input.postId, input.storeId);
}

export async function requestContentPostReview(input: { storeId: number; postId: number; actorUserId: number; note?: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [post] = await db.select().from(contentPosts).where(and(eq(contentPosts.id, input.postId), eq(contentPosts.storeId, input.storeId))).limit(1);
  if (!post) throw new Error("مسودة المحتوى غير موجودة ضمن المتجر الحالي.");
  if (post.status !== "draft" && post.status !== "changes_requested") throw new Error("لا يمكن طلب المراجعة في الحالة الحالية للمسودة.");
  await db.update(contentPosts).set({ status: "needs_review", reviewedByUserId: null, reviewedAt: null, reviewNote: null }).where(eq(contentPosts.id, input.postId));
  await recordContentActivity({ storeId: input.storeId, postId: input.postId, actorUserId: input.actorUserId, action: "review_requested", note: input.note });
  try {
    await notifyPermissionHolders({ storeId: input.storeId, permissionCode: "content.approve", type: "content_review_requested", priority: "action", title: `مسودة محتوى بانتظار المراجعة: ${post.title || "بلا عنوان"}`, body: input.note?.trim() || "راجعي المسودة قبل اعتمادها.", entityType: "content_post", entityId: post.id, route: `/content-posts?post=${post.id}` });
  } catch (error) {
    console.warn("[Notifications] تعذر إنشاء تنبيه مراجعة محتوى:", error);
  }
  return { status: "needs_review" as const };
}

export async function reviewContentPost(input: { storeId: number; postId: number; actorUserId: number; decision: "approved" | "changes_requested"; note?: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [post] = await db.select().from(contentPosts).where(and(eq(contentPosts.id, input.postId), eq(contentPosts.storeId, input.storeId))).limit(1);
  if (!post) throw new Error("مسودة المحتوى غير موجودة ضمن المتجر الحالي.");
  if (post.status !== "needs_review") throw new Error("لا يمكن اتخاذ قرار مراجعة إلا لمسودة بانتظار المراجعة.");
  const reviewNote = trimmedOrNull(input.note);
  await db.update(contentPosts).set({ status: input.decision, reviewedByUserId: input.actorUserId, reviewedAt: new Date(), reviewNote }).where(eq(contentPosts.id, input.postId));
  await recordContentActivity({ storeId: input.storeId, postId: input.postId, actorUserId: input.actorUserId, action: input.decision, note: reviewNote });
  return { status: input.decision };
}

export async function archiveContentPost(input: { storeId: number; postId: number; actorUserId: number; note?: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [post] = await db.select({ id: contentPosts.id }).from(contentPosts).where(and(eq(contentPosts.id, input.postId), eq(contentPosts.storeId, input.storeId))).limit(1);
  if (!post) throw new Error("مسودة المحتوى غير موجودة ضمن المتجر الحالي.");
  await db.update(contentPosts).set({ status: "archived" }).where(eq(contentPosts.id, input.postId));
  await recordContentActivity({ storeId: input.storeId, postId: input.postId, actorUserId: input.actorUserId, action: "archived", note: input.note });
  return { status: "archived" as const };
}

export async function saveContentPostMedia(input: {
  storeId: number;
  postId: number;
  storageKey: string;
  originalFileName: string;
  mimeType: string;
  byteSize: number;
  actorUserId?: number | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [post] = await db.select().from(contentPosts).where(and(eq(contentPosts.id, input.postId), eq(contentPosts.storeId, input.storeId))).limit(1);
  if (!post) throw new Error("مسودة المنشور غير موجودة.");
  const result = await db.insert(contentPostMedia).values({
    postId: input.postId,
    storageKey: input.storageKey,
    originalFileName: input.originalFileName,
    mimeType: input.mimeType,
    byteSize: input.byteSize,
  });
  const reviewReset = post.status === "needs_review" || post.status === "approved";
  if (reviewReset) await db.update(contentPosts).set({ status: "draft", reviewedByUserId: null, reviewedAt: null, reviewNote: null }).where(eq(contentPosts.id, input.postId));
  await recordContentActivity({
    storeId: input.storeId,
    postId: input.postId,
    actorUserId: input.actorUserId,
    action: "updated",
    note: reviewReset ? "أضيف وسيط وأعيدت المسودة للمراجعة." : "أضيف وسيط إلى مسودة المحتوى.",
    metadata: { mediaAdded: true, reviewReset },
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
  await assertProductBelongsToStore(input.storeId, input.productId);

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
